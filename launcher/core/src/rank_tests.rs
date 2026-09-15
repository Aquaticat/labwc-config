//! Tests for [`super::search`].

use super::{Order, search};

/// Names used across tests, deliberately unsorted.
const NAMES: [&str; 6] = [
    "Font Viewer",
    "Firefox",
    "Barcode Scanner",
    "Code",
    "Files",
    "VS Code",
];

/// Resolves search output back to names so assertions read as display order.
fn displayed(query: &str) -> Vec<&'static str> {
    search(query, &NAMES, Order::Alphabetical)
        .into_iter()
        .map(|index| NAMES[index])
        .collect()
}

#[test]
fn orders_prefix_then_word_start_then_other_containing_names() {
    assert_eq!(displayed("code"), ["Code", "VS Code", "Barcode Scanner"]);
}

#[test]
fn lists_every_name_alphabetically_for_an_empty_query() {
    assert_eq!(
        displayed(""),
        [
            "Barcode Scanner",
            "Code",
            "Files",
            "Firefox",
            "Font Viewer",
            "VS Code"
        ]
    );
}

#[test]
fn matches_case_insensitively_and_drops_names_without_the_text() {
    assert_eq!(displayed("FI"), ["Files", "Firefox"]);
}

#[test]
fn given_order_keeps_input_order_within_each_tier() {
    let lines = ["VS Code", "Barcode Scanner", "Code", "Codec Info"];
    let order = |query: &str| -> Vec<&str> {
        search(query, &lines, Order::Given)
            .into_iter()
            .map(|index| lines[index])
            .collect()
    };
    assert_eq!(
        order("code"),
        ["Code", "Codec Info", "VS Code", "Barcode Scanner"]
    );
    assert_eq!(order(""), lines);
}
