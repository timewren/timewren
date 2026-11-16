//! Mock af web-appens token-API (feature `mock`) til kontrakttests og
//! udvikling uden server. Taler samme wire-format som web (tRPC +
//! superjson, fejl i `error.json.data.code`, SSE på `/api/ext/stream`) og
//! bruger en [`LocalRepo`] som database, så forretningsadfærden er den samme.
//!
//! Minimal HTTP/1.1 på `std::net` (altid `Connection: close`), så testene
//! kan simulere netværksfejl præcist: `set_offline` lukker forbindelsen før
//! behandling, `drop_next_responses` behandler kaldet og lukker uden svar
//! (det tabte svar, der gav dubletter i udvidelsen).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::time::Duration;

use chrono::{DateTime, NaiveDate, Utc};
use futures_lite::future::block_on;
use parking_lot::Mutex;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::cloud::auth::pkce_challenge;
use crate::error::DataError;
use crate::model::*;
use crate::repo::Repository;
use crate::trpc;
use crate::{LocalRepo, serde_util};

pub const MOCK_USER_ID: &str = "user-1";
pub const MOCK_ORG_ID: &str = "org-1";

#[derive(Default)]
struct Tokens {
    /// adgangstoken → (bruger-id, gyldig)
    access: HashMap<String, (String, bool)>,
    /// refresh-token → bruger-id
    refresh: HashMap<String, String>,
    /// engangskode → (PKCE-challenge, state, enheds-id)
    codes: HashMap<String, (String, String, String)>,
}

#[derive(Default)]
struct TimerRow {
    state: TimerState,
    last_client_op_id: Option<String>,
}

struct State {
    repo: LocalRepo,
    tokens: Mutex<Tokens>,
    timer: Mutex<TimerRow>,
    offline: AtomicBool,
    drop_responses: AtomicUsize,
    realtime_disabled: AtomicBool,
    streams: Mutex<Vec<mpsc::Sender<String>>>,
    calls: Mutex<Vec<String>>,
    /// (procedure, input uden token) for hvert kald.
    inputs: Mutex<Vec<(String, Value)>>,
    seq: AtomicUsize,
    /// importKey → id på serveren (extension.import.run)
    import_keys: Mutex<HashMap<String, String>>,
    /// idempotencyKey → svaret fra create (som web's withIdempotencyKey:
    /// samme nøgle giver samme række i stedet for en dublet).
    create_keys: Mutex<HashMap<String, Value>>,
    /// Procedurer, der "ikke findes endnu" (svarer NOT_FOUND som tRPC).
    hidden: Mutex<Vec<String>>,
    /// Svar med en HTML-fejlside (proxy/captive portal) med denne status.
    html_error: Mutex<Option<u16>>,
    /// procedure → (tRPC-kode, antal): de næste kald afvises med koden.
    inject: Mutex<HashMap<String, (String, usize, usize)>>,
    /// Lærte mønstre (web's device_learned_patterns): nøgle-hash → række.
    patterns: Mutex<Vec<Value>>,
    /// (procedure, tekst i input, tRPC-kode, besked): kald, hvis input
    /// indeholder teksten, afvises, til reglen fjernes (`reject_when`).
    reject_rules: Mutex<Vec<(String, String, String, String)>>,
    /// Svar på `extension.entitlements.get` i stedet for standarden (betalt).
    entitlements: Mutex<Option<Value>>,
    /// procedure → antal: kaldet behandles, men svaret går tabt.
    drop_of: Mutex<HashMap<String, usize>>,
    /// (procedure, token) for hvert kald med `Authorization: Bearer`.
    bearer: Mutex<Vec<(String, String)>>,
    /// procedure → tRPC-koder: de næste kald afvises med koderne i rækkefølge.
    inject_seq: Mutex<HashMap<String, std::collections::VecDeque<String>>>,
    /// Tavlens kolonner (`extension.tasks.statuses`).
    lanes: Mutex<Vec<TaskLane>>,
    /// opgave → kolonne efter `extension.tasks.move` (web's `statusId`).
    task_lanes: Mutex<HashMap<String, String>>,
}

pub struct MockWeb {
    state: Arc<State>,
    addr: String,
    stop: Arc<AtomicBool>,
}

type Res = std::result::Result<Value, DataError>;

impl MockWeb {
    /// Start på en tilfældig port. `token` er gyldigt fra start.
    pub fn start(token: &str) -> MockWeb {
        let device = DeviceInfo {
            device_id: "mock-server".into(),
            device_name: "mock".into(),
            os: "linux".into(),
            app_version: "0".into(),
        };
        let state = Arc::new(State {
            repo: LocalRepo::in_memory(device).expect("mock-database"),
            tokens: Mutex::new(Tokens::default()),
            timer: Mutex::new(TimerRow::default()),
            offline: AtomicBool::new(false),
            drop_responses: AtomicUsize::new(0),
            realtime_disabled: AtomicBool::new(false),
            streams: Mutex::new(Vec::new()),
            calls: Mutex::new(Vec::new()),
            inputs: Mutex::new(Vec::new()),
            seq: AtomicUsize::new(0),
            import_keys: Mutex::new(HashMap::new()),
            create_keys: Mutex::new(HashMap::new()),
            hidden: Mutex::new(Vec::new()),
            html_error: Mutex::new(None),
            inject: Mutex::new(HashMap::new()),
            patterns: Mutex::new(Vec::new()),
            reject_rules: Mutex::new(Vec::new()),
            entitlements: Mutex::new(None),
            drop_of: Mutex::new(HashMap::new()),
            bearer: Mutex::new(Vec::new()),
            inject_seq: Mutex::new(HashMap::new()),
            lanes: Mutex::new(TaskLane::defaults()),
            task_lanes: Mutex::new(HashMap::new()),
        });
        state.tokens.lock().access.insert(token.to_owned(), (MOCK_USER_ID.to_owned(), true));
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let (st, stp) = (state.clone(), stop.clone());
        std::thread::spawn(move || {
            while !stp.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((sock, _)) => {
                        // På macOS arver en accepteret socket lytterens
                        // non-blocking; store svar fejlede så med WouldBlock.
                        let _ = sock.set_nonblocking(false);
                        let st = st.clone();
                        std::thread::spawn(move || handle(st, sock));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(5)),
                }
            }
        });
        MockWeb { state, addr, stop }
    }

    pub fn base_url(&self) -> &str {
        &self.addr
    }

    /// Serverens database (til at se, hvad der faktisk blev gemt).
    pub fn repo(&self) -> &LocalRepo {
        &self.state.repo
    }

    pub fn set_offline(&self, offline: bool) {
        self.state.offline.store(offline, Ordering::SeqCst);
        if offline {
            self.drop_streams();
        }
    }

    /// Behandl de næste `n` kald, men luk forbindelsen uden svar.
    pub fn drop_next_responses(&self, n: usize) {
        self.state.drop_responses.store(n, Ordering::SeqCst);
    }

    pub fn set_realtime_disabled(&self, disabled: bool) {
        self.state.realtime_disabled.store(disabled, Ordering::SeqCst);
    }

    /// Tilbagekald et token (som "Fjern enhed" i web).
    pub fn revoke(&self, token: &str) {
        if let Some(t) = self.state.tokens.lock().access.get_mut(token) {
            t.1 = false;
        }
    }

    /// Antal kald til en procedure.
    pub fn calls(&self, procedure: &str) -> usize {
        self.state.calls.lock().iter().filter(|c| *c == procedure).count()
    }

    pub fn open_streams(&self) -> usize {
        self.state.streams.lock().len()
    }

    /// Luk alle SSE-forbindelser (som en proxy-timeout).
    pub fn drop_streams(&self) {
        self.state.streams.lock().clear();
    }

    /// Send en hændelse som web's `publishDataChanged`.
    pub fn publish_data(&self, entities: &[&str]) {
        publish(&self.state, "data", json!({ "type": "data", "entities": entities }));
    }

    pub fn publish_revoked(&self) {
        let frame = "event: revoked\ndata: {}\n\n".to_owned();
        self.state.streams.lock().retain(|tx| tx.send(frame.clone()).is_ok());
    }

    /// Browseren: brugeren godkender `/auth/device`-siden. Returnerer deep
    /// linket som web's `deviceCallbackUrl`.
    pub fn approve_login(&self, authorize_url: &str) -> String {
        let url = url::Url::parse(authorize_url).unwrap();
        assert_eq!(url.path(), "/auth/device", "web's godkendelsesside");
        let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let code = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        self.state
            .tokens
            .lock()
            .codes
            .insert(code.clone(), (q["challenge"].clone(), q["state"].clone(), q["device_id"].clone()));
        format!("timetrack://auth/callback?code={code}&state={}", q["state"])
    }

    /// Lad et adgangstoken udløbe (svarer UNAUTHORIZED), så refresh prøves.
    pub fn expire(&self, token: &str) {
        self.revoke(token);
    }

    /// Ændr data "fra web" (som en anden klient).
    pub fn web_create_client(&self, name: &str) -> Client {
        let c = block_on(self.state.repo.create_client(NewClient { name: name.into(), ..Default::default() })).unwrap();
        self.publish_data(&["clients"]);
        c
    }

    /// Det seneste input til en procedure (uden token), som web så det.
    pub fn last_input(&self, procedure: &str) -> Option<Value> {
        self.state.inputs.lock().iter().rev().find(|(p, _)| p == procedure).map(|(_, v)| v.clone())
    }

    /// Tokens, der kom i `Authorization: Bearer` på kald til `procedure`.
    pub fn bearer_tokens(&self, procedure: &str) -> Vec<String> {
        self.state.bearer.lock().iter().filter(|(p, _)| p == procedure).map(|(_, t)| t.clone()).collect()
    }

    /// Alle input til `procedure` i rækkefølge (uden token).
    pub fn inputs(&self, procedure: &str) -> Vec<Value> {
        self.state.inputs.lock().iter().filter(|(p, _)| p == procedure).map(|(_, v)| v.clone()).collect()
    }

    /// Svar alle tRPC-kald med en HTML-side (proxy) med `status`.
    pub fn set_html_error(&self, status: Option<u16>) {
        *self.state.html_error.lock() = status;
    }

    /// Udsted et nyt gyldigt adgangstoken til samme bruger.
    pub fn issue_token(&self) -> String {
        let t = format!("tok-{}", Uuid::new_v4());
        self.state.tokens.lock().access.insert(t.clone(), (MOCK_USER_ID.to_owned(), true));
        t
    }

    /// Afvis de næste `n` kald til `procedure` med tRPC-koden `code` (før
    /// behandling), fx CONFLICT, mens en oprettelse med samme nøgle kører.
    pub fn fail_next(&self, procedure: &str, code: &str, n: usize) {
        self.fail_after(procedure, code, 0, n);
    }

    /// De næste `n` kald til `procedure` behandles, men svaret går tabt
    /// (forbindelsen lukkes).
    pub fn drop_responses_of(&self, procedure: &str, n: usize) {
        self.state.drop_of.lock().insert(procedure.to_owned(), n);
    }

    /// Web's lærte mønstre (rækkerne med `key`, `votes` og `updatedAt`).
    pub fn learned_patterns(&self) -> Vec<Value> {
        self.state.patterns.lock().clone()
    }

    /// Afvis de næste kald til `procedure` med `codes` i rækkefølge (før
    /// behandling), fx en timeout og så CONFLICT, mens det første kald kører.
    pub fn fail_sequence(&self, procedure: &str, codes: &[&str]) {
        self.state.inject_seq.lock().insert(procedure.to_owned(), codes.iter().map(|c| c.to_string()).collect());
    }

    /// Som `fail_next`, men først efter `skip` kald, der behandles normalt.
    pub fn fail_after(&self, procedure: &str, code: &str, skip: usize, n: usize) {
        self.state.inject.lock().insert(procedure.to_owned(), (code.to_owned(), skip, n));
    }

    /// Afvis hvert kald til `procedure`, hvis input (som JSON) indeholder
    /// `needle`, med tRPC-koden `code` og `message` (fx FORBIDDEN "Planen er
    /// låst"). Gælder, til `clear_rejections`. En ny regel for samme
    /// procedure og tekst erstatter den gamle.
    pub fn reject_when(&self, procedure: &str, needle: &str, code: &str, message: &str) {
        let mut rules = self.state.reject_rules.lock();
        rules.retain(|(p, n, _, _)| !(p == procedure && n == needle));
        rules.push((procedure.to_owned(), needle.to_owned(), code.to_owned(), message.to_owned()));
    }

    pub fn clear_rejections(&self) {
        self.state.reject_rules.lock().clear();
    }

    /// Lad som om proceduren ikke findes (web uden feat/device-api).
    pub fn hide_procedure(&self, procedure: &str) {
        self.state.hidden.lock().push(procedure.to_owned());
    }

    /// Serverens fælles timer, som web ser den.
    pub fn timer_state(&self) -> TimerState {
        self.state.timer.lock().state.clone()
    }

    /// Skift opgaven på timeren "fra en anden enhed" (bumper versionen).
    pub fn web_set_timer_task(&self, task_id: Option<&str>) {
        let mut row = self.state.timer.lock();
        row.state.task_id = task_id.map(str::to_owned);
        row.state.version += 1;
        let version = row.state.version;
        drop(row);
        publish(&self.state, "timer", json!({ "type": "timer", "event": "sync", "version": version }));
    }

    /// Tavlens kolonner "fra web" (egne statusser).
    pub fn set_task_lanes(&self, lanes: Vec<TaskLane>) {
        *self.state.lanes.lock() = lanes;
    }

    /// Svar på `extension.entitlements.get` (fx en udløbet prøve). `None`
    /// giver standarden: en betalt plan med alt slået til.
    pub fn set_entitlements(&self, entitlements: Option<Value>) {
        *self.state.entitlements.lock() = entitlements;
    }

    /// Start timeren "fra web".
    pub fn web_start_timer(&self, description: &str, at: DateTime<Utc>) {
        let mut row = self.state.timer.lock();
        let v = row.state.version;
        row.state = TimerState {
            is_running: true,
            start_time: Some(at),
            description: description.into(),
            version: v + 1,
            session_id: Some(Uuid::new_v4().to_string()),
            ..Default::default()
        };
        let version = row.state.version;
        drop(row);
        publish(&self.state, "timer", json!({ "type": "timer", "event": "sync", "version": version }));
    }
}

