# tmux-real

`tmux-real` is a tmux parody tool that periodically challenges a session: skip it in time, or the current viewport of every pane in the target session gets posted to a secret GitHub Gist.

The CLI is written in Rust. The tmux side is a thin TPM-compatible entrypoint plus tmux global user options.

## Development

Enter the development shell:

```sh
nix develop
```

Build:

```sh
cargo build
```

Run tests:

```sh
cargo test
```

## Install

Install from crates.io:

```sh
cargo install tmux-real
```

For local development, install from the current checkout instead:

```sh
cargo install --path .
```

If you want TPM to load the option defaults, add this repository as a tmux plugin:

```tmux
set -g @plugin 'conao3/tmux-real'
run '~/.tmux/plugins/tpm/tpm'
```

No default key bindings are installed. Run the CLI directly from a tmux pane or add your own bindings.

## Commands

Initialize defaults for the current tmux server:

```sh
tmux-real init
```

Start the scheduler for the current session:

```sh
tmux-real start
```

Run a single challenge immediately:

```sh
tmux-real once
```

Skip the active challenge without stopping the scheduler:

```sh
tmux-real skip
```

Stop the scheduler:

```sh
tmux-real stop
```

Post the current session immediately:

```sh
tmux-real post-now
```

Inspect state:

```sh
tmux-real status
```

## Configuration

Configuration is stored in tmux global user options:

- `@tmux-real-interval-minutes`
- `@tmux-real-jitter-minutes`
- `@tmux-real-grace-seconds`
- `@tmux-real-gh-path`
- `@tmux-real-redact-patterns`
- `@tmux-real-exclude-sessions`
- `@tmux-real-exclude-windows`
- `@tmux-real-exclude-panes`

Example:

```tmux
set -g @tmux-real-interval-minutes 30
set -g @tmux-real-grace-seconds 90
set -g @tmux-real-redact-patterns 'ghp_[A-Za-z0-9]+||AIza[0-9A-Za-z_-]+'
```
