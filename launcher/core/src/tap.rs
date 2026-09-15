//! Recognizes a bare Meta tap and the Meta+F12 shortcut guard from evdev key events.
//!
//! Semantics match the retired `meta-tap-launcher`:
//! left Meta pressed and released within 400 ms with no other key or button pressed in between is a tap;
//! F12 pressed while left Meta is held toggles the guard;
//! taps do nothing while the guard is suspended.

use std::time::Duration;

/// One `EV_KEY` event as read from evdev.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct KeyEvent {
    /// Linux input event code.
    pub code: u16,
    /// 1 for press, 0 for release, 2 for autorepeat.
    pub value: i32,
    /// Kernel event timestamp.
    pub time: Duration,
}

/// Something the daemon should do in response to key events.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Action {
    /// Toggle the launcher.
    Tap,
    /// The shortcut guard changed; taps are ignored while `suspended`.
    GuardChanged {
        /// Whether global shortcuts are now suspended.
        suspended: bool,
    },
}

/// Linux input event code for the left Meta key.
const LEFT_META: u16 = 125;
/// Linux input event code for F12.
const KEY_F12: u16 = 88;
/// Longest press that still counts as a tap.
const TAP_WINDOW: Duration = Duration::from_millis(400);
/// evdev value for a key press.
const PRESS: i32 = 1;
/// evdev value for a key release.
const RELEASE: i32 = 0;

/// Tracks Meta key state across events.
#[derive(Debug)]
pub struct TapRecognizer {
    /// When left Meta went down, if it is held.
    meta_down_at: Option<Duration>,
    /// Whether no other key or button has been pressed since Meta went down.
    armed: bool,
    /// Whether the shortcut guard currently suppresses taps.
    suspended: bool,
}

impl TapRecognizer {
    /// Creates a recognizer; `suspended` restores a guard state persisted across daemon restarts.
    pub fn new(suspended: bool) -> Self {
        Self { meta_down_at: None, armed: false, suspended }
    }

    /// Consumes one key event and returns the action it completes, if any.
    pub fn feed(&mut self, event: KeyEvent) -> Option<Action> {
        if event.code == LEFT_META {
            return self.feed_meta(event);
        }
        if event.value != PRESS {
            return None;
        }
        self.armed = false;
        if event.code == KEY_F12 && self.meta_down_at.is_some() {
            self.suspended = !self.suspended;
            return Some(Action::GuardChanged { suspended: self.suspended });
        }
        None
    }

    /// Handles a left Meta press or release; autorepeat is ignored.
    fn feed_meta(&mut self, event: KeyEvent) -> Option<Action> {
        match event.value {
            PRESS => {
                self.meta_down_at = Some(event.time);
                self.armed = true;
                None
            }
            RELEASE => {
                let pressed_at = self.meta_down_at.take();
                let within_window =
                    pressed_at.is_some_and(|pressed| event.time.saturating_sub(pressed) <= TAP_WINDOW);
                let tapped = self.armed && within_window && !self.suspended;
                self.armed = false;
                tapped.then_some(Action::Tap)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
#[path = "tap_tests.rs"]
mod tests;
