use std::collections::HashSet;
use std::env;
use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Duration as ChronoDuration, FixedOffset, Local};
use rand::Rng;
use tempfile::tempdir;
use which::which;

use crate::config::{self, RuntimeConfig};
use crate::gist;
use crate::state::{self, LockedState, StateFile, StatePaths};
use crate::tmux::{Pane, TmuxClient, Window};

const START_THRESHOLDS: [u64; 8] = [60, 30, 10, 5, 4, 3, 2, 1];

pub fn cmd_init() -> Result<()> {
    let tmux = TmuxClient::for_current_client()?;
    config::ensure_defaults(&tmux)?;
    Ok(())
}

pub fn cmd_status() -> Result<()> {
    let tmux = TmuxClient::for_server_context()?;
    let paths = StatePaths::for_socket(tmux.socket_path())?;
    let mut locked = LockedState::open(&paths)?;
    normalize_stale_state(&mut locked.state);
    locked.save()?;

    println!(
        "scheduler: {}",
        if locked.state.scheduler_running {
            "running"
        } else {
            "stopped"
        }
    );
    println!(
        "target_session: {}",
        locked.state.target_session.as_deref().unwrap_or("none")
    );
    println!(
        "active_challenge: {}",
        if locked.state.active_challenge {
            "yes"
        } else {
            "no"
        }
    );
    println!(
        "next_challenge_at: {}",
        format_optional_time(locked.state.next_challenge_at.as_ref())
    );
    println!(
        "last_gist_url: {}",
        locked.state.last_gist_url.as_deref().unwrap_or("none")
    );
    println!(
        "last_posted_filename: {}",
        locked
            .state
            .last_posted_filename
            .as_deref()
            .unwrap_or("none")
    );
    Ok(())
}

pub fn cmd_start() -> Result<()> {
    let tmux = TmuxClient::for_current_client()?;
    config::ensure_defaults(&tmux)?;
    let config = RuntimeConfig::load(&tmux)?;
    ensure_gh_ready(&config)?;

    let session = tmux.current_session_name()?;
    ensure_session_allowed(&config, &session)?;

    let paths = StatePaths::for_socket(tmux.socket_path())?;
    {
        let mut locked = LockedState::open(&paths)?;
        normalize_stale_state(&mut locked.state);

        if locked.state.scheduler_running {
            if locked.state.target_session.as_deref() == Some(session.as_str()) {
                locked.save()?;
                return Ok(());
            }

            bail!(
                "scheduler already running for target={}",
                locked.state.target_session.as_deref().unwrap_or("unknown")
            );
        }

        locked.state.scheduler_running = true;
        locked.state.target_session = Some(session.clone());
        locked.state.active_challenge = false;
        locked.state.posting = false;
        locked.state.skip_requested = false;
        locked.state.stop_requested = false;
        locked.state.challenge_started_at = None;
        locked.state.challenge_deadline_at = None;
        locked.state.next_challenge_at = Some(next_challenge_at(&config));
        locked.save()?;
    }

    spawn_daemon(&tmux, &paths, &session).or_else(|err| {
        let mut locked = LockedState::open(&paths)?;
        locked.state.scheduler_running = false;
        locked.state.scheduler_pid = None;
        locked.state.target_session = None;
        locked.state.active_challenge = false;
        locked.state.posting = false;
        locked.state.skip_requested = false;
        locked.state.stop_requested = false;
        locked.state.challenge_started_at = None;
        locked.state.challenge_deadline_at = None;
        locked.state.next_challenge_at = None;
        locked.save()?;
        Err(err)
    })
}

