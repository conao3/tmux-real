use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, FixedOffset};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct StatePaths {
    pub state_path: PathBuf,
    pub lock_path: PathBuf,
    pub log_path: PathBuf,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct StateFile {
    pub scheduler_running: bool,
    pub scheduler_pid: Option<u32>,
    pub target_session: Option<String>,
    pub active_challenge: bool,
    pub posting: bool,
    pub stop_requested: bool,
    pub skip_requested: bool,
    pub challenge_started_at: Option<DateTime<FixedOffset>>,
    pub challenge_deadline_at: Option<DateTime<FixedOffset>>,
    pub next_challenge_at: Option<DateTime<FixedOffset>>,
    pub last_gist_url: Option<String>,
    pub last_posted_filename: Option<String>,
}

pub struct LockedState {
    _lock_file: File,
    paths: StatePaths,
    pub state: StateFile,
}

impl StatePaths {
    pub fn for_socket(socket_path: &str) -> Result<Self> {
        let socket_hash = socket_hash(socket_path);
        Self::for_hash(&socket_hash)
    }

    pub fn for_hash(socket_hash: &str) -> Result<Self> {
        let dir = state_home().join("tmux-real");
        fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create state dir {}", dir.display()))?;

        Ok(Self {
            state_path: dir.join(format!("{socket_hash}.json")),
            lock_path: dir.join(format!("{socket_hash}.lock")),
            log_path: dir.join(format!("{socket_hash}.log")),
        })
    }
}

impl LockedState {
    pub fn open(paths: &StatePaths) -> Result<Self> {
        let lock_file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&paths.lock_path)
            .with_context(|| format!("failed to open lock file {}", paths.lock_path.display()))?;
        lock_file
            .lock_exclusive()
            .with_context(|| format!("failed to lock {}", paths.lock_path.display()))?;

        let state = if paths.state_path.exists() {
            let raw = fs::read_to_string(&paths.state_path).with_context(|| {
                format!("failed to read state file {}", paths.state_path.display())
            })?;
            serde_json::from_str(&raw).with_context(|| {
                format!("failed to parse state file {}", paths.state_path.display())
            })?
        } else {
            StateFile::default()
        };

        Ok(Self {
            _lock_file: lock_file,
            paths: paths.clone(),
            state,
        })
    }

    pub fn save(&self) -> Result<()> {
        let raw =
            serde_json::to_string_pretty(&self.state).context("failed to serialize state file")?;
        fs::write(&self.paths.state_path, raw).with_context(|| {
            format!(
                "failed to write state file {}",
                self.paths.state_path.display()
            )
        })
    }
}

pub fn log_event(paths: &StatePaths, message: &str) -> Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.log_path)
        .with_context(|| format!("failed to open log file {}", paths.log_path.display()))?;
    writeln!(file, "{message}")
        .with_context(|| format!("failed to append log file {}", paths.log_path.display()))
}

pub fn socket_hash(socket_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(socket_path.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn state_home() -> PathBuf {
    if let Some(path) = env::var_os("XDG_STATE_HOME") {
        return PathBuf::from(path);
    }

    if let Some(home) = env::var_os("HOME") {
        return Path::new(&home).join(".local").join("state");
    }

    PathBuf::from(".")
}

#[cfg(test)]
mod tests {
    use super::socket_hash;

    #[test]
    fn socket_hash_is_stable() {
        let hash1 = socket_hash("/tmp/tmux-1000/default");
        let hash2 = socket_hash("/tmp/tmux-1000/default");
        let hash3 = socket_hash("/tmp/tmux-1000/other");
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
    }
}
