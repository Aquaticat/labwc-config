//! Tests for [`super::TapRecognizer`].

use std::time::Duration;

use super::{Action, KeyEvent, TapRecognizer};

/// Linux input event code for the left Meta key.
const LEFT_META: u16 = 125;
/// Linux input event code for the right Meta key.
const RIGHT_META: u16 = 126;
/// Linux input event code for E.
const KEY_E: u16 = 18;
/// Linux input event code for F12.
const KEY_F12: u16 = 88;
/// Linux input event code for the left mouse button.
const BUTTON_LEFT: u16 = 0x110;

/// Builds a key event at `milliseconds` after an arbitrary origin.
fn key(code: u16, value: i32, milliseconds: u64) -> KeyEvent {
    KeyEvent { code, value, time: Duration::from_millis(milliseconds) }
}

/// Feeds events in order and collects the actions they produced.
fn actions(recognizer: &mut TapRecognizer, events: &[KeyEvent]) -> Vec<Action> {
    events.iter().filter_map(|event| recognizer.feed(*event)).collect()
}

#[test]
fn recognizes_a_bare_left_meta_tap_within_400_ms() {
    let mut recognizer = TapRecognizer::new(false);
    assert_eq!(actions(&mut recognizer, &[key(LEFT_META, 1, 1000), key(LEFT_META, 0, 1400)]), [Action::Tap]);
}

#[test]
fn ignores_a_meta_press_held_longer_than_400_ms() {
    let mut recognizer = TapRecognizer::new(false);
    assert_eq!(
        actions(&mut recognizer, &[key(LEFT_META, 1, 1000), key(LEFT_META, 2, 1300), key(LEFT_META, 0, 1401)]),
        [],
    );
}

#[test]
fn ignores_meta_used_in_a_key_or_button_chord() {
    let mut recognizer = TapRecognizer::new(false);
    let chord = [key(LEFT_META, 1, 0), key(KEY_E, 1, 50), key(KEY_E, 0, 80), key(LEFT_META, 0, 100)];
    assert_eq!(actions(&mut recognizer, &chord), []);
    let click = [key(LEFT_META, 1, 200), key(BUTTON_LEFT, 1, 250), key(BUTTON_LEFT, 0, 260), key(LEFT_META, 0, 300)];
    assert_eq!(actions(&mut recognizer, &click), []);
}

#[test]
fn does_not_treat_right_meta_as_the_launcher_key() {
    let mut recognizer = TapRecognizer::new(false);
    assert_eq!(actions(&mut recognizer, &[key(RIGHT_META, 1, 0), key(RIGHT_META, 0, 100)]), []);
}

#[test]
fn meta_f12_toggles_the_guard_and_suppresses_taps_while_suspended() {
    let mut recognizer = TapRecognizer::new(false);
    let guard_chord = |start: u64| {
        [key(LEFT_META, 1, start), key(KEY_F12, 1, start + 50), key(KEY_F12, 0, start + 60), key(LEFT_META, 0, start + 100)]
    };
    let tap = |start: u64| [key(LEFT_META, 1, start), key(LEFT_META, 0, start + 100)];
    assert_eq!(actions(&mut recognizer, &guard_chord(0)), [Action::GuardChanged { suspended: true }]);
    assert_eq!(actions(&mut recognizer, &tap(1000)), []);
    assert_eq!(actions(&mut recognizer, &guard_chord(2000)), [Action::GuardChanged { suspended: false }]);
    assert_eq!(actions(&mut recognizer, &tap(3000)), [Action::Tap]);
}

#[test]
fn starts_suspended_when_the_persisted_guard_says_so() {
    let mut recognizer = TapRecognizer::new(true);
    assert_eq!(actions(&mut recognizer, &[key(LEFT_META, 1, 0), key(LEFT_META, 0, 100)]), []);
}