pub fn cmd_once() -> Result<()> {
    let tmux = TmuxClient::for_current_client()?;
    config::ensure_defaults(&tmux)?;
    let config = RuntimeConfig::load(&tmux)?;
    ensure_gh_ready(&config)?;

    let session = tmux.current_session_name()?;
    ensure_session_allowed(&config, &session)?;

    let paths = StatePaths::for_socket(tmux.socket_path())?;
    {
        let mut locked = LockedState::open(&paths)?;
        normalize_stale_state(&mut locked.state);
        if locked.state.scheduler_running || locked.state.active_challenge {
            bail!("cannot run once while scheduler or challenge is already active");
        }

        locked.state.scheduler_running = false;
        locked.state.scheduler_pid = None;
        locked.state.target_session = Some(session.clone());
        locked.state.active_challenge = false;
        locked.state.posting = false;
        locked.state.skip_requested = false;
        locked.state.stop_requested = false;
        locked.state.challenge_started_at = None;
        locked.state.challenge_deadline_at = None;
        locked.state.next_challenge_at = None;
        locked.save()?;
    }

    run_single_challenge(&tmux, &paths, &config, &session)
}

pub fn cmd_skip() -> Result<()> {
    let tmux = TmuxClient::for_server_context()?;
    let paths = StatePaths::for_socket(tmux.socket_path())?;
    let target_session = {
        let mut locked = LockedState::open(&paths)?;
        normalize_stale_state(&mut locked.state);

        if !locked.state.active_challenge {
            bail!("no active challenge to skip");
        }
        if locked.state.posting {
            bail!("challenge is already posting; skip is no longer possible");
        }

        locked.state.skip_requested = true;
        let target_session = locked
            .state
            .target_session
            .clone()
            .ok_or_else(|| anyhow!("active challenge has no target session"))?;
        locked.save()?;
        target_session
    };

    tmux.display_message_best_effort(
        &target_session,
        &format!("[tmux-real] skipped current challenge for target={target_session}"),
    );

    Ok(())
}

pub fn cmd_stop() -> Result<()> {
    let tmux = TmuxClient::for_server_context()?;
    let paths = StatePaths::for_socket(tmux.socket_path())?;
    let maybe_target = {
        let mut locked = LockedState::open(&paths)?;
        normalize_stale_state(&mut locked.state);

        if !locked.state.scheduler_running && !locked.state.active_challenge {
            locked.save()?;
            return Ok(());
        }

        locked.state.scheduler_running = false;
        locked.state.stop_requested = true;
        locked.state.next_challenge_at = None;
        let target = locked.state.target_session.clone();
        locked.save()?;
        target
    };

    if let Some(target_session) = maybe_target {
        tmux.display_message_best_effort(
            &target_session,
            &format!("[tmux-real] scheduler stopped for target={target_session}"),
        );
    }

    Ok(())
}

pub fn cmd_post_now() -> Result<()> {
    let tmux = TmuxClient::for_current_client()?;
    config::ensure_defaults(&tmux)?;
    let config = RuntimeConfig::load(&tmux)?;
    ensure_gh_ready(&config)?;

    let session = tmux.current_session_name()?;
    ensure_session_allowed(&config, &session)?;

    let paths = StatePaths::for_socket(tmux.socket_path())?;
    let result = capture_and_post(&tmux, &paths, &config, &session)?;
    tmux.display_message_best_effort(&session, &format!("[tmux-real] posted {}", result.gist_url));
    Ok(())
}

