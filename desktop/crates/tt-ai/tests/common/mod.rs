//! Lille mock-HTTP-server til tests (tiny_http på en tilfældig port).

#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// En modtaget forespørgsel.
#[derive(Debug, Clone)]
pub struct Seen {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).expect("JSON-krop")
    }
}

/// Svar fra handleren.
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
    pub headers: Vec<(String, String)>,
    pub delay_ms: u64,
}

impl Reply {
    pub fn json(status: u16, v: serde_json::Value) -> Self {
        Self {
            status,
            body: v.to_string().into_bytes(),
            headers: vec![("Content-Type".into(), "application/json".into())],
            delay_ms: 0,
        }
    }

    pub fn bytes(status: u16, body: Vec<u8>) -> Self {
        Self {
            status,
            body,
            headers: Vec::new(),
            delay_ms: 0,
        }
    }

    pub fn header(mut self, k: &str, v: &str) -> Self {
        self.headers.push((k.into(), v.into()));
        self
    }

    pub fn delay(mut self, ms: u64) -> Self {
        self.delay_ms = ms;
        self
    }
}

type Handler = dyn Fn(&Seen) -> Reply + Send + Sync;

pub struct MockServer {
    pub port: u16,
    server: Arc<tiny_http::Server>,
    seen: Arc<Mutex<Vec<Seen>>>,
    thread: Option<JoinHandle<()>>,
}

impl MockServer {
    pub fn start(handler: impl Fn(&Seen) -> Reply + Send + Sync + 'static) -> Self {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").expect("mock-server"));
        let port = server.server_addr().to_ip().expect("ip-adresse").port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let handler: Arc<Handler> = Arc::new(handler);
        let (s, log) = (server.clone(), seen.clone());
        let thread = std::thread::spawn(move || {
            for mut req in s.incoming_requests() {
                let mut body = String::new();
                let _ = req.as_reader().read_to_string(&mut body);
                let item = Seen {
                    method: req.method().to_string(),
                    url: req.url().to_string(),
                    headers: req
                        .headers()
                        .iter()
                        .map(|h| (h.field.to_string(), h.value.to_string()))
                        .collect(),
                    body,
                };
                log.lock().unwrap().push(item.clone());
                let handler = handler.clone();
                // Hver forespørgsel i sin egen tråd, så en forsinket ikke blokerer de andre.
                std::thread::spawn(move || {
                    let reply = handler(&item);
                    if reply.delay_ms > 0 {
                        std::thread::sleep(std::time::Duration::from_millis(reply.delay_ms));
                    }
                    let mut resp =
                        tiny_http::Response::from_data(reply.body).with_status_code(reply.status);
                    for (k, v) in reply.headers {
                        resp.add_header(
                            tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap(),
                        );
                    }
                    let _ = req.respond(resp);
                });
            }
        });
        Self {
            port,
            server,
            seen,
            thread: Some(thread),
        }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.server.unblock();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// En port, hvor ingen lytter (bundet og sluppet igen).
pub fn free_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    l.local_addr().unwrap().port()
}

pub fn kandidater() -> Vec<tt_ai::Candidate> {
    vec![
        tt_ai::Candidate {
            client_id: "k1".into(),
            client_name: "Bageriet".into(),
            project_id: Some("p1".into()),
            project_name: Some("Webshop".into()),
            keywords: vec!["bageriet.dk".into()],
        },
        tt_ai::Candidate {
            client_id: "k2".into(),
            client_name: "Tømrer Hansen".into(),
            project_id: None,
            project_name: None,
            keywords: vec![],
        },
    ]
}

pub fn blok() -> tt_ai::BlockSummary {
    tt_ai::BlockSummary {
        app: "Google Chrome".into(),
        title: "Ordre #1042 – Bageriet admin".into(),
        domain: Some("bageriet.dk".into()),
        duration_secs: 600,
        ..Default::default()
    }
}

pub const SVAR_1: &str =
    r#"{"candidate": 1, "confidence": 0.86, "reasoning": "Domænet er bageriet.dk"}"#;
