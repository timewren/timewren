//! Login-token i OS-nøgleringen (Keychain på macOS, Credential Manager på
//! Windows) via `keyring-core`. Implementerer `tt_data::SecretStore`.
//!
//! Selve `Credentials` (adgangs- og refresh-token, bruger) gemmes som JSON i
//! én post. Intet token ligger i filer i datamappen.

use std::sync::Arc;

use keyring_core::{CredentialStore, Entry, Error as KeyringError};
use tt_data::{Credentials, MemorySecretStore, SecretStore};

/// Nøgleringens service-navn. Adskilt fra AI-nøglerne (`….ai`).
pub const SERVICE: &str = "dk.timetrack.desktop";
const ACCOUNT: &str = "login";

pub struct KeyringSecretStore {
    store: Arc<CredentialStore>,
}

impl KeyringSecretStore {
    /// Platformens egen nøglering. `None` hvor der ikke findes en.
    pub fn os() -> Option<Self> {
        os_store().map(|store| Self { store })
    }

    /// Med en vilkårlig butik (`keyring_core::mock::Store` i tests).
    pub fn with_store(store: Arc<CredentialStore>) -> Self {
        Self { store }
    }

    fn entry(&self) -> Option<Entry> {
        match self.store.build(SERVICE, ACCOUNT, None) {
            Ok(e) => Some(e),
            Err(e) => {
                eprintln!("TT nøglering: kan ikke åbne posten: {e}");
                None
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn os_store() -> Option<Arc<CredentialStore>> {
    let s: Arc<CredentialStore> = apple_native_keyring_store::keychain::Store::new().ok()?;
    Some(s)
}

#[cfg(target_os = "windows")]
fn os_store() -> Option<Arc<CredentialStore>> {
    let s: Arc<CredentialStore> = windows_native_keyring_store::Store::new().ok()?;
    Some(s)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn os_store() -> Option<Arc<CredentialStore>> {
    None
}

impl SecretStore for KeyringSecretStore {
    fn load(&self) -> Option<Credentials> {
        let entry = self.entry()?;
        match entry.get_password() {
            Ok(json) => match serde_json::from_str(&json) {
                Ok(c) => Some(c),
                Err(e) => {
                    // Ulæselig post: behandl som logget ud frem for at gætte.
                    eprintln!("TT nøglering: loginet kan ikke læses ({e}). Log ind igen");
                    None
                }
            },
            Err(KeyringError::NoEntry) => None,
            Err(e) => {
                eprintln!("TT nøglering: kan ikke læse loginet: {e}");
                None
            }
        }
    }

    fn save(&self, credentials: &Credentials) {
        let Some(entry) = self.entry() else { return };
        match serde_json::to_string(credentials) {
            Ok(json) => {
                if let Err(e) = entry.set_password(&json) {
                    eprintln!("TT nøglering: kan ikke gemme loginet: {e}");
                }
            }
            Err(e) => eprintln!("TT nøglering: kan ikke skrive loginet: {e}"),
        }
    }

    fn clear(&self) {
        let Some(entry) = self.entry() else { return };
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {}
            Err(e) => eprintln!("TT nøglering: kan ikke slette loginet: {e}"),
        }
    }
}

/// Valget i appen: nøgleringen, medmindre `TT_MEMORY_SECRETS=1` (tests og
/// demo) eller platformen ikke har en. Uden nøglering holdes login kun i
/// hukommelsen, så brugeren skal logge ind igen ved næste start.
pub fn default_store() -> Arc<dyn SecretStore> {
    if std::env::var("TT_MEMORY_SECRETS").is_ok_and(|v| v == "1") {
        return Arc::new(MemorySecretStore::new());
    }
    match KeyringSecretStore::os() {
        Some(s) => Arc::new(s),
        None => {
            eprintln!(
                "TT nøglering: ingen understøttet nøglering. Login huskes ikke mellem starter"
            );
            Arc::new(MemorySecretStore::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tt_data::User;

    fn creds(token: &str) -> Credentials {
        Credentials {
            access_token: token.into(),
            refresh_token: Some("r".into()),
            expires_at: None,
            user: User {
                id: "u1".into(),
                name: "Mads".into(),
                email: "m@example.dk".into(),
            },
            organization_id: Some("o1".into()),
        }
    }

    #[test]
    fn nogleringen_gemmer_indlaeser_og_sletter() {
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new().unwrap();
        let s = KeyringSecretStore::with_store(store.clone());
        assert_eq!(s.load(), None);
        s.save(&creds("abc"));
        assert_eq!(s.load(), Some(creds("abc")));
        // En ny instans oven på samme butik ser det samme (som efter genstart).
        assert_eq!(
            KeyringSecretStore::with_store(store).load(),
            Some(creds("abc"))
        );
        s.save(&creds("def"));
        assert_eq!(s.load().unwrap().access_token, "def");
        s.clear();
        assert_eq!(s.load(), None);
        s.clear();
    }

    #[test]
    fn ulaeselig_post_er_logget_ud() {
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new().unwrap();
        store
            .build(SERVICE, ACCOUNT, None)
            .unwrap()
            .set_password("ikke json")
            .unwrap();
        assert_eq!(KeyringSecretStore::with_store(store).load(), None);
    }
}