pub fn cmd_daemon(socket_path: String, socket_hash: String, target_session: String) -> Result<()> {
    let tmux = TmuxClient::from_socket_path(socket_path);
    let paths = StatePaths::for_hash(&socket_hash)?;

    {
        let mut locked = LockedState::open(&paths)?;
        locked.state.scheduler_running = true;
        locked.state.scheduler_pid = Some(std::process::id());
        locked.state.target_session = Some(target_session.clone());
        if locked.state.next_challenge_at.is_none() {
            let config = RuntimeConfig::load(&tmux)?;
            locked.state.next_challenge_at = Some(next_challenge_at(&config));
        }
        locked.save()?;
    }

    loop {
        let config = RuntimeConfig::load(&tmux)?;
        let state_snapshot = {
            let mut locked = LockedState::open(&paths)?;
            normalize_stale_state(&mut locked.state);
            locked.save()?;
            locked.state.clone()
        };

        if !state_snapshot.scheduler_running {
            finalize_daemon_exit(&paths)?;
            break;
        }

        if !tmux.has_session(&target_session) {
            append_log(
                &paths,
                &format!(
                    "{} target_session_missing target={target_session}",
                    now_fixed().to_rfc3339()
                ),
            )?;
            let mut locked = LockedState::open(&paths)?;
            locked.state.scheduler_running = false;
            locked.state.scheduler_pid = None;
            locked.state.target_session = None;
            locked.state.active_challenge = false;
            locked.state.posting = false;
            locked.state.skip_requested = false;
            locked.state.stop_requested = false;
            locked.state.challenge_started_at = None;
            locked.state.challenge_deadline_at = None;
            locked.state.next_challenge_at = None;
            locked.save()?;
            finalize_daemon_exit(&paths)?;
            break;
        }

        let next = state_snapshot
            .next_challenge_at
            .unwrap_or_else(|| next_challenge_at(&config));

        if now_fixed() < next {
            thread::sleep(Duration::from_secs(1));
            continue;
        }

        run_scheduler_challenge(&tmux, &paths, &config, &target_session)?;
    }

    Ok(())
}

fn run_scheduler_challenge(
    tmux: &TmuxClient,
    paths: &StatePaths,
    config: &RuntimeConfig,
    target_session: &str,
) -> Result<()> {
    start_challenge_state(paths, target_session, config.grace_seconds)?;

    let deadline = {
        let locked = LockedState::open(paths)?;
        locked
            .state
            .challenge_deadline_at
            .ok_or_else(|| anyhow!("challenge deadline was not set"))?
    };

    tmux.display_message_best_effort(
        target_session,
        &start_message(target_session, config.grace_seconds, deadline),
    );
    append_log(
        paths,
        &format!(
            "{} challenge_started target={} deadline={}",
            now_fixed().to_rfc3339(),
            target_session,
            deadline.to_rfc3339()
        ),
    )?;

    let mut sent_thresholds = HashSet::new();

    loop {
        let snapshot = {
            let locked = LockedState::open(paths)?;
            locked.state.clone()
        };

        if snapshot.stop_requested && !snapshot.posting {
            finish_challenge(paths, ChallengeOutcome::Stopped, config, None)?;
            break;
        }

        if snapshot.skip_requested && !snapshot.posting {
            finish_challenge(paths, ChallengeOutcome::Skipped, config, None)?;
            break;
        }

        let now = now_fixed();
        if now >= deadline {
            {
                let mut locked = LockedState::open(paths)?;
                locked.state.posting = true;
                locked.save()?;
            }

            tmux.display_message_best_effort(
                target_session,
                &format!(
                    "[tmux-real] target={target_session} timeout reached; capturing panes and creating secret gist..."
                ),
            );

            let post_result = capture_and_post(tmux, paths, config, target_session);
            match post_result {
                Ok(result) => {
                    append_log(
                        paths,
                        &format!(
                            "{} gist_posted target={} url={}",
                            now_fixed().to_rfc3339(),
                            target_session,
                            result.gist_url
                        ),
                    )?;
                    tmux.display_message_best_effort(
                        target_session,
                        &format!("[tmux-real] posted {}", result.gist_url),
                    );
                    finish_challenge(paths, ChallengeOutcome::Posted, config, Some(result))?;
                }
                Err(err) => {
                    append_log(
                        paths,
                        &format!(
                            "{} gist_post_failed target={} error={}",
                            now_fixed().to_rfc3339(),
                            target_session,
                            summarize_error(&err)
                        ),
                    )?;
                    tmux.display_message_best_effort(
                        target_session,
                        &format!("[tmux-real] error {}", summarize_error(&err)),
                    );
                    finish_challenge(paths, ChallengeOutcome::Failed, config, None)?;
                }
            }
            break;
        }

        let remaining = (deadline.timestamp() - now.timestamp()).max(0) as u64;
        for threshold in START_THRESHOLDS {
            if remaining <= threshold && sent_thresholds.insert(threshold) {
                tmux.display_message_best_effort(
                    target_session,
                    &format!(
                        "[tmux-real] target={target_session} remaining={remaining}s skip='tmux-real skip' stop='tmux-real stop'"
                    ),
                );
            }
        }

        thread::sleep(Duration::from_secs(1));
    }

    Ok(())
}

