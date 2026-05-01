use std::collections::HashSet;

use anyhow::{Context, Result};
use regex::Regex;

use crate::tmux::TmuxClient;

pub const OPTION_INTERVAL_MINUTES: &str = "@tmux-real-interval-minutes";
pub const OPTION_JITTER_MINUTES: &str = "@tmux-real-jitter-minutes";
pub const OPTION_GRACE_SECONDS: &str = "@tmux-real-grace-seconds";
pub const OPTION_GH_PATH: &str = "@tmux-real-gh-path";
pub const OPTION_REDACT_PATTERNS: &str = "@tmux-real-redact-patterns";
pub const OPTION_EXCLUDE_SESSIONS: &str = "@tmux-real-exclude-sessions";
pub const OPTION_EXCLUDE_WINDOWS: &str = "@tmux-real-exclude-windows";
pub const OPTION_EXCLUDE_PANES: &str = "@tmux-real-exclude-panes";

const DEFAULT_INTERVAL_MINUTES: &str = "60";
const DEFAULT_JITTER_MINUTES: &str = "15";
const DEFAULT_GRACE_SECONDS: &str = "120";
const DEFAULT_GH_PATH: &str = "gh";

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub interval_minutes: u64,
    pub jitter_minutes: u64,
    pub grace_seconds: u64,
    pub gh_path: String,
    pub redact_patterns: Vec<Regex>,
    pub exclude_sessions: HashSet<String>,
    pub exclude_windows: HashSet<String>,
    pub exclude_panes: HashSet<String>,
}

pub fn ensure_defaults(tmux: &TmuxClient) -> Result<()> {
    tmux.set_global_option_if_empty(OPTION_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)?;
    tmux.set_global_option_if_empty(OPTION_JITTER_MINUTES, DEFAULT_JITTER_MINUTES)?;
    tmux.set_global_option_if_empty(OPTION_GRACE_SECONDS, DEFAULT_GRACE_SECONDS)?;
    tmux.set_global_option_if_empty(OPTION_GH_PATH, DEFAULT_GH_PATH)?;
    tmux.set_global_option_if_empty(OPTION_REDACT_PATTERNS, "")?;
    tmux.set_global_option_if_empty(OPTION_EXCLUDE_SESSIONS, "")?;
    tmux.set_global_option_if_empty(OPTION_EXCLUDE_WINDOWS, "")?;
    tmux.set_global_option_if_empty(OPTION_EXCLUDE_PANES, "")?;
    Ok(())
}

impl RuntimeConfig {
    pub fn load(tmux: &TmuxClient) -> Result<Self> {
        let interval_minutes = parse_u64(
            tmux.option_or_default(OPTION_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)?,
            OPTION_INTERVAL_MINUTES,
        )?;
        let jitter_minutes = parse_u64(
            tmux.option_or_default(OPTION_JITTER_MINUTES, DEFAULT_JITTER_MINUTES)?,
            OPTION_JITTER_MINUTES,
        )?;
        let grace_seconds = parse_u64(
            tmux.option_or_default(OPTION_GRACE_SECONDS, DEFAULT_GRACE_SECONDS)?,
            OPTION_GRACE_SECONDS,
        )?;
        let gh_path = tmux.option_or_default(OPTION_GH_PATH, DEFAULT_GH_PATH)?;
        let redact_patterns =
            compile_patterns(&tmux.option_or_default(OPTION_REDACT_PATTERNS, "")?)?;
        let exclude_sessions = parse_csv_set(&tmux.option_or_default(OPTION_EXCLUDE_SESSIONS, "")?);
        let exclude_windows = parse_csv_set(&tmux.option_or_default(OPTION_EXCLUDE_WINDOWS, "")?);
        let exclude_panes = parse_csv_set(&tmux.option_or_default(OPTION_EXCLUDE_PANES, "")?);

        Ok(Self {
            interval_minutes,
            jitter_minutes,
            grace_seconds,
            gh_path,
            redact_patterns,
            exclude_sessions,
            exclude_windows,
            exclude_panes,
        })
    }
}

fn parse_u64(raw: String, option: &str) -> Result<u64> {
    raw.parse::<u64>()
        .with_context(|| format!("failed to parse {option} as u64: {raw}"))
}

fn compile_patterns(raw: &str) -> Result<Vec<Regex>> {
    raw.split("||")
        .filter(|part| !part.trim().is_empty())
        .map(|pattern| {
            Regex::new(pattern).with_context(|| format!("invalid redact regex: {pattern}"))
        })
        .collect()
}

fn parse_csv_set(raw: &str) -> HashSet<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{compile_patterns, parse_csv_set};

    #[test]
    fn parse_csv_set_ignores_empty_segments() {
        let parsed = parse_csv_set("a, b,,c");
        assert!(parsed.contains("a"));
        assert!(parsed.contains("b"));
        assert!(parsed.contains("c"));
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn compile_patterns_supports_multiple_regexes() {
        let patterns = compile_patterns("foo||bar[0-9]+").expect("patterns should compile");
        assert_eq!(patterns.len(), 2);
        assert!(patterns[0].is_match("foo"));
        assert!(patterns[1].is_match("bar12"));
    }
}
