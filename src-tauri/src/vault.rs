//! Encrypted local document store.
//!
//! Each document is a JSON value stored at `<app_data_dir>/vault/<ns>/<key>.bin`
//! as `MAGIC || nonce || AES-256-GCM(ciphertext + tag)`. The AAD binds every
//! ciphertext to its namespace and key, so files cannot be swapped or renamed.
//!
//! The 32-byte master key lives in the OS credential store (Windows Credential
//! Manager / macOS Keychain / Linux Secret Service). When that is unavailable we
//! fall back to a 0600 key file next to the vault and report `protected: false`.

use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State};

const MAGIC: &[u8; 4] = b"MPV1";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const KEY_LEN: usize = 32;
const KEYRING_SERVICE: &str = "com.memorypet.app";
const KEYRING_USER: &str = "vault-master-key";
const KEY_FILE: &str = "vault.key";
const MAX_NAME_LEN: usize = 128;

/// Readable only from Rust; the webview-facing commands refuse it.
pub const SECRETS_NS: &str = "secrets";

pub type SharedVault = Arc<Vault>;

#[derive(Debug)]
pub enum VaultError {
    InvalidName(String),
    Reserved,
    Decrypt,
    Key(String),
    Io(io::Error),
    Json(serde_json::Error),
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidName(name) => write!(
                f,
                "名称不合法：“{name}”（只能包含字母、数字、-、_、.，且不能以 . 开头）"
            ),
            Self::Reserved => write!(f, "该命名空间仅供内部使用"),
            Self::Decrypt => write!(f, "数据无法解密：文件已损坏或密钥不匹配"),
            Self::Key(msg) => write!(f, "{msg}"),
            Self::Io(err) => write!(f, "读写本地数据失败：{err}"),
            Self::Json(err) => write!(f, "数据格式错误：{err}"),
        }
    }
}

impl From<io::Error> for VaultError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for VaultError {
    fn from(err: serde_json::Error) -> Self {
        Self::Json(err)
    }
}

type Result<T> = std::result::Result<T, VaultError>;

enum KeySource {
    System {
        key_file: PathBuf,
    },
    #[cfg(test)]
    Fixed([u8; KEY_LEN]),
}

#[derive(Clone)]
struct LoadedKey {
    cipher: Aes256Gcm,
    protected: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct VaultStatus {
    pub protected: bool,
}

pub struct Vault {
    root: PathBuf,
    source: KeySource,
    /// Loaded lazily: the first credential-store access may block on an unlock prompt.
    key: Mutex<Option<LoadedKey>>,
}

impl Vault {
    pub fn new(root: PathBuf, key_file: PathBuf) -> Self {
        Self {
            root,
            source: KeySource::System { key_file },
            key: Mutex::new(None),
        }
    }

    #[cfg(test)]
    fn with_key(root: PathBuf, key: [u8; KEY_LEN]) -> Self {
        Self {
            root,
            source: KeySource::Fixed(key),
            key: Mutex::new(None),
        }
    }

    pub fn status(&self) -> Result<VaultStatus> {
        Ok(VaultStatus {
            protected: self.loaded_key()?.protected,
        })
    }

    pub fn put(&self, ns: &str, key: &str, value: &Value) -> Result<()> {
        let path = self.doc_path(ns, key)?;
        let plain = serde_json::to_vec(value)?;
        let cipher = self.loaded_key()?.cipher;
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let sealed = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plain,
                    aad: &aad(ns, key),
                },
            )
            .map_err(|_| VaultError::Key("加密失败".into()))?;

