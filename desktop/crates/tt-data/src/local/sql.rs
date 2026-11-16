//! Generisk række ↔ domænetype via JSON. Kolonnerne hedder som web's
//! (snake_case), felterne som web's tRPC-svar (camelCase). Decimaler gemmes
//! som TEXT, tidspunkter som RFC 3339, datoer som "yyyy-MM-dd".

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, Row, params_from_iter};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use crate::error::{DataError, Result};

pub struct Table {
    pub name: &'static str,
    pub columns: &'static [&'static str],
    /// INTEGER 0/1 ↔ bool.
    pub bools: &'static [&'static str],
    /// TEXT med JSON (lister, valg).
    pub jsons: &'static [&'static str],
}

pub fn camel(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper = false;
    for ch in snake.chars() {
        if ch == '_' {
            upper = true;
        } else if upper {
            out.extend(ch.to_uppercase());
            upper = false;
        } else {
            out.push(ch);
        }
    }
    out
}

impl Table {
    pub fn select(&self) -> String {
        format!("SELECT {} FROM {}", self.columns.join(", "), self.name)
    }

    pub fn row_to_value(&self, row: &Row<'_>) -> rusqlite::Result<Value> {
        let mut map = Map::new();
        for (i, col) in self.columns.iter().enumerate() {
            let v: SqlValue = row.get(i)?;
            let json = match v {
                SqlValue::Null => Value::Null,
                SqlValue::Integer(n) if self.bools.contains(col) => Value::Bool(n != 0),
                SqlValue::Integer(n) => Value::from(n),
                SqlValue::Real(f) => Value::from(f),
                SqlValue::Text(s) if self.jsons.contains(col) => {
                    serde_json::from_str(&s).unwrap_or(Value::Null)
                }
                SqlValue::Text(s) => Value::String(s),
                SqlValue::Blob(_) => Value::Null,
            };
            map.insert(camel(col), json);
        }
        Ok(Value::Object(map))
    }

    pub fn decode_row<T: DeserializeOwned>(&self, row: &Row<'_>) -> rusqlite::Result<T> {
        let v = self.row_to_value(row)?;
        serde_json::from_value(v).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })
    }

    fn sql_value(&self, col: &str, v: Option<&Value>) -> SqlValue {
        match v {
            None | Some(Value::Null) => SqlValue::Null,
            Some(Value::Bool(b)) => SqlValue::Integer(*b as i64),
            Some(Value::Number(n)) => {
                n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0)))
            }
            Some(Value::String(s)) if !self.jsons.contains(&col) => SqlValue::Text(s.clone()),
            Some(other) => SqlValue::Text(other.to_string()),
        }
    }

    /// INSERT af alle kolonner (manglende felter bliver NULL).
    pub fn insert<T: Serialize>(&self, conn: &Connection, item: &T) -> Result<()> {
        let v = serde_json::to_value(item)?;
        let values: Vec<SqlValue> =
            self.columns.iter().map(|c| self.sql_value(c, v.get(camel(c)))).collect();
        let marks = vec!["?"; self.columns.len()].join(", ");
        conn.execute(
            &format!("INSERT INTO {} ({}) VALUES ({marks})", self.name, self.columns.join(", ")),
            params_from_iter(values),
        )?;
        Ok(())
    }

    /// UPDATE af alle kolonner undtagen `id` ud fra hele typen.
    pub fn update<T: Serialize>(&self, conn: &Connection, id: &str, item: &T) -> Result<()> {
        let v = serde_json::to_value(item)?;
        let cols: Vec<&str> = self.columns.iter().copied().filter(|c| *c != "id").collect();
        let mut values: Vec<SqlValue> = cols.iter().map(|c| self.sql_value(c, v.get(camel(c)))).collect();
        values.push(SqlValue::Text(id.to_owned()));
        let sets = cols.iter().map(|c| format!("{c} = ?")).collect::<Vec<_>>().join(", ");
        let n = conn.execute(
            &format!("UPDATE {} SET {sets} WHERE id = ?", self.name),
            params_from_iter(values),
        )?;
        if n == 0 {
            return Err(DataError::NotFound);
        }
        Ok(())
    }

    pub fn get<T: DeserializeOwned>(&self, conn: &Connection, id: &str) -> Result<T> {
        let sql = format!("{} WHERE id = ?1", self.select());
        Ok(conn.query_row(&sql, [id], |r| self.decode_row(r))?)
    }

    /// SELECT med valgfri WHERE/ORDER-hale.
    pub fn query<T: DeserializeOwned>(
        &self,
        conn: &Connection,
        tail: &str,
        params: Vec<SqlValue>,
    ) -> Result<Vec<T>> {
        let sql = format!("{} {tail}", self.select());
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(params), |r| self.decode_row(r))?;
        Ok(rows.collect::<rusqlite::Result<Vec<T>>>()?)
    }
}

