//! Wire format between the launcher client and the resident daemon.
//!
//! One request per connection.
//! The client writes the request and shuts down its write side; the daemon answers a dmenu request and closes.

/// File name of the daemon socket inside `XDG_RUNTIME_DIR`.
pub const SOCKET_NAME: &str = "labwc-launcher.sock";

/// What a client asks the daemon to do.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Request {
    /// Show the application launcher, or hide it when already shown.
    Toggle,
    /// Hide whatever the daemon shows, cancelling a pending dmenu request.
    Close,
    /// Let the user pick one of `lines` under `prompt`.
    Dmenu {
        /// Text shown above the choices.
        prompt: String,
        /// Choices in the order given.
        lines: Vec<String>,
    },
}

/// The daemon's answer to a dmenu request.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Reply {
    /// The chosen line.
    Selected(String),
    /// The user dismissed the menu.
    Cancelled,
}

/// Why bytes could not be decoded.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    /// The payload is not UTF-8.
    InvalidUtf8,
    /// The first line names no known command.
    UnknownCommand(String),
}

/// Line terminator used by every message.
const NEWLINE: char = '\n';

/// Splits a payload into lines after removing one final line terminator.
fn payload_lines(bytes: &[u8]) -> Result<Vec<&str>, ProtocolError> {
    let text = std::str::from_utf8(bytes).map_err(|_| ProtocolError::InvalidUtf8)?;
    Ok(text
        .strip_suffix(NEWLINE)
        .unwrap_or(text)
        .split(NEWLINE)
        .collect())
}

/// Serializes a request as newline-terminated lines: the command, then its arguments.
pub fn encode_request(request: &Request) -> Vec<u8> {
    let lines: Vec<&str> = match request {
        Request::Toggle => vec!["toggle"],
        Request::Close => vec!["close"],
        Request::Dmenu { prompt, lines } => ["dmenu", prompt.as_str()]
            .into_iter()
            .chain(lines.iter().map(String::as_str))
            .collect(),
    };
    lines
        .iter()
        .flat_map(|line| line.bytes().chain(*b"\n"))
        .collect()
}

/// Parses a complete request payload read until the client closed its write side.
///
/// # Errors
///
/// Returns [`ProtocolError::InvalidUtf8`] for non-UTF-8 payloads and
/// [`ProtocolError::UnknownCommand`] when the first line is not a known command.
pub fn decode_request(bytes: &[u8]) -> Result<Request, ProtocolError> {
    let lines = payload_lines(bytes)?;
    let (command, arguments) = lines
        .split_first()
        .map_or(("", &[][..]), |(first, rest)| (*first, rest));
    match command {
        "toggle" => Ok(Request::Toggle),
        "close" => Ok(Request::Close),
        "dmenu" => {
            let (prompt, choices) = arguments
                .split_first()
                .map_or(("", &[][..]), |(first, rest)| (*first, rest));
            Ok(Request::Dmenu {
                prompt: prompt.to_owned(),
                lines: choices.iter().map(|line| (*line).to_owned()).collect(),
            })
        }
        other => Err(ProtocolError::UnknownCommand(other.to_owned())),
    }
}

/// Serializes a dmenu reply: the selected line, or nothing when cancelled.
pub fn encode_reply(reply: &Reply) -> Vec<u8> {
    match reply {
        Reply::Selected(line) => line.bytes().chain(*b"\n").collect(),
        Reply::Cancelled => Vec::new(),
    }
}

/// Parses the daemon's reply read until it closed the connection.
///
/// # Errors
///
/// Returns [`ProtocolError::InvalidUtf8`] when the reply is not UTF-8.
pub fn decode_reply(bytes: &[u8]) -> Result<Reply, ProtocolError> {
    if bytes.is_empty() {
        return Ok(Reply::Cancelled);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| ProtocolError::InvalidUtf8)?;
    Ok(Reply::Selected(
        text.strip_suffix(NEWLINE).unwrap_or(text).to_owned(),
    ))
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
