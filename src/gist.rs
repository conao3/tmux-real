use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Local};

pub fn build_filename(now: DateTime<Local>) -> String {
    format!("tmux-real-{}.txt", now.format("%Y%m%d-%H%M%S"))
}

pub fn build_description(session_name: &str, host: &str, now: DateTime<Local>) -> String {
    format!(
        "tmux-real session={session_name} posted_at={} host={host}",
        now.to_rfc3339()
    )
}

pub fn create_secret_gist(gh_path: &str, file: &Path, description: &str) -> Result<String> {
    let output = Command::new(gh_path)
        .args(gist_create_args(file, description))
        .output()
        .with_context(|| format!("failed to execute gh binary: {gh_path}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("gh gist create failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let url = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .context("gh gist create returned no gist URL")?;

    Ok(url.to_owned())
}

pub fn gist_create_args(file: &Path, description: &str) -> Vec<String> {
    vec![
        "gist".to_owned(),
        "create".to_owned(),
        file.to_string_lossy().into_owned(),
        "-d".to_owned(),
        description.to_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use chrono::{Local, TimeZone};
    use std::path::Path;

    use super::{build_description, build_filename, gist_create_args};

    #[test]
    fn build_filename_matches_spec() {
        let now = Local.with_ymd_and_hms(2026, 5, 2, 2, 15, 0).unwrap();
        assert_eq!(build_filename(now), "tmux-real-20260502-021500.txt");
    }

    #[test]
    fn build_description_includes_required_fields() {
        let now = Local.with_ymd_and_hms(2026, 5, 2, 2, 15, 0).unwrap();
        let description = build_description("dev", "host1", now);
        assert!(description.contains("tmux-real"));
        assert!(description.contains("session=dev"));
        assert!(description.contains("host=host1"));
    }

    #[test]
    fn gist_args_use_secret_create_form() {
        let args = gist_create_args(Path::new("/tmp/example.txt"), "desc");
        assert_eq!(
            args,
            vec!["gist", "create", "/tmp/example.txt", "-d", "desc"]
        );
    }
}