        let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + sealed.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        write_atomic(&path, &out)
    }

    pub fn get(&self, ns: &str, key: &str) -> Result<Option<Value>> {
        let path = self.doc_path(ns, key)?;
        let data = match fs::read(&path) {
            Ok(data) => data,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        if data.len() < MAGIC.len() + NONCE_LEN + TAG_LEN || &data[..MAGIC.len()] != MAGIC {
            return Err(VaultError::Decrypt);
        }
        let (nonce, sealed) = data[MAGIC.len()..].split_at(NONCE_LEN);
        let plain = self
            .loaded_key()?
            .cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: sealed,
                    aad: &aad(ns, key),
                },
            )
            .map_err(|_| VaultError::Decrypt)?;
        Ok(Some(serde_json::from_slice(&plain)?))
    }

    pub fn delete(&self, ns: &str, key: &str) -> Result<()> {
        let path = self.doc_path(ns, key)?;
        match fs::remove_file(path) {
            Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err.into()),
            _ => Ok(()),
        }
    }

    pub fn list(&self, ns: &str) -> Result<Vec<String>> {
        validate_name(ns)?;
        let entries = match fs::read_dir(self.root.join(ns)) {
            Ok(entries) => entries,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err.into()),
        };
        let mut keys = Vec::new();
        for entry in entries {
            let name = entry?.file_name();
            if let Some(key) = name.to_str().and_then(|n| n.strip_suffix(".bin"))
                && validate_name(key).is_ok()
            {
                keys.push(key.to_owned());
            }
        }
        keys.sort();
        Ok(keys)
    }

    /// Removes one namespace, or with `None` every document plus the master key.
    pub fn wipe(&self, ns: Option<&str>) -> Result<()> {
        if let Some(ns) = ns {
            validate_name(ns)?;
            return remove_dir_if_exists(&self.root.join(ns));
        }
        let mut cached = self.key.lock().unwrap();
        remove_dir_if_exists(&self.root)?;
        if let Some(key_file) = self.key_file() {
            match fs::remove_file(key_file) {
                Err(err) if err.kind() != io::ErrorKind::NotFound => return Err(err.into()),
                _ => {}
            }
            if let Ok(entry) = keyring_entry() {
                match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    Err(err) => return Err(VaultError::Key(format!("删除系统凭据失败：{err}"))),
                }
            }
        }
        *cached = None;
        Ok(())
    }

    fn key_file(&self) -> Option<&Path> {
        match &self.source {
            KeySource::System { key_file } => Some(key_file),
            #[cfg(test)]
            KeySource::Fixed(_) => None,
        }
    }

    fn doc_path(&self, ns: &str, key: &str) -> Result<PathBuf> {
        validate_name(ns)?;
        validate_name(key)?;
        Ok(self.root.join(ns).join(format!("{key}.bin")))
    }

    fn loaded_key(&self) -> Result<LoadedKey> {
        let mut cached = self.key.lock().unwrap();
        if let Some(key) = cached.as_ref() {
            return Ok(key.clone());
        }
        let (bytes, protected) = match &self.source {
            KeySource::System { key_file } => self.load_system_key(key_file)?,
            #[cfg(test)]
            KeySource::Fixed(key) => (*key, true),
        };
        let key = LoadedKey {
            cipher: Aes256Gcm::new(&bytes.into()),
            protected,
        };
        *cached = Some(key.clone());
        Ok(key)
    }

    fn load_system_key(&self, key_file: &Path) -> Result<([u8; KEY_LEN], bool)> {
        let entry = keyring_entry().ok();
        let stored = entry.as_ref().map(|e| e.get_secret());

        if let Some(key) = read_key_file(key_file)? {
            // Upgrade a fallback key once the credential store becomes available.
            if let (Some(entry), Some(Err(keyring::Error::NoEntry))) = (&entry, &stored)
                && store_verified(entry, &key)
            {
                let _ = fs::remove_file(key_file);
                return Ok((key, true));
            }
            return Ok((key, false));
        }

        match (&entry, stored) {
            (Some(_), Some(Ok(bytes))) => {
                let key = bytes
                    .try_into()
                    .map_err(|_| VaultError::Key("系统凭据库中的主密钥格式不正确".into()))?;
                return Ok((key, true));
            }
            (Some(entry), Some(Err(keyring::Error::NoEntry))) if !self.has_documents() => {
                let key = random_key();
                if store_verified(entry, &key) {
                    return Ok((key, true));
                }
            }
            _ => {}
        }

        // Never mint a new key over existing data: it would make that data unreadable.
        if self.has_documents() {
            return Err(VaultError::Key(
                "无法从系统凭据库读取主密钥（凭据库可能被锁定或不可用），请解锁后重试".into(),
            ));
        }
        let key = random_key();
        write_key_file(key_file, &key)?;
        Ok((key, false))
    }

    fn has_documents(&self) -> bool {
        let Ok(namespaces) = fs::read_dir(&self.root) else {
            return false;
        };
        namespaces.flatten().any(|ns| {
            fs::read_dir(ns.path())
                .map(|mut docs| docs.next().is_some())
                .unwrap_or(false)
        })
    }
}

