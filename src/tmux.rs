use std::env;
use std::process::Command;

use anyhow::{bail, Context, Result};

#[derive(Debug, Clone)]
pub struct TmuxClient {
    socket_path: String,
}

#[derive(Debug, Clone)]
pub struct Window {
    pub index: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Pane {
    pub id: String,
    pub active: bool,
    pub title: String,
}

impl TmuxClient {
    pub fn for_current_client() -> Result<Self> {
        let socket_path = parse_tmux_env_socket_path()
            .context("TMUX is not set; run this command inside a tmux client")?;
        Ok(Self { socket_path })
    }

    pub fn for_server_context() -> Result<Self> {
        if let Some(socket_path) = parse_tmux_env_socket_path() {
            return Ok(Self { socket_path });
        }

        let output = Command::new("tmux")
            .args(["display-message", "-p", "#{socket_path}"])
            .output()
            .context("failed to execute tmux")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("failed to resolve tmux socket path: {}", stderr.trim());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let socket_path = stdout.trim();
        if socket_path.is_empty() {
            bail!("tmux returned an empty socket path");
        }

        Ok(Self {
            socket_path: socket_path.to_owned(),
        })
    }

    pub fn from_socket_path(socket_path: impl Into<String>) -> Self {
        Self {
            socket_path: socket_path.into(),
        }
    }

    pub fn socket_path(&self) -> &str {
        &self.socket_path
    }

    pub fn current_session_name(&self) -> Result<String> {
        self.run_text(["display-message", "-p", "#{session_name}"])
    }

    pub fn show_global_option(&self, name: &str) -> Result<Option<String>> {
        let value = self.run_text(["show-options", "-gqv", name])?;
        if value.is_empty() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    }

    pub fn option_or_default(&self, name: &str, default: &str) -> Result<String> {
        Ok(self
            .show_global_option(name)?
            .unwrap_or_else(|| default.to_owned()))
    }

    pub fn set_global_option_if_empty(&self, name: &str, value: &str) -> Result<()> {
        if self.show_global_option(name)?.is_none() {
            self.run_status(["set-option", "-gq", name, value])?;
        }
        Ok(())
    }

    pub fn has_session(&self, session: &str) -> bool {
        self.run_status(["has-session", "-t", &format!("={session}")])
            .is_ok()
    }

    pub fn display_message_best_effort(&self, target_session: &str, message: &str) {
        let _ = self.run_status([
            "display-message",
            "-t",
            &format!("={target_session}"),
            message,
        ]);
    }

    pub fn list_windows(&self, session: &str) -> Result<Vec<Window>> {
        let output = self.run_text([
            "list-windows",
            "-t",
            &format!("={session}"),
            "-F",
            "#{window_index}\t#{window_name}",
        ])?;
        output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                let mut parts = line.splitn(2, '\t');
                let index = parts.next().unwrap_or_default().to_owned();
                let name = parts.next().unwrap_or_default().to_owned();
                Ok(Window { index, name })
            })
            .collect()
    }

    pub fn list_panes(&self, session: &str, window_index: &str) -> Result<Vec<Pane>> {
        let target = format!("={session}:{window_index}");
        let output = self.run_text([
            "list-panes",
            "-t",
            &target,
            "-F",
            "#{pane_id}\t#{?pane_active,true,false}\t#{pane_title}",
        ])?;

        output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                let mut parts = line.splitn(3, '\t');
                let id = parts.next().unwrap_or_default().to_owned();
                let active = parts.next().unwrap_or_default() == "true";
                let title = parts
                    .next()
                    .unwrap_or_default()
                    .replace(['\n', '\r', '\t'], " ");
                Ok(Pane { id, active, title })
            })
            .collect()
    }

    pub fn capture_pane(&self, pane_id: &str) -> Result<String> {
        self.run_text(["capture-pane", "-p", "-t", pane_id])
    }

    fn run_text<const N: usize>(&self, args: [&str; N]) -> Result<String> {
        let output = self.run_output(args)?;
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_owned())
    }

    pub fn run_status<const N: usize>(&self, args: [&str; N]) -> Result<()> {
        self.run_output(args).map(|_| ())
    }

    fn run_output<const N: usize>(&self, args: [&str; N]) -> Result<std::process::Output> {
        let output = Command::new("tmux")
            .arg("-S")
            .arg(&self.socket_path)
            .args(args)
            .output()
            .context("failed to execute tmux")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("tmux command failed: {}", stderr.trim());
        }

        Ok(output)
    }
}

fn parse_tmux_env_socket_path() -> Option<String> {
    let tmux = env::var("TMUX").ok()?;
    tmux.split(',')
        .next()
        .map(ToOwned::to_owned)
        .filter(|part| !part.is_empty())
}
