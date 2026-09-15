//! Platform-free logic for the resident launcher.
//!
//! Everything here is pure so it can be tested without Wayland, evdev, or a running session.

pub mod rank;
pub mod desktop_entry;
pub mod protocol;
