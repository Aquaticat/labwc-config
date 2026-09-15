//! Tests for evdev record decoding.

use std::time::Duration;

use launcher_core::tap::KeyEvent;

use super::{EVENT_SIZE, is_event_device, key_events};

/// Encodes one `struct input_event` the way the kernel writes it on 64-bit Linux.
fn record(seconds: i64, microseconds: i64, event_type: u16, code: u16, value: i32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(EVENT_SIZE);
    bytes.extend_from_slice(&seconds.to_ne_bytes());
    bytes.extend_from_slice(&microseconds.to_ne_bytes());
    bytes.extend_from_slice(&event_type.to_ne_bytes());
    bytes.extend_from_slice(&code.to_ne_bytes());
    bytes.extend_from_slice(&value.to_ne_bytes());
    bytes
}

#[test]
fn decodes_key_records_and_skips_sync_and_partial_records() {
    let mut bytes = record(12, 345_678, 1, 125, 1);
    bytes.extend(record(12, 345_678, 0, 0, 0));
    bytes.extend(record(12, 400_000, 1, 125, 0));
    bytes.extend_from_slice(&[0; 7]);
    let events: Vec<KeyEvent> = key_events(&bytes).collect();
    assert_eq!(
        events,
        [
            KeyEvent {
                code: 125,
                value: 1,
                time: Duration::new(12, 345_678_000)
            },
            KeyEvent {
                code: 125,
                value: 0,
                time: Duration::new(12, 400_000_000)
            },
        ],
    );
}

#[test]
fn recognizes_only_numbered_event_nodes() {
    assert!(is_event_device("event12"));
    assert!(!is_event_device("event"));
    assert!(!is_event_device("mouse0"));
    assert!(!is_event_device("by-id"));
}
