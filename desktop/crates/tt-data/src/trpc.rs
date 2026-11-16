//! tRPC-wire-formatet, som udvidelsen bruger (`browser-extension/src/api/
//! client.ts`): superjson-indpakning `{ json, meta? }`, queries som GET med
//! `?input=`, mutationer som POST, og fejl i `error.json.data.code`.

use serde_json::{Map, Value, json};

use crate::error::DataError;

/// Indpak input i superjson. `date_paths` er punktum-stier til felter, web
/// validerer med `z.date()` (fx `data.deadline`); de markeres som `Date` i
/// `meta.values`, ellers afviser zod ISO-strengen.
pub fn encode_input(input: Value, date_paths: &[&str]) -> Value {
    let present: Vec<&str> = date_paths
        .iter()
        .copied()
        .filter(|p| matches!(lookup(&input, p), Some(v) if v.is_string()))
        .collect();
    if present.is_empty() {
        return json!({ "json": input });
    }
    let mut values = Map::new();
    for p in present {
        values.insert(p.to_string(), json!(["Date"]));
    }
    json!({ "json": input, "meta": { "values": values } })
}

/// Punktum-sti som superjson's: tal er indeks i lister (`tasks.0.data.deadline`).
fn lookup<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(v, |cur, key| match (cur, key.parse::<usize>()) {
        (Value::Array(a), Ok(i)) => a.get(i),
        _ => cur.get(key),
    })
}

/// `{"result":{"data":{"json": …}}}` → `…`. Superjson-Date'er står allerede
/// som ISO-strenge i `json`, og chrono læser dem direkte.
pub fn decode_result(body: &Value) -> Result<Value, DataError> {
    let data = body
        .get("result")
        .and_then(|r| r.get("data"))
        .ok_or_else(|| DataError::InvalidResponse("mangler result.data".into()))?;
    match data.get("json") {
        Some(v) => Ok(v.clone()),
        // tRPC uden superjson-transformer (ses ikke i dag, men harmløst).
        None => Ok(data.clone()),
    }
}

/// tRPC's strengkode ("UNAUTHORIZED" …). Ligger i `error.json.data.code`;
/// `error.json.code` er JSON-RPC-tallet (fx -32001).
pub fn error_code(body: &Value) -> Option<String> {
    let err = body.get("error")?;
    let candidates = [
        err.pointer("/json/data/code"),
        err.pointer("/data/code"),
        err.pointer("/json/code"),
        err.get("code"),
    ];
    candidates
        .into_iter()
        .flatten()
        .find_map(|c| c.as_str().filter(|s| !s.is_empty()).map(str::to_owned))
}

pub fn error_message(body: &Value) -> Option<String> {
    let err = body.get("error")?;
    [err.pointer("/json/message"), err.get("message")]
        .into_iter()
        .flatten()
        .find_map(|m| m.as_str().map(str::to_owned))
}

pub fn app_code(body: &Value) -> Option<String> {
    let err = body.get("error")?;
    if let Some(c) = [err.pointer("/json/data/appCode"), err.pointer("/data/appCode")]
        .into_iter()
        .flatten()
        .find_map(|c| c.as_str())
    {
        return Some(c.to_owned());
    }
    (err.get("code").and_then(Value::as_str) == Some("CLIENT_TOO_OLD"))
        .then(|| "CLIENT_TOO_OLD".to_owned())
}

/// Fejlsvar → `DataError`. `body` er None, når svaret ikke var JSON (fx
/// proxyens HTML-side ved 502/504).
pub fn error_from_response(status: u16, body: Option<&Value>) -> DataError {
    // Uden JSON er det ikke web, der svarer (proxy, captive portal, CDN):
    // usikkert, så intet i køen må kasseres på det grundlag. 401 logger ud
    // som i udvidelsen.
    let Some(body) = body.filter(|b| b.get("error").is_some()) else {
        return match status {
            401 => DataError::Unauthorized,
            408 => DataError::Timeout,
            s if s >= 500 => DataError::Server { status: s },
            s => DataError::InvalidResponse(format!("HTTP {s} uden tRPC-fejl")),
        };
    };
    let code = error_code(body);
    if code.as_deref() == Some("UNAUTHORIZED") || status == 401 {
        return DataError::Unauthorized;
    }
    if code.as_deref() == Some("NOT_FOUND") {
        // tRPC svarer også NOT_FOUND for en procedure, der ikke findes.
        let message = error_message(body).unwrap_or_default();
        if message.starts_with("No procedure found") {
            return DataError::MissingProcedure(message);
        }
        return DataError::NotFound;
    }
    if status >= 500 {
        return DataError::Server { status };
    }
    DataError::Rejected {
        code: code.unwrap_or_else(|| "HTTP".into()),
        message: error_message(body).unwrap_or_else(|| format!("Serveren svarede {status}")),
        app_code: app_code(body),
        status,
    }
}

