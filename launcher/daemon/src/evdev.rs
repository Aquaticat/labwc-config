//! Opens evdev keyboards and pointers and decodes their key events.
//!
//! Reading is passive: devices are never grabbed, so the compositor and other tools see every event.
//! Pointer buttons are read too, because a Meta click must not count as a bare Meta tap.

use std::{
    fs::{File, OpenOptions},
    io,
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::Path,
    time::Duration,
};

use launcher_core::tap::KeyEvent;

/// Directory holding evdev device nodes.
pub const INPUT_DIR: &str = "/dev/input";
/// Size of one `struct input_event` on 64-bit Linux.
pub const EVENT_SIZE: usize = 24;
/// evdev event type for keys and buttons.
const EV_KEY: u16 = 1;
/// Linux input event code for the left Meta key.
const KEY_LEFTMETA: usize = 125;
/// Linux input event code for the left mouse button.
const BTN_LEFT: usize = 0x110;
/// Highest key code, which sizes the key capability bitmap.
const KEY_MAX: usize = 0x2ff;

/// Builds an ioctl request number like the kernel's `_IOC` macro.
const fn ioc(direction: u64, number: u64, size: usize) -> u64 {
    (direction << 30) | ((size as u64) << 16) | (0x45 << 8) | number
}

/// Whether a device node name is an evdev event device.
pub fn is_event_device(name: &str) -> bool {
    name.strip_prefix("event")
        .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|byte| byte.is_ascii_digit()))
}

/// Opens `path` when it reports left Meta or a left button, switching its timestamps to the monotonic clock.
///
/// Returns `Ok(None)` for devices that have neither, such as power buttons and lid switches.
///
/// # Errors
///
/// Returns the error from opening the node or from either ioctl, for example `EACCES` outside the `input` group.
pub fn open_device(path: &Path) -> io::Result<Option<File>> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)?;
    let mut key_bits = [0_u8; KEY_MAX / 8 + 1];
    let get_key_bits = ioc(2, 0x20 + u64::from(EV_KEY), key_bits.len());
    // SAFETY: EVIOCGBIT writes at most the buffer length encoded in the request into `key_bits`, which is that long.
    if unsafe {
        libc::ioctl(
            file.as_raw_fd(),
            get_key_bits as libc::Ioctl,
            key_bits.as_mut_ptr(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    let has = |code: usize| key_bits[code / 8] & (1 << (code % 8)) != 0;
    if !has(KEY_LEFTMETA) && !has(BTN_LEFT) {
        return Ok(None);
    }
    let clock: libc::c_int = libc::CLOCK_MONOTONIC;
    let set_clock = ioc(1, 0xa0, size_of::<libc::c_int>());
    // SAFETY: EVIOCSCLOCKID reads one int through the pointer, which points at a live local of that type.
    if unsafe { libc::ioctl(file.as_raw_fd(), set_clock as libc::Ioctl, &raw const clock) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(Some(file))
}

/// Decodes the key and button events in whole `struct input_event` records.
pub fn key_events(bytes: &[u8]) -> impl Iterator<Item = KeyEvent> + '_ {
    bytes
        .as_chunks::<EVENT_SIZE>()
        .0
        .iter()
        .filter_map(|record| {
            let field = |start: usize, end: usize| &record[start..end];
            let event_type = u16::from_ne_bytes(field(16, 18).try_into().ok()?);
            if event_type != EV_KEY {
                return None;
            }
            let seconds = i64::from_ne_bytes(field(0, 8).try_into().ok()?);
            let microseconds = i64::from_ne_bytes(field(8, 16).try_into().ok()?);
            let time = Duration::from_secs(u64::try_from(seconds).ok()?)
                + Duration::from_micros(u64::try_from(microseconds).ok()?);
            Some(KeyEvent {
                code: u16::from_ne_bytes(field(18, 20).try_into().ok()?),
                value: i32::from_ne_bytes(field(20, 24).try_into().ok()?),
                time,
            })
        })
}

#[cfg(test)]
#[path = "evdev_tests.rs"]
mod tests;
