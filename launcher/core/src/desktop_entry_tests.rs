//! Tests for desktop entry parsing, localization, and masking.

use super::{
    DesktopEntry, desktop_file_id, find_by_app_id, message_locale, name_keys, parse_entry,
    visible_entries,
};

/// Desktops a labwc session advertises in `XDG_CURRENT_DESKTOP`.
const LABWC: [&str; 2] = ["labwc", "wlroots"];

/// Parses `text` as `test.desktop` in an unlocalized labwc session.
fn parse(text: &str) -> Option<DesktopEntry> {
    parse_entry("test.desktop", text, &LABWC, &name_keys(None))
}

/// Builds the entry the launcher shows for `id` named `name`.
fn entry(id: &str, name: &str) -> DesktopEntry {
    DesktopEntry {
        id: id.into(),
        name: name.into(),
        startup_wm_class: None,
    }
}

#[test]
fn reads_the_name_and_keeps_the_id_for_launching() {
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox %u\n"),
        Some(entry("test.desktop", "Firefox"))
    );
}

#[test]
fn ignores_keys_outside_the_desktop_entry_group() {
    let text = "[Desktop Action new-private-window]\nName=New Private Window\nExec=firefox --private-window\n\n[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox\n";
    assert_eq!(parse(text), Some(entry("test.desktop", "Firefox")));
}

#[test]
fn unescapes_string_values() {
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=Two\\sWords\\\\\nExec=two\n"),
        Some(entry("test.desktop", "Two Words\\"))
    );
}

#[test]
fn hides_entries_marked_no_display_or_hidden() {
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=A\nExec=a\nNoDisplay=true\n"),
        None
    );
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=B\nExec=b\nHidden=true\n"),
        None
    );
}

#[test]
fn hides_entries_restricted_to_other_desktops() {
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=K\nExec=k\nOnlyShowIn=KDE;\n"),
        None
    );
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=N\nExec=n\nNotShowIn=GNOME;labwc;\n"),
        None
    );
    assert!(
        parse("[Desktop Entry]\nType=Application\nName=W\nExec=w\nOnlyShowIn=wlroots;\n").is_some()
    );
}

#[test]
fn skips_links_and_entries_without_a_name_or_command() {
    assert_eq!(
        parse("[Desktop Entry]\nType=Link\nName=Site\nURL=https://example.org\n"),
        None
    );
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=NoExec\n"),
        None
    );
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=\nExec=blank\n"),
        None
    );
}

#[test]
fn picks_the_message_locale_from_lc_all_then_lc_messages_then_lang() {
    assert_eq!(
        message_locale(Some(""), Some("de_DE.UTF-8"), Some("en_US.UTF-8")),
        Some("de_DE.UTF-8")
    );
    assert_eq!(
        message_locale(Some("fr_FR"), Some("de_DE"), None),
        Some("fr_FR")
    );
    assert_eq!(message_locale(None, None, Some("C.UTF-8")), None);
    assert_eq!(message_locale(None, None, Some("POSIX")), None);
}

#[test]
fn orders_localized_name_keys_by_specificity() {
    assert_eq!(
        name_keys(Some("sr_RS.UTF-8@latin")),
        [
            "Name[sr_RS@latin]",
            "Name[sr_RS]",
            "Name[sr@latin]",
            "Name[sr]",
            "Name"
        ]
    );
    assert_eq!(name_keys(Some("de")), ["Name[de]", "Name"]);
    assert_eq!(name_keys(None), ["Name"]);
}

#[test]
fn shows_the_most_specific_localized_name() {
    let text = "[Desktop Entry]\nType=Application\nName=Files\nName[de]=Dateien\nName[de_AT]=Dateien (AT)\nExec=nautilus\n";
    let localized = |locale| parse_entry("files.desktop", text, &LABWC, &name_keys(Some(locale)));
    assert_eq!(
        localized("de_AT.UTF-8"),
        Some(entry("files.desktop", "Dateien (AT)"))
    );
    assert_eq!(
        localized("de_CH.UTF-8"),
        Some(entry("files.desktop", "Dateien"))
    );
    assert_eq!(
        localized("fr_FR.UTF-8"),
        Some(entry("files.desktop", "Files"))
    );
}

#[test]
fn derives_desktop_file_ids_from_paths_below_the_applications_directory() {
    assert_eq!(
        desktop_file_id("org.gnome.Nautilus.desktop"),
        Some("org.gnome.Nautilus.desktop".to_owned())
    );
    assert_eq!(
        desktop_file_id("kde4/konsole.desktop"),
        Some("kde4-konsole.desktop".to_owned())
    );
    assert_eq!(desktop_file_id("mimeinfo.cache"), None);
}

#[test]
fn earlier_files_mask_later_files_with_the_same_id_even_when_hidden() {
    let hidden = "[Desktop Entry]\nType=Application\nName=Foot\nExec=foot\nNoDisplay=true\n";
    let foot = "[Desktop Entry]\nType=Application\nName=Foot\nExec=foot\n";
    let files = "[Desktop Entry]\nType=Application\nName=Files\nExec=nautilus\n";
    let entries = visible_entries(
        [
            ("foot.desktop", hidden),
            ("foot.desktop", foot),
            ("org.gnome.Nautilus.desktop", files),
        ],
        &LABWC,
        &name_keys(None),
    );
    assert_eq!(entries, [entry("org.gnome.Nautilus.desktop", "Files")]);
}

#[test]
fn reads_startup_wm_class() {
    let parsed = parse(
        "[Desktop Entry]
Type=Application
Name=Code
Exec=code
StartupWMClass=Code
",
    )
    .expect("visible entry");
    assert_eq!(parsed.startup_wm_class.as_deref(), Some("Code"));
}

#[test]
fn finds_the_entry_behind_a_window_app_id() {
    let mut code = entry("code-oss.desktop", "Code - OSS");
    code.startup_wm_class = Some("code-oss".into());
    let entries = [
        entry("org.gnome.Nautilus.desktop", "Files"),
        entry("Alacritty.desktop", "Alacritty"),
        code,
    ];
    let found = |app_id| find_by_app_id(&entries, app_id).map(|found| found.id.as_str());
    assert_eq!(
        found("org.gnome.Nautilus"),
        Some("org.gnome.Nautilus.desktop")
    );
    assert_eq!(found("alacritty"), Some("Alacritty.desktop"));
    assert_eq!(found("Code-OSS"), Some("code-oss.desktop"));
    assert_eq!(found("unknown"), None);
}