fn run_single_challenge(
    tmux: &TmuxClient,
    paths: &StatePaths,
    config: &RuntimeConfig,
    target_session: &str,
) -> Result<()> {
    start_challenge_state(paths, target_session, config.grace_seconds)?;

    let deadline = {
        let locked = LockedState::open(paths)?;
        locked
            .state
            .challenge_deadline_at
            .ok_or_else(|| anyhow!("challenge deadline was not set"))?
    };

    tmux.display_message_best_effort(
        target_session,
        &start_message(target_session, config.grace_seconds, deadline),
    );
    let mut sent_thresholds = HashSet::new();

    loop {
        let snapshot = {
            let locked = LockedState::open(paths)?;
            locked.state.clone()
        };

        if snapshot.stop_requested && !snapshot.posting {
            finish_single_challenge(paths, target_session, ChallengeOutcome::Stopped)?;
            break;
        }

        if snapshot.skip_requested && !snapshot.posting {
            finish_single_challenge(paths, target_session, ChallengeOutcome::Skipped)?;
            break;
        }

        let now = now_fixed();
        if now >= deadline {
            {
                let mut locked = LockedState::open(paths)?;
                locked.state.posting = true;
                locked.save()?;
            }

            tmux.display_message_best_effort(
                target_session,
                &format!(
                    "[tmux-real] target={target_session} timeout reached; capturing panes and creating secret gist..."
                ),
            );
            let result = capture_and_post(tmux, paths, config, target_session)?;
            tmux.display_message_best_effort(
                target_session,
                &format!("[tmux-real] posted {}", result.gist_url),
            );

            let mut locked = LockedState::open(paths)?;
            locked.state.scheduler_running = false;
            locked.state.scheduler_pid = None;
            locked.state.target_session = None;
            locked.state.active_challenge = false;
            locked.state.posting = false;
            locked.state.skip_requested = false;
            locked.state.stop_requested = false;
            locked.state.challenge_started_at = None;
            locked.state.challenge_deadline_at = None;
            locked.state.next_challenge_at = None;
            locked.state.last_gist_url = Some(result.gist_url);
            locked.state.last_posted_filename = Some(result.filename);
            locked.save()?;
            break;
        }

        let remaining = (deadline.timestamp() - now.timestamp()).max(0) as u64;
        for threshold in START_THRESHOLDS {
            if remaining <= threshold && sent_thresholds.insert(threshold) {
                tmux.display_message_best_effort(
                    target_session,
                    &format!(
                        "[tmux-real] target={target_session} remaining={remaining}s skip='tmux-real skip' stop='tmux-real stop'"
                    ),
                );
            }
        }

        thread::sleep(Duration::from_secs(1));
    }

    Ok(())
}

fn start_challenge_state(
    paths: &StatePaths,
    target_session: &str,
    grace_seconds: u64,
) -> Result<()> {
    let mut locked = LockedState::open(paths)?;
    let started_at = now_fixed();
    let deadline = started_at + ChronoDuration::seconds(grace_seconds as i64);

    locked.state.target_session = Some(target_session.to_owned());
    locked.state.active_challenge = true;
    locked.state.posting = false;
    locked.state.skip_requested = false;
    locked.state.stop_requested = false;
    locked.state.challenge_started_at = Some(started_at);
    locked.state.challenge_deadline_at = Some(deadline);
    locked.save()
}