impl Drop for MockWeb {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.drop_streams();
    }
}

fn publish(state: &State, event: &str, data: Value) {
    let id = state.seq.fetch_add(1, Ordering::SeqCst) + 1;
    let frame = format!("id: {id}\nevent: {event}\ndata: {data}\n\n");
    state.streams.lock().retain(|tx| tx.send(frame.clone()).is_ok());
}

// --------------------------------------------------------------- HTTP

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    body: String,
}

fn read_request(sock: &TcpStream) -> Option<Request> {
    let mut r = BufReader::new(sock.try_clone().ok()?);
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let target = parts.next()?.to_owned();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        r.read_line(&mut h).ok()?;
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_owned());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut body = vec![0; len];
    r.read_exact(&mut body).ok()?;
    let url = url::Url::parse(&format!("http://mock{target}")).ok()?;
    Some(Request {
        method,
        path: url.path().to_owned(),
        query: url.query_pairs().into_owned().collect(),
        headers,
        body: String::from_utf8(body).ok()?,
    })
}

fn respond(mut sock: TcpStream, status: u16, content_type: &str, body: &str) {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let _ = write!(
        sock,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.flush();
    let _ = sock.shutdown(Shutdown::Both);
}

fn handle(state: Arc<State>, sock: TcpStream) {
    let _ = sock.set_read_timeout(Some(Duration::from_secs(5)));
    let Some(req) = read_request(&sock) else { return };
    if state.offline.load(Ordering::SeqCst) {
        let _ = sock.shutdown(Shutdown::Both);
        return;
    }
    if req.path == "/api/ext/stream" {
        return stream(state, sock, &req);
    }
    let Some(procedure) = req.path.strip_prefix("/api/trpc/").map(str::to_owned) else {
        return respond(sock, 404, "text/plain", "not found");
    };
    if let Some(status) = *state.html_error.lock() {
        return respond(sock, status, "text/html", "<html><body>Log ind på netværket</body></html>");
    }
    let raw = if req.method == "GET" { req.query.get("input").cloned().unwrap_or_default() } else { req.body.clone() };
    let envelope: Value = serde_json::from_str(&raw).unwrap_or(json!({}));
    let mut input = envelope.get("json").cloned().unwrap_or(json!({}));
    // Web's `tokenProcedure`: `Authorization: Bearer` lægges i input, når
    // input ikke selv har et token (et token i input vinder).
    if let Some(bearer) = req.headers.get("authorization").and_then(|h| h.strip_prefix("Bearer ")) {
        state.bearer.lock().push((procedure.clone(), bearer.to_owned()));
        if input.is_null() {
            input = json!({});
        }
        if input.is_object() && s(&input, "token").is_none() {
            input["token"] = json!(bearer);
        }
    }
    state.calls.lock().push(procedure.clone());
    let mut seen = input.clone();
    if let Some(o) = seen.as_object_mut() {
        o.remove("token");
    }
    state.inputs.lock().push((procedure.clone(), seen));
    let result = dispatch_idempotent(&state, &procedure, &input);
    let drop_this = state.drop_of.lock().get_mut(&procedure).is_some_and(|n| {
        let hit = *n > 0;
        *n = n.saturating_sub(1);
        hit
    });
    if drop_this
        || state
            .drop_responses
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
    {
        // Behandlet, men svaret går tabt.
        let _ = sock.shutdown(Shutdown::Both);
        return;
    }
    let (status, body) = match result {
        Ok(v) => (200, trpc::result_body(v)),
        Err(e) => {
            let code = match &e {
                DataError::Unauthorized => "UNAUTHORIZED",
                DataError::NotFound => "NOT_FOUND",
                DataError::Validation(_) => "BAD_REQUEST",
                DataError::Conflict { .. } => "CONFLICT",
                DataError::Unsupported(_) => "FORBIDDEN",
                DataError::Rejected { code, .. } => code.as_str(),
                _ => "INTERNAL_SERVER_ERROR",
            };
            (trpc::status_for_code(code), trpc::error_body(code, &e.to_string(), None))
        }
    };
    respond(sock, status, "application/json", &body.to_string());
}

fn stream(state: Arc<State>, mut sock: TcpStream, req: &Request) {
    let token = req.headers.get("authorization").and_then(|h| h.strip_prefix("Bearer ")).unwrap_or("");
    if auth_user(&state, token).is_err() {
        return respond(sock, 401, "text/plain", "unauthorized");
    }
    if state.realtime_disabled.load(Ordering::SeqCst) {
        return respond(sock, 503, "text/plain", "realtime disabled");
    }
    let (tx, rx) = mpsc::channel::<String>();
    if write!(
        sock,
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n: connected\n\n"
    )
    .is_err()
    {
        return;
    }
    let _ = sock.flush();
    state.streams.lock().push(tx);
    // Kører til kanalen lukkes (drop_streams) eller klienten går.
    while let Ok(frame) = rx.recv() {
        if sock.write_all(frame.as_bytes()).and_then(|_| sock.flush()).is_err() {
            break;
        }
    }
    let _ = sock.shutdown(Shutdown::Both);
}

// --------------------------------------------------------------- procedurer

fn auth_user(state: &State, token: &str) -> std::result::Result<String, DataError> {
    match state.tokens.lock().access.get(token) {
        Some((user, true)) => Ok(user.clone()),
        _ => Err(DataError::Unauthorized),
    }
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn id(v: &Value) -> std::result::Result<String, DataError> {
    s(v, "id").ok_or_else(|| DataError::Validation("id mangler".into()))
}

fn parse<T: serde::de::DeserializeOwned>(v: Option<&Value>) -> std::result::Result<T, DataError> {
    serde_json::from_value(v.cloned().unwrap_or(json!({}))).map_err(|e| DataError::Validation(e.to_string()))
}

fn val<T: serde::Serialize>(t: T) -> Res {
    Ok(serde_json::to_value(t)?)
}

fn issue_tokens(state: &State, user: &str) -> Value {
    let access = format!("acc-{}", Uuid::new_v4());
    let refresh = format!("ref-{}", Uuid::new_v4());
    let mut t = state.tokens.lock();
    t.access.insert(access.clone(), (user.to_owned(), true));
    t.refresh.insert(refresh.clone(), user.to_owned());
    json!({
        "accessToken": access,
        "refreshToken": refresh,
        "expiresAt": (Utc::now() + chrono::Duration::hours(1)).to_rfc3339(),
        "refreshExpiresAt": (Utc::now() + chrono::Duration::days(180)).to_rfc3339(),
        "user": { "id": user, "name": "Mads Holst Jensen", "email": "mads@example.dk" },
        "organizationId": MOCK_ORG_ID,
    })
}

/// Timeren, som web's getTimerStateWithVersion svarer: med `taskId` (også
/// null) og `project` med `clientId`.
fn timer_json(t: &TimerState) -> Value {
    let mut v = serde_json::to_value(t).unwrap_or_default();
    v["taskId"] = json!(t.task_id);
    v
}

/// Som web's updateTimerState: en opgave, der ikke findes, giver NOT_FOUND.
fn check_task(state: &State, input: &Value) -> std::result::Result<(), DataError> {
    match s(input, "taskId") {
        Some(tid) if block_on(state.repo.list_tasks(TaskFilter::default()))?.iter().all(|t| t.id != tid) => {
            Err(DataError::Rejected { code: "NOT_FOUND".into(), message: "Opgave ikke fundet".into(), app_code: None, status: 404 })
        }
        _ => Ok(()),
    }
}

fn timer_with_refs(state: &State, t: &TimerState) -> Value {
    let mut v = timer_json(t);
    if let Some(pid) = &t.project_id
        && let Ok(p) = block_on(state.repo.get_project(pid))
    {
        v["project"] = json!({ "id": p.id, "name": p.name, "clientId": p.client_id });
    }
    v
}

fn take_injected(state: &State, procedure: &str) -> Option<String> {
    if let Some(code) = state.inject_seq.lock().get_mut(procedure).and_then(|q| q.pop_front()) {
        return Some(code);
    }
    let mut inject = state.inject.lock();
    let (code, skip, n) = inject.get_mut(procedure)?;
    if *skip > 0 {
        *skip -= 1;
        return None;
    }
    if *n == 0 {
        return None;
    }
    *n -= 1;
    Some(code.clone())
}

fn matching_rejection(state: &State, procedure: &str, input: &Value) -> Option<DataError> {
    let text = input.to_string();
    let rules = state.reject_rules.lock();
    let (_, _, code, message) = rules.iter().find(|(p, n, _, _)| p == procedure && text.contains(n.as_str()))?;
    Some(DataError::Rejected {
        code: code.clone(),
        message: message.clone(),
        app_code: None,
        status: trpc::status_for_code(code),
    })
}

/// Create med `idempotencyKey` (web's `withIdempotencyKey`): et gentaget kald
/// med samme nøgle giver det første svar igen. Nøglen skal være 8-64 tegn.
fn dispatch_idempotent(state: &State, procedure: &str, input: &Value) -> Res {
    if let Some(code) = take_injected(state, procedure) {
        return Err(DataError::Rejected { code: code.clone(), message: format!("Injiceret {code}"), app_code: None, status: trpc::status_for_code(&code) });
    }
    if let Some(e) = matching_rejection(state, procedure, input) {
        return Err(e);
    }
    let keyed = matches!(
        procedure,
        "extension.clients.create"
            | "extension.projects.create"
            | "extension.tasks.create"
            | "extension.klippekort.create"
            | "extension.invoices.createDraft"
            | "extension.klippekort.topUp"
    );
    let key = match s(input, "idempotencyKey") {
        Some(k) if keyed => {
            if !(8..=64).contains(&k.len()) {
                return Err(DataError::Validation("idempotencyKey: 8-64 tegn".into()));
            }
            format!("{procedure} {k}")
        }
        _ => return dispatch(state, procedure, input),
    };
    if let Some(v) = state.create_keys.lock().get(&key).cloned() {
        // Web svarer et gentaget topUp med kortet hentet frisk.
        if procedure == "extension.klippekort.topUp" {
            return dispatch(state, "extension.klippekort.get", input);
        }
        return Ok(v);
    }
    let v = dispatch(state, procedure, input)?;
    state.create_keys.lock().insert(key, v.clone());
    Ok(v)
}

fn dispatch(state: &State, procedure: &str, input: &Value) -> Res {
    if state.hidden.lock().iter().any(|h| h == procedure) {
        return Err(no_procedure(procedure));
    }
    // Uden token
    match procedure {
        "extension.device.exchangeCode" => {
            let code = s(input, "code").unwrap_or_default();
            let verifier = s(input, "codeVerifier").unwrap_or_default();
            let st = s(input, "state").unwrap_or_default();
            let device = s(input, "deviceId").unwrap_or_default();
            let row = state.tokens.lock().codes.remove(&code);
            return match row {
                Some((c, rs, rd)) if c == pkce_challenge(&verifier) && rs == st && rd == device => {
                    Ok(issue_tokens(state, MOCK_USER_ID))
                }
                _ => Err(DataError::Rejected {
                    code: "UNAUTHORIZED".into(),
                    message: "Login-koden er ugyldig eller udløbet. Log ind igen.".into(),
                    app_code: None,
                    status: 401,
                }),
            };
        }
        "extension.device.refresh" => {
            let rt = s(input, "refreshToken").unwrap_or_default();
            let user = state.tokens.lock().refresh.remove(&rt);
            return match user {
                Some(u) => Ok(issue_tokens(state, &u)),
                None => Err(DataError::Unauthorized),
            };
        }
        "extension.validateToken" => {
            let token = s(input, "token").unwrap_or_default();
            return Ok(match auth_user(state, &token) {
                Ok(u) => json!({ "valid": true, "user": { "id": u, "name": "Mads Holst Jensen", "email": "mads@example.dk" } }),
                Err(_) => json!({ "valid": false, "user": null }),
            });
        }
        _ => {}
    }
    auth_user(state, &s(input, "token").unwrap_or_default())?;
    if procedure == "extension.device.logout" {
        let token = s(input, "token").unwrap_or_default();
        if let Some(t) = state.tokens.lock().access.get_mut(&token) {
            t.1 = false;
        }
        return Ok(json!({ "success": true }));
    }
    let repo = &state.repo;
    let data = input.get("data");
    let r = match procedure {
        "extension.listOrganizations" => Ok(json!([
            { "id": MOCK_ORG_ID, "name": "Acme", "role": "owner" },
            { "id": "org-2", "name": "Spejderne", "role": "member" },
        ])),
        "extension.entitlements.get" if state.entitlements.lock().is_some() => {
            Ok(state.entitlements.lock().clone().unwrap_or_default())
        }
        "extension.entitlements.get" => Ok(json!({
            "organizationId": s(input, "organizationId"),
            "role": "owner",
            "plan": { "tier": "solo", "name": "Selvstændig", "status": "active", "isFree": false },
            "limits": { "maxActiveClients": null },
            "features": {
                "timeTracking": true, "clients": true, "canAddActiveClient": true, "projects": true,
                "tasks": true, "invoices": true, "klippekort": true, "reports": true
            }
        })),

        // kunder
        "extension.clients.list" => {
            val(block_on(repo.list_clients(input.get("includeArchived").and_then(Value::as_bool).unwrap_or(false)))?)
        }
        "extension.clients.get" => val(block_on(repo.get_client(&id(input)?))?),
        "extension.clients.create" => val(block_on(repo.create_client(parse(data)?))?),
        // Web's clients.update erstatter hele kunden og kræver name.
        "extension.clients.update" => {
            require_name(data)?;
            let d = data.cloned().unwrap_or_default();
            let mut p: ClientPatch = parse(Some(&d))?;
            // Som web: tekstfelter, der ikke sendes, bliver tomme.
            let blank = |k: &str| Some(s(&d, k).unwrap_or_default());
            p.email = blank("email");
            p.phone = blank("phone");
            p.company = blank("company");
            p.cvr_number = blank("cvrNumber");
            p.notes = blank("notes");
            // `defaultHourlyRate || null`: udeladt eller "" fjerner satsen.
            p.default_hourly_rate = Some(money(&d, "defaultHourlyRate"));
            val(block_on(repo.update_client(&id(input)?, p))?)
        }
        "extension.clients.archive" => {
            block_on(repo.archive_client(&id(input)?))?;
            Ok(json!({ "success": true }))
        }
        "extension.clients.unarchive" => {
            block_on(repo.unarchive_client(&id(input)?))?;
            Ok(json!({ "success": true }))
        }

        // projekter
        "extension.projects.list" => val(block_on(repo.list_projects(true))?),
        "extension.projects.get" => val(block_on(repo.get_project(&id(input)?))?),
        "extension.projects.create" => val(block_on(repo.create_project(parse(data)?))?),
        // Web's projects.update erstatter hele projektet: name påkrævet,
        // manglende status bliver "active".
        "extension.projects.update" => {
            require_name(data)?;
            let pid = id(input)?;
            let d = data.cloned().unwrap_or_default();
            let mut p: ProjectPatch = parse(Some(&d))?;
            // Som web: manglende kunde fjernes, manglende beskrivelse tømmes.
            p.client_id = Some(s(&d, "clientId"));
            p.description = Some(s(&d, "description").unwrap_or_default());
            // `hourlyRate || null`, `budgetHours || null`.
            p.hourly_rate = Some(money(&d, "hourlyRate"));
            p.budget_hours = Some(money(&d, "budgetHours"));
            block_on(repo.update_project(&pid, p))?;
            let status = data.and_then(|d| s(d, "status")).unwrap_or_else(|| "active".into());
            block_on(repo.set_project_status(&pid, ProjectStatus::parse(&status)))?;
            val(block_on(repo.get_project(&pid))?)
        }
        "extension.projects.setStatus" => {
            let status = ProjectStatus::parse(&s(input, "status").unwrap_or_default());
            val(block_on(repo.set_project_status(&id(input)?, status))?)
        }
        "extension.projects.archive" => {
            block_on(repo.archive_project(&id(input)?))?;
            Ok(json!({ "success": true }))
        }

        // klippekort
        "extension.getPrepaidPackages" => {
            let pkgs = block_on(repo.list_klippekort(None, false))?;
            Ok(Value::Array(
                pkgs.into_iter()
                    .map(|p| {
                        json!({
                            "id": p.id, "clientId": p.client_id, "clientName": "", "name": p.name,
                            "totalHours": p.total_hours.to_string().parse::<f64>().unwrap_or(0.0),
                            "usedHours": p.used_hours.to_string().parse::<f64>().unwrap_or(0.0),
                            "remainingHours": p.remaining_hours.to_string().parse::<f64>().unwrap_or(0.0),
                            "expiresAt": p.expiry_date, "purchasedAt": p.purchase_date,
                            "isActive": true, "autoDeduct": p.auto_deduct, "clipSizeMinutes": p.clip_size_minutes,
                        })
                    })
                    .collect(),
            ))
        }
        // Web's prepaid.list: { filter?: { clientId?, activeOnly?, includeArchived? } }.
        "extension.klippekort.list" => {
            let f = input.get("filter").cloned().unwrap_or(json!({}));
            let flag = |k: &str| f.get(k).and_then(Value::as_bool).unwrap_or(false);
            let pkgs = block_on(repo.list_klippekort(s(&f, "clientId").as_deref(), true))?;
            let rows: Vec<Value> = pkgs
                .into_iter()
                .filter(|p| flag("includeArchived") || !p.is_archived.unwrap_or(false))
                .filter(|p| !flag("activeOnly") || p.is_active)
                .map(|p| prepaid_row(repo, &p))
                .collect();
            Ok(Value::Array(rows))
        }
        "extension.klippekort.get" => {
            let pid = id(input)?;
            let p = block_on(repo.list_klippekort(None, true))?
                .into_iter()
                .find(|p| p.id == pid)
                .ok_or(DataError::NotFound)?;
            let mut v = prepaid_row(repo, &p);
            v["usageHistory"] = usage_rows(repo, &pid)?;
            Ok(v)
        }
        "extension.klippekort.create" => val(block_on(repo.create_klippekort(parse(data)?))?),
        // Web's prepaid.update: hele prepaidPackageInput (name, clientId,
        // totalHours, hourlyRate og purchaseDate påkrævede). Manglende
        // expiryDate/description/clipSizeMinutes ryddes.
        "extension.klippekort.update" => {
            let d = data.cloned().ok_or_else(|| DataError::Validation("data: Required".into()))?;
            for k in ["name", "clientId", "totalHours", "hourlyRate", "purchaseDate"] {
                if d.get(k).is_none_or(Value::is_null) {
                    return Err(DataError::Validation(format!("{k}: Required")));
                }
            }
            let num = |k: &str| d.get(k).and_then(Value::as_f64).and_then(rust_decimal::Decimal::from_f64_retain).map(|x| x.round_dp(2));
            let patch = PrepaidPackagePatch {
                name: s(&d, "name"),
                client_id: s(&d, "clientId"),
                total_hours: num("totalHours"),
                hourly_rate: num("hourlyRate"),
                purchase_date: s(&d, "purchaseDate"),
                expiry_date: Some(s(&d, "expiryDate").filter(|x| !x.is_empty())),
                description: Some(s(&d, "description").filter(|x| !x.is_empty())),
                clip_size_minutes: Some(d.get("clipSizeMinutes").and_then(Value::as_i64).map(|m| m as i32)),
                overdraft_policy: s(&d, "overdraftPolicy"),
                auto_deduct: d.get("autoDeduct").and_then(Value::as_bool),
            };
            let p = block_on(repo.update_klippekort(&id(input)?, patch))?;
            Ok(prepaid_row(repo, &p))
        }
        "extension.klippekort.topUp" => {
            let hours = input
                .get("hours")
                .and_then(Value::as_f64)
                .and_then(rust_decimal::Decimal::from_f64_retain)
                .ok_or_else(|| DataError::Validation("hours: Required".into()))?;
            let p = block_on(repo.top_up_klippekort(&id(input)?, hours.round_dp(2), s(input, "note")))?;
            Ok(prepaid_row(repo, &p))
        }
        // Web's prepaid.archive SKIFTER arkiveret ↔ ikke arkiveret.
        "extension.klippekort.archive" => {
            let pid = id(input)?;
            let p = block_on(repo.list_klippekort(None, true))?
                .into_iter()
                .find(|p| p.id == pid)
                .ok_or(DataError::NotFound)?;
            let archived = !p.is_archived.unwrap_or(false);
            if archived {
                block_on(repo.archive_klippekort(&pid))?;
            } else {
                repo.run_sync(|c| {
                    c.execute("UPDATE prepaid_packages SET is_archived = 0 WHERE id = ?1", [&pid])?;
                    Ok(())
                })?;
            }
            Ok(json!({ "success": true, "isArchived": archived }))
        }

        // poster
        "extension.entries.list" => {
            let f = input.get("filter").cloned().unwrap_or(json!({}));
            let date = |k: &str| s(&f, k).and_then(|d| serde_util::parse_entry_date(&d));
            let filter = EntryFilter {
                start_date: date("startDate"),
                end_date: date("endDate"),
                client_id: s(&f, "clientId"),
                project_id: s(&f, "projectId"),
                task_id: s(&f, "taskId"),
                is_billed: f.get("isBilled").and_then(Value::as_bool),
                untimed: None,
            };
            let entries = block_on(repo.list_entries(filter))?;
            Ok(json!({ "entries": entries, "hasMore": false }))
        }
        "extension.entries.get" => val(block_on(repo.get_entry(&id(input)?))?),
        "extension.entries.create" => {
            if data.and_then(|d| s(d, "description")).is_none_or(|d| d.is_empty()) {
                return Err(DataError::Validation("description: String must contain at least 1 character(s)".into()));
            }
            // Web's "intet klippekort" (feat/desktop-api-3).
            if data.and_then(|d| d.get("noPrepaid")).and_then(Value::as_bool) == Some(true)
                && data.and_then(|d| s(d, "prepaidPackageId")).is_some()
            {
                return Err(DataError::Validation("Vælg enten et klippekort eller intet klippekort".into()));
            }
            created(block_on(repo.create_entry(parse(data)?))?)
        }
        "extension.entries.update" => {
            let mut v = val(block_on(repo.update_entry(&id(input)?, entry_put(data)?))?)?;
            v["complianceWarnings"] = json!([]);
            Ok(v)
        }
        "extension.entries.delete" => {
            block_on(repo.delete_entry(&id(input)?))?;
            Ok(json!({ "success": true }))
        }

        // timer
        "extension.getTimerStateWithVersion" | "extension.getTimerState" => {
            let t = state.timer.lock().state.clone();
            Ok(timer_with_refs(state, &t))
        }
        "extension.updateTimerState" => update_timer(state, input),
        // Web's timer.setTarget: updateTimerState's metadata-skrivning med
        // sessionen som prædikat; et udeladt taskId rydder opgaven.
        "extension.timer.setTarget" => {
            if s(input, "sessionId").is_none() {
                return Err(DataError::Validation("sessionId: Required".into()));
            }
            let mut w = json!({
                "sessionId": input["sessionId"],
                "projectId": input.get("projectId").cloned().unwrap_or(Value::Null),
                "clientId": input.get("clientId").cloned().unwrap_or(Value::Null),
                "taskId": input.get("taskId").cloned().unwrap_or(Value::Null),
            });
            if let Some(v) = input.get("expectedVersion") {
                w["expectedVersion"] = v.clone();
            }
            update_timer(state, &w)
        }
        "extension.claimForStop" => claim(state, input),
        "extension.confirmStop" => finish_stop(state, input, true),
        "extension.cancelStop" => finish_stop(state, input, false),
        "extension.setPrepaidChoice" => {
            let mut row = state.timer.lock();
            if !row.state.is_active() || s(input, "clientId").is_none() {
                return Ok(json!({ "success": false, "reason": "not_active" }));
            }
            let choice = input.get("choice").cloned().unwrap_or_default();
            row.state.prepaid_choice = match choice.get("mode").and_then(Value::as_str) {
                Some("auto") | None => None,
                _ => serde_json::from_value(choice).ok(),
            };
            // Som web: valget bumper ikke versionen.
            Ok(json!({ "success": true }))
        }

        // opgaver
        "extension.tasks.list" => {
            let f = input.get("filter").cloned().unwrap_or(json!({}));
            let filter = TaskFilter {
                status: s(&f, "status").map(|x| TaskStatus::parse(&x)),
                project_id: s(&f, "projectId"),
                client_id: s(&f, "clientId"),
            };
            let lanes = state.task_lanes.lock().clone();
            let mut rows = block_on(repo.list_tasks(filter))?;
            for t in &mut rows {
                if let Some(l) = lanes.get(&t.id) {
                    t.status_id = Some(l.clone());
                }
            }
            val(rows)
        }
        "extension.tasks.statuses" => val(state.lanes.lock().clone()),
        "extension.tasks.move" => {
            let m: MoveTask = parse(data)?;
            let lane = state.lanes.lock().iter().find(|l| l.id == m.status_id).cloned().ok_or(DataError::NotFound)?;
            let current = block_on(repo.list_tasks(TaskFilter::default()))?
                .into_iter()
                .find(|t| t.id == m.task_id)
                .ok_or(DataError::NotFound)?
                .status;
            // Som web's legacyStatusForLane (forenklet).
            let status = match (lane.category.as_deref(), lane.name.as_str()) {
                (Some("in_progress"), _) => TaskStatus::InProgress,
                (Some("done" | "cancelled"), _) => TaskStatus::Done,
                (_, "Backlog") => TaskStatus::Backlog,
                _ if matches!(current, TaskStatus::Backlog | TaskStatus::Todo) => current,
                _ => TaskStatus::Todo,
            };
            block_on(repo.set_task_status(&m.task_id, status))?;
            state.task_lanes.lock().insert(m.task_id, m.status_id);
            Ok(json!({ "ok": true, "status": status.as_str() }))
        }
        "extension.tasks.create" => val(block_on(repo.create_task(parse(data)?))?),
        "extension.tasks.update" => {
            let d = data.cloned().unwrap_or_default();
            val(block_on(repo.update_task(&id(&d)?, parse(Some(&d))?))?)
        }
        "extension.tasks.setStatus" => {
            let status = TaskStatus::parse(&s(input, "status").unwrap_or_default());
            val(block_on(repo.set_task_status(&id(input)?, status))?)
        }

        // fakturaer
        "extension.invoices.list" => {
            let rows: Vec<Value> = block_on(repo.list_invoices())?
                .into_iter()
                .map(|inv| {
                    let mut v = serde_json::to_value(&inv).unwrap_or_default();
                    let client = block_on(repo.get_client(&inv.client_id)).ok();
                    v["client"] = json!(client.map(|c| json!({ "id": c.id, "name": c.name, "company": c.company, "email": c.email })));
                    v
                })
                .collect();
            Ok(Value::Array(rows))
        }
        "extension.invoices.get" => val(block_on(repo.get_invoice(&id(input)?))?),
        "extension.invoices.uninvoicedSummary" => {
            let rows = block_on(repo.uninvoiced_summary())?;
            Ok(Value::Array(
                rows.into_iter()
                    .map(|r| {
                        json!({
                            "client": { "id": r.client_id, "name": r.client_name },
                            "entryCount": r.entry_count,
                            "totalHours": r.hours.to_string().parse::<f64>().unwrap_or(0.0),
                            "totalAmount": r.amount.to_string().parse::<f64>().unwrap_or(0.0),
                        })
                    })
                    .collect(),
            ))
        }
        "extension.invoices.uninvoicedEntries" => {
            val(block_on(repo.uninvoiced_entries(&s(input, "clientId").unwrap_or_default()))?)
        }
        "extension.invoices.createDraft" => {
            let d = data.cloned().unwrap_or_default();
            let draft = NewInvoiceDraft {
                client_id: s(&d, "clientId").unwrap_or_default(),
                time_entry_ids: parse(d.get("timeEntryIds"))?,
                notes: s(&d, "notes"),
                due_date: s(&d, "dueDate").and_then(|x| NaiveDate::parse_from_str(&x, "%Y-%m-%d").ok()),
            };
            // Web's generateFromTimeEntries svarer med { invoice, lineItems,
            // totalAmount, lines } og opretter én linje pr. post.
            let inv = block_on(repo.create_invoice_draft(draft))?;
            let total = inv.amount.to_string().parse::<f64>().unwrap_or(0.0);
            let lines = line_rows(&inv.id, block_on(repo.invoice_lines(&inv.id))?);
            Ok(json!({ "invoice": inv, "lineItems": [], "totalAmount": total, "lines": lines }))
        }
        "extension.invoices.lines" => {
            let iid = id(input)?;
            Ok(line_rows(&iid, block_on(repo.invoice_lines(&iid))?))
        }
        // Web's linesByInvoice: { ids } (højst 500) → { fakturaId: linjer }.
        "extension.invoices.linesByInvoice" => {
            let ids: Vec<String> = parse(input.get("ids"))?;
            if ids.len() > 500 {
                return Err(DataError::Validation("ids: Array must contain at most 500 element(s)".into()));
            }
            let mut out = serde_json::Map::new();
            for iid in ids {
                if let Ok(lines) = block_on(repo.invoice_lines(&iid)) {
                    out.insert(iid.clone(), line_rows(&iid, lines));
                }
            }
            Ok(Value::Object(out))
        }
        "extension.invoices.saveLines" => {
            let d = data.cloned().unwrap_or_default();
            block_on(repo.save_invoice_lines(&s(&d, "invoiceId").unwrap_or_default(), parse(d.get("lines"))?))?;
            Ok(json!({ "success": true }))
        }
        "extension.invoices.send" => {
            block_on(repo.send_invoice(&id(input)?))?;
            Ok(json!({ "success": true }))
        }
        "extension.invoices.update" => {
            // Som web's invoices.update: kun de felter, der er sendt.
            let d = data.cloned().unwrap_or_default();
            let id = s(&d, "id").unwrap_or_default();
            let cur = block_on(repo.get_invoice(&id))?;
            let due = s(&d, "dueDate")
                .and_then(|x| NaiveDate::parse_from_str(&x, "%Y-%m-%d").ok())
                .or(cur.due_date.map(|d| d.date_naive()))
                .unwrap_or_else(|| chrono::Utc::now().date_naive());
            let notes = if d.get("notes").is_some() { s(&d, "notes") } else { cur.notes.clone() };
            val(block_on(repo.update_invoice_details(&id, cur.title.clone(), due, notes))?)
        }
        "extension.invoices.markPaid" => {
            let paid = s(input, "paidDate").and_then(|x| NaiveDate::parse_from_str(&x, "%Y-%m-%d").ok());
            val(block_on(repo.mark_invoice_paid(&id(input)?, paid))?)
        }

        // regler
        "extension.getUrlPatterns" => {
            // Som web: kun aktive projekter.
            let projects = block_on(repo.list_projects(false))?;
            Ok(Value::Array(
                projects
                    .into_iter()
                    .filter(|p| p.status == ProjectStatus::Active)
                    .map(|p| json!({ "projectId": p.id, "projectName": p.name, "clientName": null, "patterns": p.url_patterns }))
                    .collect(),
            ))
        }
        "extension.rules.getMatchingRules" => {
            let projects = block_on(repo.list_projects(false))?;
            let patterns: Vec<Value> = projects
                .iter()
                .filter(|p| p.status == ProjectStatus::Active && !p.url_patterns.is_empty())
                .map(|p| {
                    json!({ "projectId": p.id, "projectName": p.name, "clientId": p.client_id,
                            "clientName": null, "patterns": p.url_patterns })
                })
                .collect();
            let rules: Vec<Value> = block_on(repo.matching_rules())?
                .into_iter()
                .filter(|r| r.source != RuleSource::Project)
                .map(|r| {
                    json!({ "id": r.id, "kind": crate::cloud::wire::rule_kind_to_web(r.kind), "pattern": r.pattern,
                            "projectId": r.project_id, "clientId": r.client_id, "notWork": r.not_work, "source": "desktop",
                            "usageCount": r.confirmations, "lastUsedAt": r.updated_at, "deletedAt": null,
                            "updatedAt": r.updated_at })
                })
                .collect();
            Ok(json!({ "serverTime": Utc::now().to_rfc3339(), "projectPatterns": patterns, "rules": rules }))
        }
        "extension.rules.upsert" => {
            let items = input.get("rules").and_then(Value::as_array).cloned().unwrap_or_default();
            if items.is_empty() || items.len() > 500 {
                return Err(DataError::Validation("rules: 1-500".into()));
            }
            // zod først (hele kaldet afvises), så skrivningerne.
            let rules = items
                .iter()
                .map(|r| rule_from_web(r, s(r, "projectId"), s(r, "clientId")))
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let mut ids = Vec::new();
            for rule in rules {
                ids.push(upsert_web_rule(repo, rule)?);
            }
            Ok(json!({ "upserted": ids.len(), "ids": ids }))
        }
        // Udvidelsens site-koblinger: domæne-reglerne uden "ikke arbejde".
        "extension.siteMappings.list" => {
            let mut rows: Vec<MatchingRule> = block_on(repo.matching_rules())?
                .into_iter()
                .filter(|r| r.source != RuleSource::Project && r.kind == RuleKind::Domain && !r.not_work)
                .collect();
            rows.sort_by(|a, b| a.pattern.cmp(&b.pattern));
            Ok(Value::Array(
                rows.into_iter()
                    .map(|r| {
                        json!({ "domain": r.pattern, "projectId": r.project_id, "clientId": r.client_id,
                                "usageCount": r.confirmations, "lastUsed": r.updated_at.map(|t| t.to_rfc3339()) })
                    })
                    .collect(),
            ))
        }
        // Lærte mønstre: { since? } → { serverTime, patterns: [{ key, votes, updatedAt }] }.
        "extension.patterns.list" => {
            let since = s(input, "since")
                .map(|x| DateTime::parse_from_rfc3339(&x).map_err(|_| DataError::Validation("since: Invalid datetime".into())))
                .transpose()?
                .map(|t| t.with_timezone(&Utc) - chrono::Duration::seconds(60));
            let rows: Vec<Value> = state
                .patterns
                .lock()
                .iter()
                .filter(|r| {
                    since.is_none_or(|s| {
                        r["updatedAt"].as_str().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).is_some_and(|t| t >= s)
                    })
                })
                .cloned()
                .collect();
            Ok(json!({ "serverTime": Utc::now().to_rfc3339(), "patterns": rows }))
        }
        "extension.patterns.upsert" => patterns_upsert(state, input),
        "extension.rules.remove" => {
            let ids: Vec<String> = parse(input.get("ids"))?;
            let mut removed = 0;
            for rid in ids {
                if block_on(repo.delete_rule(&rid)).is_ok() {
                    removed += 1;
                }
            }
            Ok(json!({ "removed": removed }))
        }
        "extension.import.run" => import(state, input),

        _ => Err(no_procedure(procedure)),
    };
    if r.is_ok() {
        notify(state, procedure);
    }
    r
}

/// Web's `ruleInput`: `kind`, `pattern` (1-500 tegn) og et mål (projekt
/// og/eller kunde) ELLER `notWork` ("ikke arbejde"), aldrig begge. Domæner
/// gemmes uden store bogstaver og "www.". Uden kunde arves projektets.
fn rule_from_web(r: &Value, project_id: Option<String>, client_id: Option<String>) -> std::result::Result<MatchingRule, DataError> {
    let kind = crate::cloud::wire::rule_kind_from_web(&s(r, "kind").unwrap_or_default())
        .ok_or_else(|| DataError::Validation("kind: Invalid enum value".into()))?;
    let pattern = s(r, "pattern").unwrap_or_default().trim().to_owned();
    if pattern.is_empty() || pattern.chars().count() > 500 {
        return Err(DataError::Validation("pattern: 1-500 tegn".into()));
    }
    let not_work = r.get("notWork").and_then(Value::as_bool).unwrap_or(false);
    let has_target = project_id.is_some() || client_id.is_some();
    if not_work && has_target {
        return Err(DataError::Validation("En ikke-arbejde-regel peger ikke på et projekt eller en kunde".into()));
    }
    if !not_work && !has_target {
        return Err(DataError::Validation("En regel skal pege på et projekt eller en kunde".into()));
    }
    let pattern = if kind == RuleKind::Domain {
        let p = pattern.to_lowercase();
        p.strip_prefix("www.").map(str::to_owned).unwrap_or(p)
    } else {
        pattern
    };
    Ok(MatchingRule {
        id: String::new(),
        kind,
        pattern,
        project_id,
        client_id,
        source: RuleSource::Learned,
        confirmations: r.get("usageCount").and_then(Value::as_i64).unwrap_or(0),
        not_work,
        updated_at: Some(Utc::now()),
    })
}

/// Web's `upsertDeviceRules`: idempotent pr. type og mønster; brugen tæller
/// op (`greatest`). Projekter og kunder skal findes.
fn upsert_web_rule(repo: &LocalRepo, mut rule: MatchingRule) -> std::result::Result<String, DataError> {
    if let Some(pid) = &rule.project_id {
        let p = block_on(repo.get_project(pid)).map_err(|_| not_found("Projekt eller kunde ikke fundet"))?;
        if rule.client_id.is_none() {
            rule.client_id = p.client_id;
        }
    }
    if let Some(cid) = &rule.client_id {
        block_on(repo.get_client(cid)).map_err(|_| not_found("Projekt eller kunde ikke fundet"))?;
    }
    let existing = block_on(repo.matching_rules())?
        .into_iter()
        .find(|x| x.source != RuleSource::Project && x.kind == rule.kind && x.pattern == rule.pattern);
    if let Some(x) = existing {
        rule.id = x.id;
        rule.confirmations = rule.confirmations.max(x.confirmations);
    }
    Ok(block_on(repo.upsert_rule(rule))?.id)
}

fn not_found(message: &str) -> DataError {
    DataError::Rejected { code: "NOT_FOUND".into(), message: message.into(), app_code: None, status: 404 }
}

/// Web's mønsternøgle (`patternKey`): kind + de felter, typen kræver.
fn valid_pattern_key(key: &Value) -> bool {
    let has = |k: &str| key.get(k).and_then(Value::as_str).is_some_and(|v| !v.is_empty() && v.chars().count() <= 500);
    match key.get("kind").and_then(Value::as_str) {
        Some("repo") => has("remote"),
        Some("path") => has("path"),
        Some("domain") => has("domain"),
        Some("appKeyword") => has("app") && has("keyword"),
        Some("titleTemplate") => has("app") && has("template"),
        _ => false,
    }
}

/// Web's `extension.patterns.upsert({ patterns })`: 1-500 mønstre, højst 50
/// stemmer pr. mønster, mål i org'en. Erstatter pr. nøgle (sidste vinder).
fn patterns_upsert(state: &State, input: &Value) -> Res {
    let items = input.get("patterns").and_then(Value::as_array).cloned().unwrap_or_default();
    if items.is_empty() || items.len() > 500 {
        return Err(DataError::Validation("patterns: 1-500".into()));
    }
    for p in &items {
        if !p.get("key").is_some_and(valid_pattern_key) {
            return Err(DataError::Validation("key: Invalid discriminator value".into()));
        }
        let votes = p.get("votes").and_then(Value::as_array).ok_or_else(|| DataError::Validation("votes: Required".into()))?;
        if votes.len() > 50 {
            return Err(DataError::Validation("votes: højst 50".into()));
        }
        for v in votes {
            if v.get("weight").and_then(Value::as_f64).is_none_or(|w| !(0.0..=1_000_000.0).contains(&w)) {
                return Err(DataError::Validation("weight: Required".into()));
            }
            let target = v.get("target").cloned().unwrap_or_default();
            if let Some(pid) = s(&target, "projectId") {
                block_on(state.repo.get_project(&pid)).map_err(|_| not_found("Projekt eller kunde ikke fundet"))?;
            }
            if let Some(cid) = s(&target, "clientId") {
                block_on(state.repo.get_client(&cid)).map_err(|_| not_found("Projekt eller kunde ikke fundet"))?;
            }
        }
    }
    let now = Utc::now().to_rfc3339();
    let mut keys: Vec<Value> = Vec::new();
    let mut rows = state.patterns.lock();
    for p in items {
        let key = p["key"].clone();
        rows.retain(|r| r["key"] != key);
        rows.push(json!({ "key": key, "votes": normalize_votes(&p["votes"]), "updatedAt": now }));
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    let n = keys.len();
    drop(rows);
    publish(state, "data", json!({ "type": "data", "entities": ["rules"] }));
    Ok(json!({ "upserted": n }))
}

/// Stemmerne, som web's zod-skema gemmer dem: kun kendte felter, tællere
/// med standard 0, et mål med de id'er, der er sat.
fn normalize_votes(votes: &Value) -> Value {
    let list = votes.as_array().cloned().unwrap_or_default();
    Value::Array(
        list.iter()
            .map(|v| {
                let mut target = serde_json::Map::new();
                for f in ["clientId", "projectId"] {
                    if let Some(x) = v["target"].get(f) {
                        target.insert(f.into(), x.clone());
                    }
                }
                let count = |f: &str| v.get(f).and_then(Value::as_u64).unwrap_or(0);
                json!({
                    "target": target,
                    "weight": v["weight"],
                    "confirmations": count("confirmations"),
                    "corrections": count("corrections"),
                    "aiAnswers": count("aiAnswers"),
                })
            })
            .collect(),
    )
}

/// Web's `clientInput`/`projectInput` kræver `name` (mindst 2 tegn).
fn require_name(data: Option<&Value>) -> std::result::Result<(), DataError> {
    match data.and_then(|d| s(d, "name")) {
        Some(n) if n.chars().count() >= 2 => Ok(()),
        _ => Err(DataError::Validation("name: Required".into())),
    }
}

/// Web's time.update er en fuld erstatning: description, hours og date er
/// påkrævede; manglende projectId/clientId/taskId ryddes; null afvises
/// (felterne er ikke nullable). Undtagelsen er `startTime`/`endTime`:
/// udeladt = uændret, null = fjern tidspunktet.
fn entry_put(data: Option<&Value>) -> std::result::Result<TimeEntryPatch, DataError> {
    let d = data.cloned().unwrap_or(json!({}));
    for k in ["description", "hours", "date"] {
        if d.get(k).is_none_or(Value::is_null) {
            return Err(DataError::Validation(format!("{k}: Required")));
        }
    }
    for k in ["projectId", "clientId", "taskId", "notes"] {
        if d.get(k).is_some_and(Value::is_null) {
            return Err(DataError::Validation(format!("{k}: Expected string, received null")));
        }
    }
    let mut p: TimeEntryPatch = parse(Some(&d))?;
    p.project_id = Some(s(&d, "projectId"));
    p.client_id = Some(s(&d, "clientId"));
    p.task_id = Some(s(&d, "taskId"));
    Ok(p)
}

/// En række fra web's prepaid.list (+ `client` og `hideValue`).
fn prepaid_row(repo: &LocalRepo, p: &PrepaidPackage) -> Value {
    let mut v = serde_json::to_value(p).unwrap_or_default();
    v["client"] = json!(block_on(repo.get_client(&p.client_id)).ok());
    v["hideValue"] = json!(false);
    v
}

/// Web's `usageHistory` på prepaid.getById: usage-rækkerne (decimaler som
/// strenge, nyeste først) med `timeEntry` (hele posten, dato som UTC-midnat)
/// eller null.
fn usage_rows(repo: &LocalRepo, package_id: &str) -> Res {
    let mut rows = vec![];
    for u in repo.usage_history(package_id)? {
        let mut v = serde_json::to_value(&u)?;
        v["prepaidPackageId"] = json!(package_id);
        v["timeEntry"] = match u.time_entry_id.as_deref().map(|e| block_on(repo.get_entry(e))) {
            Some(Ok(e)) => {
                let mut ev = serde_json::to_value(&e)?;
                ev["date"] = json!(format!("{}T00:00:00.000Z", e.date.format("%Y-%m-%d")));
                ev["project"] = Value::Null;
                ev
            }
            _ => Value::Null,
        };
        rows.push(v);
    }
    Ok(Value::Array(rows))
}

/// Linjerne som web's `invoice_lines`-rækker (decimaler som strenge, med
/// `invoiceId`, `taskId` og `createdAt`).
fn line_rows(invoice_id: &str, lines: Vec<InvoiceLine>) -> Value {
    Value::Array(
        lines
            .into_iter()
            .map(|l| {
                let mut v = serde_json::to_value(&l).unwrap_or_default();
                v["invoiceId"] = json!(invoice_id);
                v["taskId"] = Value::Null;
                v["createdAt"] = json!(Utc::now().to_rfc3339());
                v
            })
            .collect(),
    )
}

/// Web's `x || null` på en beløbsstreng: udeladt eller "" giver None.
fn money(d: &Value, key: &str) -> Option<rust_decimal::Decimal> {
    match d.get(key) {
        Some(Value::String(x)) if !x.trim().is_empty() => x.parse().ok(),
        Some(Value::Number(n)) => n.to_string().parse().ok(),
        _ => None,
    }
}

/// tRPC's svar på en procedure, der ikke findes.
fn no_procedure(procedure: &str) -> DataError {
    DataError::Rejected {
        code: "NOT_FOUND".into(),
        message: format!("No procedure found on path \"{procedure}\""),
        app_code: None,
        status: 404,
    }
}

/// Web's time.create: rækken + `prepaidDeduction` (tal, ingen
/// `overflowedToInvoice`; null ved overtræk til faktura), `complianceWarnings`
/// og `deduplicated`.
fn created(c: CreatedEntry) -> Res {
    let mut v = serde_json::to_value(&c.entry)?;
    let num = |d: rust_decimal::Decimal| d.to_string().parse::<f64>().unwrap_or(0.0);
    v["prepaidDeduction"] = match c.prepaid_deduction.filter(|d| !d.overflowed_to_invoice) {
        Some(d) => json!({
            "packageName": d.package_name,
            "remainingHours": num(d.remaining_hours),
            "totalHours": num(d.total_hours),
            "hoursDeducted": num(d.hours_deducted),
        }),
        None => Value::Null,
    };
    v["complianceWarnings"] = json!([]);
    v["deduplicated"] = json!(c.deduplicated);
    Ok(v)
}

/// Som web's publishDataChanged efter en skrivning.
fn notify(state: &State, procedure: &str) {
    let entity = match procedure.split('.').nth(1).unwrap_or("") {
        "clients" => "clients",
        "projects" => "projects",
        "entries" => "entries",
        "tasks" => "tasks",
        "invoices" => "invoices",
        "klippekort" => "klippekort",
        "rules" => "rules",
        _ => return,
    };
    let write = !["list", "get", "lines", "uninvoicedSummary", "uninvoicedEntries", "getMatchingRules"]
        .contains(&procedure.rsplit('.').next().unwrap_or(""));
    if write {
        publish(state, "data", json!({ "type": "data", "entities": [entity] }));
    }
}

fn timer_event(state: &State, event: &str, version: i64) {
    publish(state, "timer", json!({ "type": "timer", "event": event, "version": version }));
}

fn update_timer(state: &State, input: &Value) -> Res {
    check_task(state, input)?;
    let mut row = state.timer.lock();
    let fresh = input.get("isFreshStart").and_then(Value::as_bool) == Some(true)
        && input.get("isRunning").and_then(Value::as_bool) == Some(true);
    let op = s(input, "clientOpId");
    if fresh {
        if op.is_some() && op == row.last_client_op_id {
            let mut v = timer_json(&row.state);
            v["deduplicated"] = json!(true);
            return Ok(v);
        }
        let reject = if row.state.is_running || row.state.intent.as_deref() == Some("stopping") {
            Some("already_running")
        } else if row.state.base_seconds > 0 {
            Some("paused_session")
        } else {
            None
        };
        if let Some(reason) = reject {
            let mut v = timer_json(&row.state);
            v["startRejected"] = json!(reason);
            return Ok(v);
        }
        let version = row.state.version + 1;
        row.state = TimerState {
            is_running: true,
            start_time: s(input, "startTime").and_then(|t| DateTime::parse_from_rfc3339(&t).ok()).map(|t| t.with_timezone(&Utc)),
            project_id: s(input, "projectId"),
            client_id: s(input, "clientId"),
            // En frisk start uden taskId starter uden opgave.
            task_id: s(input, "taskId"),
            description: s(input, "description").unwrap_or_default(),
            session_id: Some(Uuid::new_v4().to_string()),
            version,
            ..TimerState::default()
        };
        row.last_client_op_id = op;
    } else {
        if let Some(sid) = s(input, "sessionId")
            && Some(&sid) != row.state.session_id.as_ref()
        {
            let mut v = timer_json(&row.state);
            v["sessionMismatch"] = json!(true);
            return Ok(v);
        }
        if let Some(ev) = input.get("expectedVersion").and_then(Value::as_i64)
            && ev != row.state.version
        {
            return Ok(timer_json(&row.state));
        }
        let t = &mut row.state;
        if let Some(b) = input.get("isRunning").and_then(Value::as_bool) {
            t.is_running = b;
        }
        if let Some(v) = input.get("startTime") {
            t.start_time = v.as_str().and_then(|x| DateTime::parse_from_rfc3339(x).ok()).map(|x| x.with_timezone(&Utc));
        }
        if let Some(b) = input.get("baseSeconds").and_then(Value::as_i64) {
            t.base_seconds = b;
        }
        if let Some(b) = input.get("elapsedSeconds").and_then(Value::as_i64) {
            t.elapsed_seconds = b;
        }
        if let Some(d) = s(input, "description") {
            t.description = d;
        }
        // Som web: projectId/clientId opdateres, når de sendes (null rydder).
        if let Some(v) = input.get("projectId") {
            t.project_id = v.as_str().map(str::to_owned);
        }
        if let Some(v) = input.get("clientId") {
            t.client_id = v.as_str().map(str::to_owned);
        }
        // Udeladt = uændret, null = ingen opgave.
        if let Some(v) = input.get("taskId") {
            t.task_id = v.as_str().map(str::to_owned);
        }
        t.version += 1;
    }
    let version = row.state.version;
    let mut v = timer_json(&row.state);
    // updateTimerState's svar har ikke klippekort-valget.
    if let Some(o) = v.as_object_mut() {
        o.remove("prepaidChoice");
    }
    drop(row);
    timer_event(state, "sync", version);
    Ok(v)
}

fn claim(state: &State, input: &Value) -> Res {
    let mut row = state.timer.lock();
    let t = &mut row.state;
    let expected = input.get("expectedVersion").and_then(Value::as_i64).unwrap_or(-1);
    let fail = |reason: &str, v: i64| Ok(json!({ "success": false, "reason": reason, "version": v }));
    if expected != t.version {
        return fail("version_mismatch", t.version);
    }
    if t.intent.as_deref() == Some("stopping") {
        return fail("already_stopping", t.version);
    }
    if !t.is_active() {
        return fail("not_running", t.version);
    }
    if let Some(sid) = s(input, "sessionId")
        && Some(&sid) != t.session_id.as_ref()
    {
        return fail("session_mismatch", t.version);
    }
    t.intent = Some("stopping".into());
    t.version += 1;
    let out = json!({
        "success": true,
        "version": t.version,
        "sessionId": t.session_id,
        "prepaidChoice": t.prepaid_choice,
        "session": {
            "id": t.session_id, "projectId": t.project_id, "clientId": t.client_id,
            "taskId": t.task_id, "description": t.description,
            "startedAt": t.start_time.map(|s| s.to_rfc3339()),
        }
    });
    let version = t.version;
    drop(row);
    timer_event(state, "stopping", version);
    Ok(out)
}

fn finish_stop(state: &State, input: &Value, confirm: bool) -> Res {
    let mut row = state.timer.lock();
    let version = input.get("version").and_then(Value::as_i64).unwrap_or(-1);
    if version != row.state.version || row.state.intent.as_deref() != Some("stopping") {
        return Ok(json!({ "success": false, "reason": "version_mismatch", "version": row.state.version }));
    }
    let next = row.state.version + 1;
    if confirm {
        row.state = TimerState { version: next, ..TimerState::default() };
    } else {
        row.state.intent = None;
        row.state.version = next;
    }
    drop(row);
    timer_event(state, if confirm { "stopped" } else { "sync" }, next);
    Ok(json!({ "success": true, "version": next }))
}


/// Opretter ét import-element; `Err` er web's fejlbesked.
type CreateItem<'a> = dyn FnMut(&Value, &HashMap<String, String>) -> std::result::Result<String, String> + 'a;

/// Som web's `extension.import.run`: `{ dryRun, clients, projects,
/// prepaidPackages, entries, invoices }` med `localId`, `data` (web's
/// create-input) og lokale referencer. Idempotent pr. `localId`.
fn import(state: &State, input: &Value) -> Res {
    let dry = input.get("dryRun").and_then(Value::as_bool).unwrap_or(true);
    let repo = &state.repo;
    let mut keys = state.import_keys.lock();
    let mut report = json!({});
    let mut errors: Vec<Value> = Vec::new();
    let mut ids = json!({});
    let list = |k: &str| input.get(k).and_then(Value::as_array).cloned().unwrap_or_default();
    // Ved dry-run gemmer web ingen id'er: et kald kender kun sine egne
    // elementer (og dem fra tidligere rigtige importer).
    let in_call: std::collections::HashSet<String> = [
        ("client", "clients"),
        ("project", "projects"),
        ("prepaid", "prepaidPackages"),
        ("task", "tasks"),
        ("entry", "entries"),
        ("rule", "rules"),
    ]
        .iter()
        .flat_map(|(e, k)| list(k).into_iter().filter_map(move |i| s(&i, "localId").map(|l| format!("{e}:{l}"))))
        .collect();

    // (entity, rapportnøgle) → element → Ok(server-id) | Err(besked)
    let mut run = |entity: &str,
                   key: &str,
                   items: Vec<Value>,
                   keys: &mut HashMap<String, String>,
                   create: &mut CreateItem| {
        let mut r = json!({ "total": items.len(), "created": 0, "existing": 0, "failed": 0 });
        ids[key] = json!({});
        for item in items {
            let local = s(&item, "localId").unwrap_or_default();
            let k = format!("{entity}:{local}");
            if let Some(id) = keys.get(&k) {
                r["existing"] = json!(r["existing"].as_u64().unwrap_or(0) + 1);
                ids[key][&local] = json!(id);
                continue;
            }
            match create(&item, keys) {
                Ok(id) => {
                    r["created"] = json!(r["created"].as_u64().unwrap_or(0) + 1);
                    if !dry {
                        keys.insert(k, id.clone());
                        ids[key][&local] = json!(id);
                    }
                }
                Err(message) => {
                    r["failed"] = json!(r["failed"].as_u64().unwrap_or(0) + 1);
                    errors.push(json!({ "entity": entity, "localId": local, "message": message }));
                }
            }
        }
        report[key] = r;
    };
    let reference = |keys: &HashMap<String, String>, entity: &str, item: &Value, field: &str| {
        match s(item, field) {
            None => Ok(None),
            Some(l) => match keys.get(&format!("{entity}:{l}")) {
                Some(id) => Ok(Some(id.clone())),
                None if dry && in_call.contains(&format!("{entity}:{l}")) => Ok(Some(format!("dry-run:{l}"))),
                None => Err(format!("{entity} {l} blev ikke importeret")),
            },
        }
    };
    let err = |e: DataError| e.to_string();

    run("client", "clients", list("clients"), &mut keys, &mut |item, _| {
        let new: NewClient = parse(item.get("data")).map_err(err)?;
        if new.name.chars().count() < 2 {
            return Err("name: mindst 2 tegn".into());
        }
        if dry {
            return Ok(String::new());
        }
        let c = block_on(repo.create_client(new)).map_err(err)?;
        if item.get("isArchived").and_then(Value::as_bool) == Some(true) {
            block_on(repo.archive_client(&c.id)).map_err(err)?;
        }
        Ok(c.id)
    });
    run("project", "projects", list("projects"), &mut keys, &mut |item, keys| {
        let mut new: NewProject = parse(item.get("data")).map_err(err)?;
        new.client_id = reference(keys, "client", item, "clientLocalId")?;
        if dry {
            return Ok(String::new());
        }
        let status = item.get("data").and_then(|d| s(d, "status"));
        let p = block_on(repo.create_project(new)).map_err(err)?;
        if let Some(st) = status.filter(|x| x != "active") {
            block_on(repo.set_project_status(&p.id, ProjectStatus::parse(&st))).map_err(err)?;
        }
        Ok(p.id)
    });
    run("prepaid", "prepaidPackages", list("prepaidPackages"), &mut keys, &mut |item, keys| {
        let mut new: NewPrepaidPackage = parse(item.get("data")).map_err(err)?;
        new.client_id = reference(keys, "client", item, "clientLocalId")?.unwrap_or_default();
        if dry {
            return Ok(String::new());
        }
        Ok(block_on(repo.create_klippekort(new)).map_err(err)?.id)
    });
    run("task", "tasks", list("tasks"), &mut keys, &mut |item, keys| {
        let mut new: NewTask = parse(item.get("data")).map_err(err)?;
        if new.title.trim().is_empty() {
            return Err("Titel er påkrævet".into());
        }
        new.project_id = reference(keys, "project", item, "projectLocalId")?;
        new.client_id = reference(keys, "client", item, "clientLocalId")?;
        if dry {
            return Ok(String::new());
        }
        Ok(block_on(repo.create_task(new)).map_err(err)?.id)
    });
    run("entry", "entries", list("entries"), &mut keys, &mut |item, keys| {
        let mut new: NewTimeEntry = parse(item.get("data")).map_err(err)?;
        if new.description.is_empty() {
            return Err("description: mindst 1 tegn".into());
        }
        new.project_id = reference(keys, "project", item, "projectLocalId")?;
        new.client_id = reference(keys, "client", item, "clientLocalId")?;
        new.prepaid_package_id = reference(keys, "prepaid", item, "prepaidLocalId")?;
        new.task_id = reference(keys, "task", item, "taskLocalId")?;
        new.client_entry_id = Some(format!("import:{}", s(item, "localId").unwrap_or_default()));
        if dry {
            return Ok(String::new());
        }
        let id = block_on(repo.create_entry(new)).map_err(err)?.entry.id;
        // Web's time.create tager `isBilled`.
        if item.pointer("/data/isBilled").and_then(Value::as_bool) == Some(true) {
            repo.run_sync(|c| {
                c.execute("UPDATE time_entries SET is_billed = 1 WHERE id = ?1", [&id])?;
                Ok(())
            })
            .map_err(err)?;
        }
        Ok(id)
    });
    // Regler (bekræftede koblinger): mål eller "ikke arbejde", som web's ruleInput.
    run("rule", "rules", list("rules"), &mut keys, &mut |item, keys| {
        let project_id = reference(keys, "project", item, "projectLocalId")?;
        let client_id = reference(keys, "client", item, "clientLocalId")?;
        let rule = rule_from_web(item, project_id, client_id).map_err(err)?;
        if dry {
            return Ok(String::new());
        }
        upsert_web_rule(repo, rule).map_err(err)
    });
    run("invoice", "invoices", list("invoices"), &mut keys, &mut |item, keys| {
        let d = item.get("data").cloned().unwrap_or_default();
        let amount = s(&d, "amount").and_then(|a| a.parse::<f64>().ok()).unwrap_or(0.0);
        if amount <= 0.0 {
            return Err("amount: skal være større end 0".into());
        }
        let client_id = reference(keys, "client", item, "clientLocalId")?.unwrap_or_default();
        let lines = item.get("lines").and_then(Value::as_array).cloned().unwrap_or_default();
        // Linjernes sum skal være fakturaens beløb (web).
        if !lines.is_empty() {
            let sum: f64 = lines.iter().filter_map(|l| s(l, "amount")?.parse::<f64>().ok()).sum();
            if (sum - amount).abs() > 0.004 {
                return Err(format!("Linjernes sum ({sum:.2}) er ikke fakturaens beløb ({amount:.2})"));
            }
        }
        let line_entries = lines.iter().filter_map(|l| s(l, "entryLocalId"));
        let local_entries = item.get("entryLocalIds").and_then(Value::as_array).cloned().unwrap_or_default();
        let mut entry_ids = Vec::new();
        let mut by_local = HashMap::new();
        for l in local_entries.iter().filter_map(|v| v.as_str().map(str::to_owned)).chain(line_entries) {
            match keys.get(&format!("entry:{l}")) {
                Some(id) => {
                    if !entry_ids.contains(id) {
                        entry_ids.push(id.clone());
                    }
                    by_local.insert(l, id.clone());
                }
                None if dry && in_call.contains(&format!("entry:{l}")) => {}
                None => return Err(format!("entry {l} blev ikke importeret")),
            }
        }
        if dry {
            return Ok(String::new());
        }
        if entry_ids.is_empty() {
            return Err("Fakturaen har ingen poster".into());
        }
        let inv = block_on(repo.create_invoice_draft(NewInvoiceDraft {
            client_id,
            time_entry_ids: entry_ids,
            notes: s(item, "invoiceNumber").map(|n| format!("Importeret fra TimeTrack Desktop, lokalt fakturanummer {n}.")),
            due_date: None,
        }))
        .map_err(err)?;
        if !lines.is_empty() {
            // Web: kladde, saveLines med linjerne (entryLocalId → post), udsted.
            let mut rows = Vec::new();
            for (n, l) in lines.iter().enumerate() {
                let mut line: InvoiceLine = parse(Some(l)).map_err(err)?;
                line.time_entry_id = s(l, "entryLocalId").and_then(|x| by_local.get(&x).cloned());
                line.sort_order = n as i32;
                rows.push(line);
            }
            block_on(repo.save_invoice_lines(&inv.id, rows)).map_err(err)?;
        }
        let status = s(&d, "status").unwrap_or_else(|| "draft".into());
        if status != "draft" {
            block_on(repo.send_invoice(&inv.id)).map_err(err)?;
        }
        if status == "paid" {
            let paid = s(item, "paidDate").and_then(|x| NaiveDate::parse_from_str(&x, "%Y-%m-%d").ok());
            block_on(repo.mark_invoice_paid(&inv.id, paid)).map_err(err)?;
        }
        Ok(inv.id)
    });
    // Arkiverede klippekort arkiveres til sidst, efter kaldets poster.
    if !dry {
        for k in list("prepaidPackages") {
            if k.get("isArchived").and_then(Value::as_bool) != Some(true) {
                continue;
            }
            let Some(pid) = s(&k, "localId").and_then(|l| keys.get(&format!("prepaid:{l}")).cloned()) else { continue };
            let archived = block_on(repo.list_klippekort(None, true))?.into_iter().any(|p| p.id == pid && p.is_archived == Some(true));
            if !archived {
                block_on(repo.archive_klippekort(&pid))?;
            }
        }
    }
    let error_count = errors.len();
    Ok(json!({
        "dryRun": dry,
        "organizationId": MOCK_ORG_ID,
        "plan": "solo",
        "report": report,
        "errorCount": error_count,
        "errors": errors,
        "ids": ids,
    }))
}
