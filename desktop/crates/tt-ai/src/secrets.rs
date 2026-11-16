//! API-nøgler til cloud-udbydere i OS-nøgleringen (Keychain / Credential Manager).

use crate::providers::kind_slug;
use crate::types::{AiError, ProviderKind};
use keyring_core::{CredentialStore, Error as KeyringError};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Nøgleringens service-navn for alle AI-nøgler.
pub const SERVICE: &str = "dk.timetrack.desktop.ai";

/// Lager til hemmeligheder. Appen bruger [`KeyringSecrets`]; tests bruger [`MemorySecrets`].
pub trait SecretStore: Send + Sync {
    /// `Ok(None)` = ikke gemt (ikke en fejl).
    fn get(&self, name: &str) -> Result<Option<String>, AiError>;
    fn set(&self, name: &str, value: &str) -> Result<(), AiError>;
    /// Sletning af noget, der ikke findes, er ikke en fejl.
    fn delete(&self, name: &str) -> Result<(), AiError>;
}

/// Navnet på nøglen til en cloud-udbyder, fx `api_key.openai`.
pub fn api_key_name(kind: ProviderKind) -> String {
    format!("api_key.{}", kind_slug(kind))
}

/// OS-nøgleringen via keyring-core.
pub struct KeyringSecrets {
    store: Arc<CredentialStore>,
}

impl KeyringSecrets {
    /// Platformens egen nøglering. Fejler på platforme uden en.
    pub fn os() -> Result<Self, AiError> {
        Ok(Self { store: os_store()? })
    }

    /// Med en vilkårlig keyring-core-butik (fx `keyring_core::mock::Store` i tests).
    pub fn with_store(store: Arc<CredentialStore>) -> Self {
        Self { store }
    }

    fn entry(&self, name: &str) -> Result<keyring_core::Entry, AiError> {
        self.store
            .build(SERVICE, name, None)
            .map_err(|e| AiError::Keyring(e.to_string()))
    }
}

#[cfg(target_os = "macos")]
fn os_store() -> Result<Arc<CredentialStore>, AiError> {
    let s: Arc<CredentialStore> = apple_native_keyring_store::keychain::Store::new()
        .map_err(|e| AiError::Keyring(e.to_string()))?;
    Ok(s)
}

#[cfg(target_os = "windows")]
fn os_store() -> Result<Arc<CredentialStore>, AiError> {
    let s: Arc<CredentialStore> =
        windows_native_keyring_store::Store::new().map_err(|e| AiError::Keyring(e.to_string()))?;
    Ok(s)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn os_store() -> Result<Arc<CredentialStore>, AiError> {
    Err(AiError::Keyring(
        "ingen understøttet nøglering på denne platform".into(),
    ))
}

impl SecretStore for KeyringSecrets {
    fn get(&self, name: &str) -> Result<Option<String>, AiError> {
        match self.entry(name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(e) => Err(AiError::Keyring(e.to_string())),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), AiError> {
        self.entry(name)?
            .set_password(value)
            .map_err(|e| AiError::Keyring(e.to_string()))
    }

    fn delete(&self, name: &str) -> Result<(), AiError> {
        match self.entry(name)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(AiError::Keyring(e.to_string())),
        }
    }
}

/// Hukommelseslager til tests og til at køre uden nøglering.
#[derive(Default)]
pub struct MemorySecrets {
    map: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemorySecrets {
    fn get(&self, name: &str) -> Result<Option<String>, AiError> {
        Ok(self
            .map
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(name)
            .cloned())
    }

    fn set(&self, name: &str, value: &str) -> Result<(), AiError> {
        self.map
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(name.into(), value.into());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), AiError> {
        self.map
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(name);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(s: &dyn SecretStore) {
        let n = api_key_name(ProviderKind::OpenAi);
        assert_eq!(n, "api_key.openai");
        assert_eq!(s.get(&n).unwrap(), None);
        s.set(&n, "sk-test").unwrap();
        assert_eq!(s.get(&n).unwrap().as_deref(), Some("sk-test"));
        s.delete(&n).unwrap();
        assert_eq!(s.get(&n).unwrap(), None);
        s.delete(&n).unwrap();
    }

    #[test]
    fn hukommelseslager() {
        roundtrip(&MemorySecrets::default());
    }

    #[test]
    fn keyring_core_mock_butik() {
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new().unwrap();
        roundtrip(&KeyringSecrets::with_store(store));
    }
}