fn finish_challenge(
    paths: &StatePaths,
    outcome: ChallengeOutcome,
    config: &RuntimeConfig,
    post_result: Option<PostResult>,
) -> Result<()> {
    let mut locked = LockedState::open(paths)?;
    let should_continue = locked.state.scheduler_running && !locked.state.stop_requested;
    let should_stop = locked.state.stop_requested || !locked.state.scheduler_running;

    locked.state.active_challenge = false;
    locked.state.posting = false;
    locked.state.skip_requested = false;
    locked.state.challenge_started_at = None;
    locked.state.challenge_deadline_at = None;

    if let Some(result) = post_result {
        locked.state.last_gist_url = Some(result.gist_url);
        locked.state.last_posted_filename = Some(result.filename);
    }

    if should_continue {
        locked.state.next_challenge_at = Some(next_challenge_at(config));
    } else {
        locked.state.scheduler_running = false;
        locked.state.scheduler_pid = None;
        locked.state.next_challenge_at = None;
    }

    if matches!(outcome, ChallengeOutcome::Stopped) {
        locked.state.scheduler_running = false;
        locked.state.scheduler_pid = None;
        locked.state.next_challenge_at = None;
    }

    if should_stop && matches!(outcome, ChallengeOutcome::Posted | ChallengeOutcome::Failed) {
        locked.state.scheduler_running = false;
        locked.state.scheduler_pid = None;
        locked.state.next_challenge_at = None;
    }

    locked.state.stop_requested = false;
    locked.save()
}

fn finish_single_challenge(
    paths: &StatePaths,
    target_session: &str,
    outcome: ChallengeOutcome,
) -> Result<()> {
    let mut locked = LockedState::open(paths)?;
    locked.state.scheduler_running = false;
    locked.state.scheduler_pid = None;
    locked.state.target_session = None;
    locked.state.active_challenge = false;
    locked.state.posting = false;
    locked.state.skip_requested = false;
    locked.state.stop_requested = false;
    locked.state.challenge_started_at = None;
    locked.state.challenge_deadline_at = None;
    locked.state.next_challenge_at = None;
    locked.save()?;

    let tmux = TmuxClient::for_server_context()?;
    match outcome {
        ChallengeOutcome::Skipped => tmux.display_message_best_effort(
            target_session,
            &format!("[tmux-real] skipped current challenge for target={target_session}"),
        ),
        ChallengeOutcome::Stopped => tmux.display_message_best_effort(
            target_session,
            &format!("[tmux-real] scheduler stopped for target={target_session}"),
        ),
        _ => {}
    }
    Ok(())
}

fn capture_and_post(
    tmux: &TmuxClient,
    paths: &StatePaths,
    config: &RuntimeConfig,
    target_session: &str,
) -> Result<PostResult> {
    ensure_session_allowed(config, target_session)?;
    if !tmux.has_session(target_session) {
        bail!("target session no longer exists: {target_session}");
    }

    let now = Local::now();
    let host = hostname()?;
    let filename = gist::build_filename(now);
    let description = gist::build_description(target_session, &host, now);
    let capture = build_capture_body(tmux, config, target_session, &host)?;

    let temp_dir = tempdir().context("failed to create temp dir for gist file")?;
    let file_path = temp_dir.path().join(&filename);
    let mut file = fs::File::create(&file_path)
        .with_context(|| format!("failed to create temp capture file {}", file_path.display()))?;
    file.write_all(capture.as_bytes())
        .with_context(|| format!("failed to write temp capture file {}", file_path.display()))?;
    file.flush()
        .with_context(|| format!("failed to flush temp capture file {}", file_path.display()))?;

    let gist_url = gist::create_secret_gist(&config.gh_path, &file_path, &description)?;
    {
        let mut locked = LockedState::open(paths)?;
        locked.state.last_gist_url = Some(gist_url.clone());
        locked.state.last_posted_filename = Some(filename.clone());
        locked.save()?;
    }

    Ok(PostResult { gist_url, filename })
}