/// tRPC-kode → HTTP-status (som `@trpc/server`), til mock-serveren.
pub fn status_for_code(code: &str) -> u16 {
    match code {
        "BAD_REQUEST" | "PARSE_ERROR" => 400,
        "UNAUTHORIZED" => 401,
        "FORBIDDEN" => 403,
        "NOT_FOUND" => 404,
        "METHOD_NOT_SUPPORTED" => 405,
        "TIMEOUT" => 408,
        "CONFLICT" => 409,
        "PRECONDITION_FAILED" => 412,
        "UNPROCESSABLE_CONTENT" => 422,
        "TOO_MANY_REQUESTS" => 429,
        _ => 500,
    }
}

/// Fejlsvar i tRPC+superjson-form (til mock-serveren).
pub fn error_body(code: &str, message: &str, app_code: Option<&str>) -> Value {
    let mut data = json!({ "code": code, "httpStatus": status_for_code(code) });
    if let Some(a) = app_code {
        data["appCode"] = json!(a);
    }
    json!({ "error": { "json": { "message": message, "code": -32000, "data": data } } })
}

pub fn result_body(value: Value) -> Value {
    json!({ "result": { "data": { "json": value } } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_get_superjson_meta() {
        let v = encode_input(json!({"data": {"deadline": "2026-10-26T10:00:00Z", "x": 1}}), &[
            "data.deadline",
            "data.missing",
        ]);
        assert_eq!(v["meta"]["values"]["data.deadline"], json!(["Date"]));
        assert!(v["meta"]["values"].get("data.missing").is_none());
        let plain = encode_input(json!({"a": 1}), &["a.b"]);
        assert!(plain.get("meta").is_none());
        // Stier ind i lister (importens opgaver).
        let list = encode_input(json!({"tasks": [{"data": {}}, {"data": {"deadline": "2026-10-26T10:00:00Z"}}]}), &[
            "tasks.0.data.deadline",
            "tasks.1.data.deadline",
        ]);
        assert_eq!(list["meta"]["values"], json!({ "tasks.1.data.deadline": ["Date"] }));
    }

    #[test]
    fn reads_trpc_error_shapes() {
        let body = error_body("FORBIDDEN", "Kræver Selvstændig", None);
        match error_from_response(403, Some(&body)) {
            DataError::Rejected { code, message, status, .. } => {
                assert_eq!(code, "FORBIDDEN");
                assert_eq!(message, "Kræver Selvstændig");
                assert_eq!(status, 403);
            }
            other => panic!("{other:?}"),
        }
        let unauth = error_body("UNAUTHORIZED", "Ugyldig token", None);
        assert_eq!(error_from_response(401, Some(&unauth)), DataError::Unauthorized);
        let old = error_body("PRECONDITION_FAILED", "Opdatér", Some("CLIENT_TOO_OLD"));
        let e = error_from_response(412, Some(&old));
        assert!(e.is_transient() && !e.is_definite_rejection());
        assert_eq!(error_from_response(502, None), DataError::Server { status: 502 });
        // Proxyens HTML-side er ikke en endelig afvisning.
        let proxy = error_from_response(403, None);
        assert!(proxy.is_transient() && !proxy.is_definite_rejection(), "{proxy:?}");
        let missing = error_body("NOT_FOUND", "No procedure found on path \"extension.x\"", None);
        let e = error_from_response(404, Some(&missing));
        assert!(matches!(e, DataError::MissingProcedure(_)) && e.is_transient());
        let gone = error_body("NOT_FOUND", "Posten findes ikke", None);
        assert_eq!(error_from_response(404, Some(&gone)), DataError::NotFound);
        // Uden superjson-indpakning (REST-agtigt)
        let flat = json!({"error": {"data": {"code": "CONFLICT"}, "message": "x"}});
        assert_eq!(error_code(&flat).as_deref(), Some("CONFLICT"));
    }

    #[test]
    fn decodes_result() {
        let v = decode_result(&result_body(json!([1, 2]))).unwrap();
        assert_eq!(v, json!([1, 2]));
        assert!(decode_result(&json!({"nope": 1})).is_err());
    }
}
