//! Tests for workspace target resolution.

use super::{Direction, resolve, step};

/// labwc's desktops in announcement order, from `config/labwc/rc.xml`.
fn names() -> Vec<String> {
    [
        "left top",
        "top",
        "right top",
        "left",
        "middle",
        "right",
        "left bottom",
        "bottom",
        "right bottom",
    ]
    .map(str::to_owned)
    .to_vec()
}

#[test]
fn resolves_grid_indices_and_names() {
    assert_eq!(resolve("0", &names()), Some(0));
    assert_eq!(resolve("8", &names()), Some(8));
    assert_eq!(resolve("middle", &names()), Some(4));
    assert_eq!(resolve("9", &names()), None);
    assert_eq!(resolve("nowhere", &names()), None);
}

#[test]
fn steps_through_the_grid_in_reading_order_and_wraps() {
    assert_eq!(step(Some(4), 9, Direction::Next), Some(5));
    assert_eq!(step(Some(8), 9, Direction::Next), Some(0));
    assert_eq!(step(Some(0), 9, Direction::Previous), Some(8));
    assert_eq!(step(None, 9, Direction::Next), Some(1));
    assert_eq!(step(Some(0), 0, Direction::Next), None);
}