fn build_capture_body(
    tmux: &TmuxClient,
    config: &RuntimeConfig,
    target_session: &str,
    host: &str,
) -> Result<String> {
    let mut body = String::new();
    body.push_str("=== tmux-real capture ===\n");
    body.push_str(&format!("session: {target_session}\n"));
    body.push_str(&format!("captured_at: {}\n", Local::now().to_rfc3339()));
    body.push_str(&format!("host: {host}\n"));
    body.push_str(&format!("tmux_socket: {}\n\n", tmux.socket_path()));

    let windows = tmux.list_windows(target_session)?;
    for Window { index, name } in windows {
        if config.exclude_windows.contains(&index) {
            continue;
        }

        body.push_str(&format!(
            "--- window {index} name={} ---\n",
            sanitize_inline(&name)
        ));
        let panes = tmux.list_panes(target_session, &index)?;
        for Pane { id, active, title } in panes {
            if config.exclude_panes.contains(&id) {
                continue;
            }

            body.push_str(&format!(
                "--- pane {id} active={} title={} ---\n",
                if active { "true" } else { "false" },
                sanitize_inline(&title),
            ));

            let raw = tmux.capture_pane(&id)?;
            let normalized = normalize_capture(&raw);
            let redacted = redact_capture(normalized, &config.redact_patterns);
            body.push_str(&redacted);
            if !redacted.ends_with('\n') {
                body.push('\n');
            }
            body.push('\n');
        }
    }

    Ok(body)
}

