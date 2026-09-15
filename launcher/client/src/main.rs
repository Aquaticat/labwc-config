//! Command-line client for the resident launcher daemon.
//!
//! - `labwc-launcher toggle` shows the application launcher, or hides whatever is shown.
//! - `labwc-launcher close` hides whatever is shown.
//! - `labwc-launcher launch APP_ID` starts another instance of the application behind a window's app ID.
//! - `labwc-launcher run [--] COMMAND [ARGUMENT...]` runs a command as its own UWSM unit.
//! - `labwc-launcher dmenu [--prompt TEXT | -p TEXT]` reads choices from standard input, one per line, and prints the chosen line.
//!
//! A cancelled dmenu exits with status 1, as dmenu and fuzzel do; usage and connection failures exit with status 2.

use std::{
    env, error, fmt,
    io::{self, Read, Write},
    net::Shutdown,
    os::unix::net::UnixStream,
    path::PathBuf,
    process::ExitCode,
};

use launcher_core::protocol::{Reply, Request, SOCKET_NAME, decode_reply, encode_request};

/// Exit status when the user dismissed a dmenu.
const CANCELLED: u8 = 1;
/// Exit status for usage and connection failures.
const FAILED: u8 = 2;
/// Usage text shown for unknown command lines.
const USAGE: &str = "usage: labwc-launcher toggle | close | launch APP_ID | run [--] COMMAND [ARGUMENT...] | dmenu [--prompt TEXT | -p TEXT]";

/// Why the client could not complete a request.
#[derive(Debug)]
enum ClientError {
    /// The command line is not understood.
    Usage(String),
    /// `XDG_RUNTIME_DIR` is unset, so the socket cannot be located.
    NoRuntimeDir,
    /// Reading standard input or talking to the daemon failed.
    Io {
        /// What the client was doing.
        context: &'static str,
        /// The underlying failure.
        source: io::Error,
    },
    /// The daemon's reply was not UTF-8.
    InvalidReply,
}

impl fmt::Display for ClientError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Usage(problem) => write!(formatter, "{problem}\n{USAGE}"),
            Self::NoRuntimeDir => write!(
                formatter,
                "XDG_RUNTIME_DIR is not set, so the launcher socket cannot be found"
            ),
            Self::Io { context, source } => write!(formatter, "{context}: {source}"),
            Self::InvalidReply => write!(
                formatter,
                "the launcher daemon replied with bytes that are not UTF-8"
            ),
        }
    }
}

impl error::Error for ClientError {
    fn source(&self) -> Option<&(dyn error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// Returns a mapper that wraps an I/O error with what the client was doing.
fn io_error(context: &'static str) -> impl FnOnce(io::Error) -> ClientError {
    move |source| ClientError::Io { context, source }
}

/// What the command line asks for.
#[derive(Debug, Eq, PartialEq)]
enum Invocation {
    /// A request that needs nothing from standard input.
    Send(Request),
    /// A dmenu request whose choices come from standard input.
    Dmenu {
        /// Text shown before the query.
        prompt: String,
    },
}

/// Parses the arguments after the program name.
///
/// # Errors
///
/// Returns a description of the problem for unknown commands, missing arguments, unknown dmenu options,
/// and arguments containing line breaks, which the line-based protocol cannot carry.
fn parse_command_line(arguments: &[String]) -> Result<Invocation, String> {
    if arguments.iter().any(|argument| argument.contains('\n')) {
        return Err("arguments cannot contain line breaks".to_owned());
    }
    match arguments {
        [command] if command == "toggle" => Ok(Invocation::Send(Request::Toggle)),
        [command] if command == "close" => Ok(Invocation::Send(Request::Close)),
        [command, app_id] if command == "launch" && !app_id.is_empty() => {
            Ok(Invocation::Send(Request::Launch {
                app_id: app_id.clone(),
            }))
        }
        [command, rest @ ..] if command == "run" => {
            let argv = rest.strip_prefix(&["--".to_owned()]).unwrap_or(rest);
            if argv.first().is_none_or(String::is_empty) {
                return Err("run needs a command".to_owned());
            }
            Ok(Invocation::Send(Request::Run {
                argv: argv.to_vec(),
            }))
        }
        [command, options @ ..] if command == "dmenu" => {
            let prompt = match options {
                [] => String::new(),
                [flag, prompt] if flag == "--prompt" || flag == "-p" => prompt.clone(),
                [option] if option.starts_with("--prompt=") => {
                    option["--prompt=".len()..].to_owned()
                }
                _ => return Err(format!("unknown dmenu options: {}", options.join(" "))),
            };
            Ok(Invocation::Dmenu { prompt })
        }
        _ => Err(format!("unknown command line: {}", arguments.join(" "))),
    }
}

/// Builds the request described by the command line, reading dmenu choices from standard input.
fn build_request(arguments: &[String]) -> Result<Request, ClientError> {
    match parse_command_line(arguments).map_err(ClientError::Usage)? {
        Invocation::Send(request) => Ok(request),
        Invocation::Dmenu { prompt } => {
            let input = io::read_to_string(io::stdin())
                .map_err(io_error("reading choices from standard input"))?;
            Ok(Request::Dmenu {
                prompt,
                lines: input.lines().map(str::to_owned).collect(),
            })
        }
    }
}

/// Sends the request and returns the exit status to use.
fn run() -> Result<u8, ClientError> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let request = build_request(&arguments)?;
    let runtime_dir = env::var_os("XDG_RUNTIME_DIR").ok_or(ClientError::NoRuntimeDir)?;
    let mut stream = UnixStream::connect(PathBuf::from(runtime_dir).join(SOCKET_NAME))
        .map_err(io_error("connecting to the launcher daemon"))?;
    stream
        .write_all(&encode_request(&request))
        .map_err(io_error("sending the request"))?;
    stream
        .shutdown(Shutdown::Write)
        .map_err(io_error("finishing the request"))?;
    let mut reply = Vec::new();
    stream
        .read_to_end(&mut reply)
        .map_err(io_error("reading the reply"))?;
    if !matches!(request, Request::Dmenu { .. }) {
        return Ok(0);
    }
    match decode_reply(&reply).map_err(|_| ClientError::InvalidReply)? {
        Reply::Selected(line) => {
            println!("{line}");
            Ok(0)
        }
        Reply::Cancelled => Ok(CANCELLED),
    }
}

/// Runs the client, reporting failures on standard error.
fn main() -> ExitCode {
    match run() {
        Ok(status) => ExitCode::from(status),
        Err(error) => {
            eprintln!("labwc-launcher: {error}");
            ExitCode::from(FAILED)
        }
    }
}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
