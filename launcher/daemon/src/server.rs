//! Serves the launcher socket: one request per connection, read without blocking the event loop.

use std::{
    io::{self, Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::Path,
};

use calloop::{
    Interest, LoopHandle, Mode, PostAction,
    generic::{Generic, NoIoDrop},
};
use launcher_core::protocol::{Reply, encode_reply};

use crate::{DaemonError, daemon::Daemon, log};

/// Largest request accepted, which bounds memory for runaway dmenu input.
const MAX_REQUEST_BYTES: usize = 64 * 1024 * 1024;

/// Binds the socket at `path`, replacing a stale socket but refusing to replace a live daemon.
///
/// # Errors
///
/// Returns [`DaemonError::AlreadyRunning`] when another daemon answers on `path`, or the bind error.
pub fn bind(path: &Path) -> Result<UnixListener, DaemonError> {
    if UnixStream::connect(path).is_ok() {
        return Err(DaemonError::AlreadyRunning(path.to_owned()));
    }
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => {
            return Err(DaemonError::Io {
                context: "removing the stale launcher socket",
                source: error,
            });
        }
        _ => {}
    }
    let listener = UnixListener::bind(path).map_err(|source| DaemonError::Io {
        context: "binding the launcher socket",
        source,
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|source| DaemonError::Io {
            context: "configuring the launcher socket",
            source,
        })?;
    Ok(listener)
}

/// Registers the listener with the event loop.
///
/// # Errors
///
/// Returns the event loop's registration error.
pub fn serve(
    handle: &LoopHandle<'static, Daemon>,
    listener: UnixListener,
) -> Result<(), DaemonError> {
    let accept_handle = handle.clone();
    handle
        .insert_source(
            Generic::new(listener, Interest::READ, Mode::Level),
            move |_, listener, _| {
                accept_all(&accept_handle, listener);
                Ok(PostAction::Continue)
            },
        )
        .map_err(|error| DaemonError::EventLoop(error.to_string()))?;
    Ok(())
}

/// Accepts every pending connection and starts reading its request.
fn accept_all(handle: &LoopHandle<'static, Daemon>, listener: &NoIoDrop<UnixListener>) {
    loop {
        match listener.accept() {
            Ok((stream, _)) => read_request(handle, stream),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return,
            Err(error) => {
                log(&format!("accepting a client failed: {error}"));
                return;
            }
        }
    }
}

/// Reads a request until the client closes its write side, then hands it to the daemon.
fn read_request(handle: &LoopHandle<'static, Daemon>, stream: UnixStream) {
    if let Err(error) = stream.set_nonblocking(true) {
        log(&format!("configuring a client connection failed: {error}"));
        return;
    }
    let mut request = Vec::new();
    let inserted = handle.insert_source(
        Generic::new(stream, Interest::READ, Mode::Level),
        move |_, stream, daemon| {
            let mut chunk = [0_u8; 64 * 1024];
            loop {
                match (&**stream).read(&mut chunk) {
                    Ok(0) => {
                        match stream.try_clone() {
                            Ok(reply) => daemon.handle_request(&request, reply),
                            Err(error) => {
                                log(&format!("keeping a client connection failed: {error}"))
                            }
                        }
                        return Ok(PostAction::Remove);
                    }
                    Ok(length) if request.len() + length > MAX_REQUEST_BYTES => {
                        log("dropping a client request larger than 64 MiB");
                        return Ok(PostAction::Remove);
                    }
                    Ok(length) => request.extend_from_slice(&chunk[..length]),
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        return Ok(PostAction::Continue);
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    Err(error) => {
                        log(&format!("reading a client request failed: {error}"));
                        return Ok(PostAction::Remove);
                    }
                }
            }
        },
    );
    if let Err(error) = inserted {
        log(&format!("watching a client connection failed: {error}"));
    }
}

/// Sends a dmenu reply and closes the connection; a client that already exited is not an error worth reporting.
pub fn send_reply(mut stream: UnixStream, reply: &Reply) {
    let sent = stream
        .set_nonblocking(false)
        .and_then(|()| stream.write_all(&encode_reply(reply)));
    if let Err(error) = sent
        && error.kind() != io::ErrorKind::BrokenPipe
    {
        log(&format!("replying to a dmenu client failed: {error}"));
    }
}
