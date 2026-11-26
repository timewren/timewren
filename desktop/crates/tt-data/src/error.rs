//! Fejl fra datalaget. Skelner "serveren sagde nej" (sikker afvisning) fra
//! "vi ved ikke, hvad der skete" (netværk, timeout, 5xx), præcis som
//! udvidelsens `ApiError`: en timeout betyder IKKE, at serveren ikke gemte.

use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq)]
pub enum DataError {
    /// Ikke logget ind, eller tokenet er tilbagekaldt/udløbet (tRPC
    /// `UNAUTHORIZED` eller HTTP 401). Udløser `Event::LoggedOut`.
    #[error("Du er ikke logget ind")]
    Unauthorized,
    /// Serveren afviste med en tRPC-kode (fx `FORBIDDEN`, `BAD_REQUEST`,
    /// `NOT_FOUND`, `CONFLICT`). `message` er serverens danske tekst.
    #[error("{message}")]
    Rejected {
        code: String,
        message: String,
        /// Serverens stabile app-kode, fx `CLIENT_TOO_OLD`.
        app_code: Option<String>,
        status: u16,
    },
    #[error("Ikke fundet")]
    NotFound,
    /// Lokal validering (samme regler som web's zod-skemaer).
    #[error("{0}")]
    Validation(String),
    /// Ingen forbindelse. Skrivningen er lagt i offline-køen, hvis den kan.
    #[error("Ingen forbindelse til {}", tt_core::edition::EDITION.name)]
    Offline,
    #[error("Forbindelsen tog for lang tid")]
    Timeout,
    /// 5xx eller uforståeligt svar: skrivningen KAN være gemt.
    #[error("Serveren svarede {status}")]
    Server { status: u16 },
    #[error("Uventet svar fra serveren: {0}")]
    InvalidResponse(String),
    /// Serveren kender ikke proceduren (web uden den nyeste API-version).
    /// Usikker: en køet skrivning bevares, til serveren er opdateret.
    #[error("Serveren understøtter ikke {0} endnu")]
    MissingProcedure(String),
    /// Funktionen findes ikke i denne tilstand (fx afsendelse af faktura
    /// lokalt) eller kræver en plan, brugeren ikke har.
    #[error("{0}")]
    Unsupported(String),
    /// Timer-protokollen: rækken er ændret af en anden klient imellem.
    #[error("Timeren er ændret et andet sted ({reason})")]
    Conflict { reason: String },
    #[error("Databasefejl: {0}")]
    Storage(String),
    #[error("Login mislykkedes: {0}")]
    Auth(String),
}

impl DataError {
    /// True kun når serveren med sikkerhed har afvist kaldet (4xx undtagen
    /// 408/429). Så er intet gemt, og samme kald vil fejle igen, så
    /// offline-køen må opgive posten.
    pub fn is_definite_rejection(&self) -> bool {
        match self {
            DataError::Rejected { status, app_code, .. } => {
                // CLIENT_TOO_OLD: virker efter en opdatering, så behold.
                app_code.as_deref() != Some("CLIENT_TOO_OLD")
                    && (400..500).contains(status)
                    && *status != 408
                    && *status != 429
            }
            DataError::NotFound | DataError::Validation(_) => true,
            _ => false,
        }
    }

    /// Usikre fejl, hvor et nyt forsøg med samme idempotensnøgle er rigtigt.
    pub fn is_transient(&self) -> bool {
        match self {
            DataError::Offline
            | DataError::Timeout
            | DataError::Server { .. }
            | DataError::InvalidResponse(_)
            | DataError::MissingProcedure(_) => true,
            DataError::Rejected { status, app_code, .. } => {
                *status == 408
                    || *status == 429
                    || app_code.as_deref() == Some("CLIENT_TOO_OLD")
            }
            _ => false,
        }
    }

    pub fn code(&self) -> Option<&str> {
        match self {
            DataError::Rejected { code, .. } => Some(code),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for DataError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => DataError::NotFound,
            other => DataError::Storage(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for DataError {
    fn from(e: serde_json::Error) -> Self {
        DataError::InvalidResponse(e.to_string())
    }
}

pub type Result<T, E = DataError> = std::result::Result<T, E>;
