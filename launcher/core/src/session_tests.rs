//! Tests for [`super::Session`].

use super::{Key, Outcome, Row, Session};
use crate::rank::Order;

/// Application names in catalog order, deliberately unsorted.
const APPS: [&str; 6] = [
    "Font Viewer",
    "Firefox",
    "Barcode Scanner",
    "Code",
    "Files",
    "VS Code",
];

/// Builds an alphabetical session over [`APPS`] showing `rows` rows.
fn apps(rows: usize) -> Session {
    Session::new(
        APPS.iter().map(|name| (*name).to_owned()).collect(),
        Order::Alphabetical,
        rows,
    )
}

/// Types each character of `text` as its own key.
fn type_text(session: &mut Session, text: &str) {
    for character in text.chars() {
        session.handle(Key::Text(character.to_string()));
    }
}

/// Visible rows as `(text, selected)` pairs.
fn shown(session: &Session) -> Vec<(String, bool)> {
    session
        .rows()
        .into_iter()
        .map(|Row { text, selected }| (text.to_owned(), selected))
        .collect()
}

#[test]
fn typing_filters_and_selects_the_best_match() {
    let mut session = apps(10);
    session.handle(Key::Down);
    type_text(&mut session, "code");
    assert_eq!(session.query(), "code");
    assert_eq!(
        shown(&session),
        [
            ("Code".to_owned(), true),
            ("VS Code".to_owned(), false),
            ("Barcode Scanner".to_owned(), false)
        ],
    );
}

#[test]
fn arrows_move_the_selection_and_stop_at_the_ends() {
    let mut session = apps(10);
    type_text(&mut session, "fi");
    assert_eq!(session.handle(Key::Up), Outcome::Ignored);
    assert_eq!(session.handle(Key::Down), Outcome::Redraw);
    assert_eq!(session.handle(Key::Down), Outcome::Ignored);
    assert_eq!(
        shown(&session),
        [("Files".to_owned(), false), ("Firefox".to_owned(), true)]
    );
}

#[test]
fn the_visible_window_follows_the_selection() {
    let mut session = apps(2);
    for _ in 0..3 {
        session.handle(Key::Down);
    }
    assert_eq!(
        shown(&session),
        [("Files".to_owned(), false), ("Firefox".to_owned(), true)]
    );
    for _ in 0..3 {
        session.handle(Key::Up);
    }
    assert_eq!(
        shown(&session),
        [
            ("Barcode Scanner".to_owned(), true),
            ("Code".to_owned(), false)
        ]
    );
}

#[test]
fn enter_activates_the_selected_choice_by_its_original_index() {
    let mut session = apps(10);
    type_text(&mut session, "fire");
    assert_eq!(session.handle(Key::Enter), Outcome::Activate(1));
    type_text(&mut session, "zzz");
    assert_eq!(session.handle(Key::Enter), Outcome::Ignored);
}

#[test]
fn backspace_removes_one_character_and_escape_dismisses() {
    let mut session = apps(10);
    type_text(&mut session, "fé");
    assert_eq!(session.handle(Key::Backspace), Outcome::Redraw);
    assert_eq!(session.query(), "f");
    session.handle(Key::Backspace);
    assert_eq!(session.handle(Key::Backspace), Outcome::Ignored);
    assert_eq!(session.handle(Key::Escape), Outcome::Dismiss);
}

#[test]
fn ignores_text_containing_control_characters() {
    let mut session = apps(10);
    assert_eq!(
        session.handle(Key::Text("\u{3}".to_owned())),
        Outcome::Ignored
    );
    assert_eq!(session.query(), "");
}

#[test]
fn clicking_a_visible_row_activates_it() {
    let mut session = apps(2);
    session.scroll(1);
    assert_eq!(session.click(1), Outcome::Activate(4));
    assert_eq!(session.click(2), Outcome::Ignored);
}

#[test]
fn scrolling_moves_the_window_within_bounds_and_keeps_the_selection_visible() {
    let mut session = apps(2);
    assert_eq!(session.scroll(-1), Outcome::Ignored);
    assert_eq!(session.scroll(10), Outcome::Redraw);
    assert_eq!(
        shown(&session),
        [
            ("Font Viewer".to_owned(), true),
            ("VS Code".to_owned(), false)
        ]
    );
}

#[test]
fn given_order_keeps_dmenu_lines_as_supplied() {
    let lines = ["newest clip", "older clip", "oldest clip"]
        .map(str::to_owned)
        .to_vec();
    let session = Session::new(lines, Order::Given, 10);
    assert_eq!(
        shown(&session),
        [
            ("newest clip".to_owned(), true),
            ("older clip".to_owned(), false),
            ("oldest clip".to_owned(), false)
        ],
    );
}
