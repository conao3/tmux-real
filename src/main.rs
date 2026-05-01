mod app;
mod config;
mod gist;
mod state;
mod tmux;

use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "tmux-real")]
#[command(about = "Post tmux pane viewports to secret GitHub gists on timeout.")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Init,
    Status,
    Once,
    Start,
    Skip,
    Stop,
    #[command(name = "post-now")]
    PostNow,
    #[command(hide = true, name = "__daemon")]
    Daemon(DaemonArgs),
}

#[derive(Debug, Args)]
struct DaemonArgs {
    #[arg(long)]
    socket_path: String,
    #[arg(long)]
    socket_hash: String,
    #[arg(long)]
    target_session: String,
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Init => app::cmd_init(),
        Command::Status => app::cmd_status(),
        Command::Once => app::cmd_once(),
        Command::Start => app::cmd_start(),
        Command::Skip => app::cmd_skip(),
        Command::Stop => app::cmd_stop(),
        Command::PostNow => app::cmd_post_now(),
        Command::Daemon(args) => {
            app::cmd_daemon(args.socket_path, args.socket_hash, args.target_session)
        }
    };

    if let Err(err) = result {
        eprintln!("{err:#}");
        std::process::exit(1);
    }
}
