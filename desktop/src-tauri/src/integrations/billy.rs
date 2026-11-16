use crate::i18n;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const BILLY_BASE_URL: &str = "https://api.billysbilling.com/v2";

#[derive(Debug, Serialize, Deserialize)]
pub struct BillyContact {
    pub id: String,
    pub name: String,
    #[serde(rename = "countryId")]
    pub country_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillyInvoiceLineInput {
    #[serde(rename = "productId")]
    pub product_id: Option<String>,
    pub description: Option<String>,
    pub quantity: f64,
    #[serde(rename = "unitPrice")]
    pub unit_price: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillyInvoiceInput {
    #[serde(rename = "contactId")]
    pub contact_id: String,
    #[serde(rename = "entryDate")]
    pub entry_date: String,
    #[serde(rename = "paymentTermsDays")]
    pub payment_terms_days: i32,
    pub lines: Vec<BillyInvoiceLineInput>,
}

pub struct BillyClient {
    api_key: String,
    http: reqwest::Client,
}

impl BillyClient {
    pub fn new(api_key: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self { api_key, http }
    }

    /// GET /v2/organization — returns org name if valid.
    pub async fn get_organization(&self) -> Result<String, String> {
        let resp = self
            .http
            .get(format!("{}/organization", BILLY_BASE_URL))
            .header("X-Access-Token", &self.api_key)
            .send()
            .await
            .map_err(|e| i18n::t_fmt("billy.connectionFailed", &[&e.to_string()]))?;

        if !resp.status().is_success() {
            return Err(i18n::t_fmt(
                "billy.statusError",
                &[&resp.status().as_u16().to_string()],
            ));
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| i18n::t_fmt("billy.couldNotParse", &[&e.to_string()]))?;

        let org_name = body["organization"]["name"]
            .as_str()
            .unwrap_or(&i18n::t("billy.unknownOrg"))
            .to_string();

        Ok(org_name)
    }

    /// GET /v2/contacts — list all contacts.
    pub async fn list_contacts(&self) -> Result<Vec<BillyContact>, String> {
        let resp = self
            .http
            .get(format!("{}/contacts", BILLY_BASE_URL))
            .header("X-Access-Token", &self.api_key)
            .send()
            .await
            .map_err(|e| i18n::t_fmt("billy.apiFailed", &[&e.to_string()]))?;

        if !resp.status().is_success() {
            return Err(i18n::t_fmt("billy.apiStatus", &[&resp.status().as_u16().to_string()]));
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| i18n::t_fmt("billy.couldNotParseResponse", &[&e.to_string()]))?;

        let contacts = body["contacts"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|c| {
                Some(BillyContact {
                    id: c["id"].as_str()?.to_string(),
                    name: c["name"].as_str()?.to_string(),
                    country_id: c["countryId"].as_str().map(|s| s.to_string()),
                })
            })
            .collect();

        Ok(contacts)
    }

    /// POST /v2/contacts — create a new contact.
    pub async fn create_contact(
        &self,
        name: &str,
        country_id: &str,
    ) -> Result<BillyContact, String> {
        let body = serde_json::json!({
            "contact": {
                "name": name,
                "countryId": country_id,
                "isCustomer": true,
            }
        });

        let resp = self
            .http
            .post(format!("{}/contacts", BILLY_BASE_URL))
            .header("X-Access-Token", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| i18n::t_fmt("billy.apiFailed", &[&e.to_string()]))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(i18n::t_fmt("billy.apiStatusDetail", &[&status.to_string(), &text]));
        }

        let resp_body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| i18n::t_fmt("billy.couldNotParseResponse", &[&e.to_string()]))?;

        let contacts = resp_body["contacts"]
            .as_array()
            .ok_or(&i18n::t("billy.unexpectedResponse"))?;

        let contact = contacts
            .first()
            .ok_or(&i18n::t("billy.noContactInResponse"))?;

        Ok(BillyContact {
            id: contact["id"]
                .as_str()
                .ok_or(&i18n::t("billy.missingContactId"))?
                .to_string(),
            name: contact["name"]
                .as_str()
                .ok_or(&i18n::t("billy.missingContactName"))?
                .to_string(),
            country_id: contact["countryId"].as_str().map(|s| s.to_string()),
        })
    }

    /// POST /v2/invoices — create an invoice.
    pub async fn create_invoice(
        &self,
        input: &BillyInvoiceInput,
    ) -> Result<String, String> {
        let lines: Vec<serde_json::Value> = input
            .lines
            .iter()
            .map(|l| {
                let mut line = serde_json::json!({
                    "quantity": l.quantity,
                    "unitPrice": l.unit_price,
                });
                if let Some(ref desc) = l.description {
                    line["description"] = serde_json::Value::String(desc.clone());
                }
                if let Some(ref pid) = l.product_id {
                    line["productId"] = serde_json::Value::String(pid.clone());
                }
                line
            })
            .collect();

        let body = serde_json::json!({
            "invoice": {
                "contactId": input.contact_id,
                "entryDate": input.entry_date,
                "paymentTermsDays": input.payment_terms_days,
                "lines": lines,
            }
        });

        let resp = self
            .http
            .post(format!("{}/invoices", BILLY_BASE_URL))
            .header("X-Access-Token", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| i18n::t_fmt("billy.apiFailed", &[&e.to_string()]))?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            return Err(i18n::t_fmt("billy.apiStatusDetail", &[&status.to_string(), &text]));
        }

        let resp_body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| i18n::t_fmt("billy.couldNotParseResponse", &[&e.to_string()]))?;

        let invoices = resp_body["invoices"]
            .as_array()
            .ok_or(&i18n::t("billy.unexpectedResponse"))?;

        let invoice_id = invoices
            .first()
            .and_then(|i| i["id"].as_str())
            .ok_or(&i18n::t("billy.missingInvoiceId"))?
            .to_string();

        Ok(invoice_id)
    }
}