fn ensure_gh_ready(config: &RuntimeConfig) -> Result<()> {
    which(&config.gh_path).with_context(|| format!("gh binary not found: {}", config.gh_path))?;
    let output = Command::new(&config.gh_path)
        .args(["auth", "status"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .with_context(|| format!("failed to execute gh binary: {}", config.gh_path))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("gh auth status failed: {}", stderr.trim());
    }

    Ok(())
}

fn ensure_session_allowed(config: &RuntimeConfig, session: &str) -> Result<()> {
    if config.exclude_sessions.contains(session) {
        bail!("session is excluded from capture: {session}");
    }
    Ok(())
}

fn spawn_daemon(tmux: &TmuxClient, paths: &StatePaths, session: &str) -> Result<()> {
    let current_exe = env::current_exe().context("failed to resolve current executable")?;
    let socket_hash = state::socket_hash(tmux.socket_path());

    let child = Command::new(current_exe)
        .arg("__daemon")
        .arg("--socket-path")
        .arg(tmux.socket_path())
        .arg("--socket-hash")
        .arg(socket_hash)
        .arg("--target-session")
        .arg(session)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed to spawn tmux-real daemon")?;

    let mut locked = LockedState::open(paths)?;
    locked.state.scheduler_pid = Some(child.id());
    locked.save()
}

fn next_challenge_at(config: &RuntimeConfig) -> DateTime<FixedOffset> {
    let mut rng = rand::thread_rng();
    let jitter_seconds = (config.jitter_minutes as i64) * 60;
    let base_seconds = (config.interval_minutes as i64) * 60;
    let offset = if jitter_seconds == 0 {
        0
    } else {
        rng.gen_range(-jitter_seconds..=jitter_seconds)
    };
    let wait_seconds = (base_seconds + offset).max(1);
    now_fixed() + ChronoDuration::seconds(wait_seconds)
}

fn format_optional_time(value: Option<&DateTime<FixedOffset>>) -> String {
    value
        .map(DateTime::<FixedOffset>::to_rfc3339)
        .unwrap_or_else(|| "none".to_owned())
}

fn now_fixed() -> DateTime<FixedOffset> {
    Local::now().fixed_offset()
}

fn hostname() -> Result<String> {
    if let Ok(hostname) = env::var("HOSTNAME") {
        if !hostname.trim().is_empty() {
            return Ok(hostname);
        }
    }

    let output = Command::new("hostname")
        .output()
        .context("failed to execute hostname command")?;
    if !output.status.success() {
        bail!("hostname command failed");
    }

    let hostname = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if hostname.is_empty() {
        bail!("hostname command returned an empty hostname");
    }

    Ok(hostname)
}

fn normalize_capture(raw: &str) -> String {
    let stripped = strip_ansi_escapes::strip(raw.as_bytes());
    let text = String::from_utf8_lossy(&stripped);
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\0', "")
}

fn redact_capture(mut capture: String, patterns: &[regex::Regex]) -> String {
    for pattern in patterns {
        capture = pattern.replace_all(&capture, "[REDACTED]").into_owned();
    }
    capture
}

fn sanitize_inline(text: &str) -> String {
    text.replace(['\n', '\r', '\t'], " ")
}

fn start_message(
    target_session: &str,
    grace_seconds: u64,
    deadline: DateTime<FixedOffset>,
) -> String {
    format!(
        "[tmux-real] target={target_session} grace={grace_seconds}s deadline={} timeout=post secret gist skip='tmux-real skip' stop='tmux-real stop'",
        deadline.to_rfc3339()
    )
}

fn summarize_error(err: &anyhow::Error) -> String {
    err.to_string().replace('\n', " ")
}

fn append_log(paths: &StatePaths, message: &str) -> Result<()> {
    state::log_event(paths, message)
}

fn finalize_daemon_exit(paths: &StatePaths) -> Result<()> {
    let mut locked = LockedState::open(paths)?;
    locked.state.scheduler_running = false;
    locked.state.scheduler_pid = None;
    locked.state.active_challenge = false;
    locked.state.posting = false;
    locked.state.skip_requested = false;
    locked.state.stop_requested = false;
    locked.state.challenge_started_at = None;
    locked.state.challenge_deadline_at = None;
    locked.state.next_challenge_at = None;
    locked.save()
}

fn normalize_stale_state(state: &mut StateFile) {
    if state.scheduler_running {
        if let Some(pid) = state.scheduler_pid {
            if !pid_is_alive(pid) {
                state.scheduler_running = false;
                state.scheduler_pid = None;
                state.target_session = None;
                state.active_challenge = false;
                state.posting = false;
                state.skip_requested = false;
                state.stop_requested = false;
                state.challenge_started_at = None;
                state.challenge_deadline_at = None;
                state.next_challenge_at = None;
            }
        }
    }
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as i32, 0) };
    if result == 0 {
        return true;
    }

    let errno = std::io::Error::last_os_error().raw_os_error();
    errno == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn pid_is_alive(_pid: u32) -> bool {
    true
}

#[derive(Debug)]
struct PostResult {
    gist_url: String,
    filename: String,
}

#[derive(Debug, Clone, Copy)]
enum ChallengeOutcome {
    Skipped,
    Stopped,
    Posted,
    Failed,
}

#[cfg(test)]
mod tests {
    use anyhow::anyhow;
    use regex::Regex;

    use super::{normalize_capture, redact_capture, sanitize_inline, summarize_error};

    #[test]
    fn normalize_capture_strips_ansi_and_crlf() {
        let normalized = normalize_capture("\u{1b}[31mred\u{1b}[0m\r\nnext\r");
        assert_eq!(normalized, "red\nnext");
    }

    #[test]
    fn redact_capture_replaces_all_matches() {
        let patterns = vec![Regex::new("secret[0-9]+").expect("regex should compile")];
        let redacted = redact_capture("token=secret123".to_owned(), &patterns);
        assert_eq!(redacted, "token=[REDACTED]");
    }

    #[test]
    fn sanitize_inline_flattens_control_whitespace() {
        assert_eq!(sanitize_inline("a\tb\nc"), "a b c");
    }

    #[test]
    fn summarize_error_keeps_single_line() {
        let err = anyhow!("line1\nline2");
        assert_eq!(summarize_error(&err), "line1 line2");
    }
}