fn keyring_entry() -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
}

/// Some backends accept writes they cannot persist, so read the secret back.
fn store_verified(entry: &keyring::Entry, key: &[u8; KEY_LEN]) -> bool {
    entry.set_secret(key).is_ok() && entry.get_secret().is_ok_and(|s| s == key)
}

fn random_key() -> [u8; KEY_LEN] {
    Aes256Gcm::generate_key(OsRng).into()
}

fn read_key_file(path: &Path) -> Result<Option<[u8; KEY_LEN]>> {
    match fs::read(path) {
        Ok(bytes) => bytes
            .try_into()
            .map(Some)
            .map_err(|_| VaultError::Key("本地密钥文件已损坏".into())),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn write_key_file(path: &Path, key: &[u8; KEY_LEN]) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(key)?;
    file.sync_all()?;
    Ok(())
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    let dir = path
        .parent()
        .expect("document paths always have a namespace dir");
    fs::create_dir_all(dir)?;
    let tmp = path.with_extension("bin.tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn remove_dir_if_exists(path: &Path) -> Result<()> {
    match fs::remove_dir_all(path) {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

fn aad(ns: &str, key: &str) -> Vec<u8> {
    format!("memory-pet/vault/v1\0{ns}\0{key}").into_bytes()
}

fn validate_name(name: &str) -> Result<()> {
    let ok = !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
    if ok {
        Ok(())
    } else {
        Err(VaultError::InvalidName(
            name.chars().take(MAX_NAME_LEN).collect(),
        ))
    }
}

fn ensure_public(ns: &str) -> Result<()> {
    if ns == SECRETS_NS {
        Err(VaultError::Reserved)
    } else {
        Ok(())
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let dir = app.path().app_data_dir()?;
    app.manage::<SharedVault>(Arc::new(Vault::new(dir.join("vault"), dir.join(KEY_FILE))));
    Ok(())
}

/// Runs vault I/O off the async runtime; key loading may block on the OS credential store.
pub async fn run<T, F>(vault: &SharedVault, f: F) -> std::result::Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Vault) -> Result<T> + Send + 'static,
{
    let vault = Arc::clone(vault);
    tauri::async_runtime::spawn_blocking(move || f(&vault))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn vault_put(
    vault: State<'_, SharedVault>,
    ns: String,
    key: String,
    value: Value,
) -> std::result::Result<(), String> {
    run(&vault, move |v| {
        ensure_public(&ns)?;
        v.put(&ns, &key, &value)
    })
    .await
}

#[tauri::command]
pub async fn vault_get(
    vault: State<'_, SharedVault>,
    ns: String,
    key: String,
) -> std::result::Result<Option<Value>, String> {
    run(&vault, move |v| {
        ensure_public(&ns)?;
        v.get(&ns, &key)
    })
    .await
}

#[tauri::command]
pub async fn vault_delete(
    vault: State<'_, SharedVault>,
    ns: String,
    key: String,
) -> std::result::Result<(), String> {
    run(&vault, move |v| {
        ensure_public(&ns)?;
        v.delete(&ns, &key)
    })
    .await
}

#[tauri::command]
pub async fn vault_list(
    vault: State<'_, SharedVault>,
    ns: String,
) -> std::result::Result<Vec<String>, String> {
    run(&vault, move |v| {
        ensure_public(&ns)?;
        v.list(&ns)
    })
    .await
}

#[tauri::command]
pub async fn vault_wipe(
    vault: State<'_, SharedVault>,
    ns: Option<String>,
) -> std::result::Result<(), String> {
    run(&vault, move |v| {
        if let Some(ns) = &ns {
            ensure_public(ns)?;
        }
        v.wipe(ns.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn vault_status(
    vault: State<'_, SharedVault>,
) -> std::result::Result<VaultStatus, String> {
    run(&vault, |v| v.status()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vault(dir: &tempfile::TempDir, key: u8) -> Vault {
        Vault::with_key(dir.path().join("vault"), [key; KEY_LEN])
    }

    fn file(dir: &tempfile::TempDir, ns: &str, key: &str) -> PathBuf {
        dir.path().join("vault").join(ns).join(format!("{key}.bin"))
    }

    #[test]
    fn round_trips_json() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(&dir, 1);
        let value = json!({ "name": "小明", "n": [1, 2, 3] });
        v.put("characters", "c1", &value).unwrap();
        assert_eq!(v.get("characters", "c1").unwrap(), Some(value));
        assert_eq!(v.get("characters", "missing").unwrap(), None);
    }

    #[test]
    fn ciphertext_does_not_contain_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(&dir, 1);
        let secret = "绝密内容-plain-text-marker";
        v.put("notes", "n1", &json!(secret)).unwrap();
        let raw = fs::read(file(&dir, "notes", "n1")).unwrap();
        assert!(!raw.windows(secret.len()).any(|w| w == secret.as_bytes()));
        assert!(!raw.windows(10).any(|w| w == b"plain-text"));

        v.put("notes", "n1", &json!(secret)).unwrap();
        let again = fs::read(file(&dir, "notes", "n1")).unwrap();
        assert_ne!(raw, again, "nonce must be random per write");
    }

    #[test]
    fn wrong_key_cannot_decrypt() {
        let dir = tempfile::tempdir().unwrap();
        vault(&dir, 1).put("notes", "n1", &json!("hi")).unwrap();
        assert!(matches!(
            vault(&dir, 2).get("notes", "n1"),
            Err(VaultError::Decrypt)
        ));
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(&dir, 1);
        v.put("notes", "n1", &json!("hello")).unwrap();
        let path = file(&dir, "notes", "n1");
        let mut raw = fs::read(&path).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0x01;
        fs::write(&path, &raw).unwrap();
        assert!(matches!(v.get("notes", "n1"), Err(VaultError::Decrypt)));

        fs::write(&path, b"MPV1short").unwrap();
        assert!(matches!(v.get("notes", "n1"), Err(VaultError::Decrypt)));
    }

    #[test]
    fn aad_binds_namespace_and_key() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(&dir, 1);
        v.put("notes", "a", &json!("A")).unwrap();
        v.put("notes", "b", &json!("B")).unwrap();
        fs::copy(file(&dir, "notes", "a"), file(&dir, "notes", "b")).unwrap();
        assert!(matches!(v.get("notes", "b"), Err(VaultError::Decrypt)));

        fs::create_dir_all(dir.path().join("vault/other")).unwrap();
        fs::copy(file(&dir, "notes", "a"), file(&dir, "other", "a")).unwrap();
        assert!(matches!(v.get("other", "a"), Err(VaultError::Decrypt)));
    }

    #[test]
    fn deleted_documents_are_gone() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(&dir, 1);
        v.put("notes", "n1", &json!(1)).unwrap();
        v.delete("notes", "n1").unwrap();
        assert_eq!(v.get("notes", "n1").unwrap(), None);
        assert!(!file(&dir, "notes", "n1").exists());
        v.delete("notes", "n1").unwrap();
    }

    #[test]
    fn lists_and_wipes() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(&dir, 1);
        assert!(v.list("notes").unwrap().is_empty());
        v.put("notes", "b", &json!(1)).unwrap();
        v.put("notes", "a.v2", &json!(2)).unwrap();
        v.put("other", "x", &json!(3)).unwrap();
        assert_eq!(v.list("notes").unwrap(), ["a.v2", "b"]);

        v.wipe(Some("notes")).unwrap();
        assert!(v.list("notes").unwrap().is_empty());
        assert_eq!(v.get("other", "x").unwrap(), Some(json!(3)));

        v.wipe(None).unwrap();
        assert!(!dir.path().join("vault").exists());
    }

    #[test]
    fn rejects_unsafe_names() {
        let dir = tempfile::tempdir().unwrap();
        let v = vault(&dir, 1);
        for bad in [
            "",
            "..",
            ".hidden",
            "a/b",
            "a\\b",
            "名字",
            "a:b",
            &"x".repeat(129),
        ] {
            assert!(
                matches!(v.put(bad, "k", &json!(1)), Err(VaultError::InvalidName(_))),
                "{bad}"
            );
            assert!(matches!(v.get("ns", bad), Err(VaultError::InvalidName(_))));
        }
        assert!(matches!(
            ensure_public(SECRETS_NS),
            Err(VaultError::Reserved)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn fallback_key_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(KEY_FILE);
        write_key_file(&path, &[7; KEY_LEN]).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(read_key_file(&path).unwrap(), Some([7; KEY_LEN]));
    }
}
