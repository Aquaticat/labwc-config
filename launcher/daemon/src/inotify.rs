//! Minimal inotify wrapper for device hotplug and application directory changes.

use std::{
    ffi::{CString, OsString},
    fs::File,
    io::{self, Read},
    os::{
        fd::{FromRawFd, OwnedFd},
        unix::ffi::{OsStrExt, OsStringExt},
    },
    path::Path,
};

/// Size of `struct inotify_event` without its trailing name.
const HEADER_SIZE: usize = 16;

/// One change notification.
#[derive(Debug)]
pub struct Change {
    /// Watch descriptor the change belongs to.
    pub watch: i32,
    /// File name inside the watched directory, when the change concerns a directory entry.
    pub name: Option<OsString>,
}

/// Creates a non-blocking inotify instance.
///
/// # Errors
///
/// Returns the error from `inotify_init1`.
pub fn create() -> io::Result<File> {
    // SAFETY: inotify_init1 takes only flags and returns a new descriptor or -1.
    let fd = unsafe { libc::inotify_init1(libc::IN_NONBLOCK | libc::IN_CLOEXEC) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `fd` was just returned by inotify_init1 and is owned by nothing else.
    Ok(File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
}

/// Watches `path` for `mask` events and returns the watch descriptor.
///
/// # Errors
///
/// Returns the error from `inotify_add_watch`, for example `ENOENT` for a missing directory.
pub fn watch(inotify: &File, path: &Path, mask: u32) -> io::Result<i32> {
    use std::os::fd::AsRawFd;
    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    // SAFETY: the descriptor is a live inotify instance and `path` is a NUL-terminated string that outlives the call.
    let watch = unsafe { libc::inotify_add_watch(inotify.as_raw_fd(), path.as_ptr(), mask) };
    if watch < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(watch)
}

/// Reads every pending change without blocking.
///
/// # Errors
///
/// Returns read errors other than `WouldBlock`, which ends the batch.
pub fn read_changes(mut inotify: &File) -> io::Result<Vec<Change>> {
    let mut changes = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let length = match inotify.read(&mut buffer) {
            Ok(length) => length,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(changes),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        changes.extend(parse_changes(&buffer[..length]));
    }
}

/// Decodes a buffer of whole `struct inotify_event` records.
pub fn parse_changes(mut bytes: &[u8]) -> Vec<Change> {
    let mut changes = Vec::new();
    while bytes.len() >= HEADER_SIZE {
        let int = |start: usize| {
            u32::from_ne_bytes([
                bytes[start],
                bytes[start + 1],
                bytes[start + 2],
                bytes[start + 3],
            ])
        };
        let watch = i32::from_ne_bytes(int(0).to_ne_bytes());
        let name_length = int(12) as usize;
        let Some(name_bytes) = bytes.get(HEADER_SIZE..HEADER_SIZE + name_length) else {
            break;
        };
        let name_end = name_bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(name_length);
        let name = (name_end > 0).then(|| OsString::from_vec(name_bytes[..name_end].to_vec()));
        changes.push(Change { watch, name });
        bytes = &bytes[HEADER_SIZE + name_length..];
    }
    changes
}