pub fn text(s: impl Into<String>) -> SqlValue {
    SqlValue::Text(s.into())
}

pub const CLIENTS: Table = Table {
    name: "clients",
    columns: &[
        "id", "name", "email", "phone", "company", "address", "city", "postal_code", "country",
        "cvr_number", "notes", "default_hourly_rate", "payment_terms_days", "rounding_enabled",
        "rounding_minutes", "rounding_method", "default_billable", "color", "is_active",
        "is_archived", "created_at", "updated_at", "domains",
    ],
    bools: &["rounding_enabled", "default_billable", "is_active", "is_archived"],
    jsons: &["domains"],
};

pub const PROJECTS: Table = Table {
    name: "projects",
    columns: &[
        "id", "name", "description", "client_id", "hourly_rate", "rounding_enabled",
        "rounding_minutes", "rounding_method", "fixed_price", "monthly_budget_hours",
        "budget_hours", "status", "start_date", "end_date", "url_patterns", "created_at",
        "updated_at",
    ],
    bools: &["rounding_enabled"],
    jsons: &["url_patterns"],
};

pub const PREPAID: Table = Table {
    name: "prepaid_packages",
    columns: &[
        "id", "name", "client_id", "total_hours", "used_hours", "remaining_hours", "hourly_rate",
        "total_value", "purchase_date", "expiry_date", "is_active", "is_archived", "description",
        "clip_size_minutes", "auto_deduct", "overdraft_policy", "overdraft_rate",
        "overdraft_hours",
    ],
    bools: &["is_active", "is_archived", "auto_deduct"],
    jsons: &[],
};

pub const ENTRIES: Table = Table {
    name: "time_entries",
    columns: &[
        "id", "project_id", "client_id", "prepaid_package_id", "invoice_id", "task_id",
        "description", "notes", "hours", "date", "start_time", "end_time", "billable_rate",
        "is_billable", "is_billed", "is_prepaid", "source", "client_entry_id",
        "timer_session_id", "created_at", "updated_at",
    ],
    bools: &["is_billable", "is_billed", "is_prepaid"],
    jsons: &[],
};

pub const TASKS: Table = Table {
    name: "tasks",
    columns: &[
        "id", "title", "description", "notes", "project_id", "client_id", "status", "status_id",
        "priority", "deadline", "completed_at", "parent_task_id", "position",
        "estimated_minutes", "created_at", "updated_at",
    ],
    bools: &[],
    jsons: &[],
};

pub const INVOICES: Table = Table {
    name: "invoices",
    columns: &[
        "id", "invoice_number", "client_id", "amount", "status", "kind", "issue_date",
        "due_date", "paid_date", "notes", "created_at", "updated_at", "title",
    ],
    bools: &[],
    jsons: &[],
};

pub const INVOICE_LINES: Table = Table {
    name: "invoice_lines",
    columns: &[
        "id", "invoice_id", "description", "quantity", "unit_price", "amount", "time_entry_id",
        "sort_order",
    ],
    bools: &[],
    jsons: &[],
};

pub const RULES: Table = Table {
    name: "matching_rules",
    columns: &[
        "id", "kind", "pattern", "project_id", "client_id", "source", "confirmations",
        "not_work", "updated_at",
    ],
    bools: &["not_work"],
    jsons: &[],
};

#[cfg(test)]
mod tests {
    use super::camel;

    #[test]
    fn snake_to_camel() {
        assert_eq!(camel("default_hourly_rate"), "defaultHourlyRate");
        assert_eq!(camel("id"), "id");
    }
}
