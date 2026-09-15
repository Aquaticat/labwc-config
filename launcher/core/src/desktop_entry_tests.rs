//! Tests for [`super::parse_entry`] and [`super::visible_entries`].

use super::{DesktopEntry, desktop_file_id, parse_entry, visible_entries};

/// Desktops a labwc session advertises in `XDG_CURRENT_DESKTOP`.
const LABWC: [&str; 2] = ["labwc", "wlroots"];

/// Parses `text` as if found in a labwc session.
fn parse(text: &str) -> Option<DesktopEntry> {
    parse_entry(text, &LABWC)
}

#[test]
fn reads_name_and_drops_exec_field_codes() {
    let entry = parse("[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox %u\n")
        .expect("visible entry");
    assert_eq!(
        entry,
        DesktopEntry {
            name: "Firefox".into(),
            argv: vec!["firefox".into()]
        }
    );
}

#[test]
fn ignores_keys_outside_the_desktop_entry_group() {
    let text = "[Desktop Entry]\nType=Application\nName=Firefox\nExec=firefox\n\n[Desktop Action new-private-window]\nName=New Private Window\nExec=firefox --private-window\n";
    let entry = parse(text).expect("visible entry");
    assert_eq!(entry.name, "Firefox");
    assert_eq!(entry.argv, ["firefox"]);
}

#[test]
fn splits_quoted_exec_arguments_and_unescapes_them() {
    let entry = parse(
        "[Desktop Entry]\nType=Application\nName=My App\nExec=\"/opt/My App/app\" --title \"say \\\\\"hi\\\\\"\" 100%% %F\n",
    )
    .expect("visible entry");
    assert_eq!(
        entry.argv,
        ["/opt/My App/app", "--title", "say \"hi\"", "100%"]
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
fn skips_links_directories_and_entries_without_exec() {
    assert_eq!(
        parse("[Desktop Entry]\nType=Link\nName=Site\nURL=https://example.org\n"),
        None
    );
    assert_eq!(
        parse("[Desktop Entry]\nType=Application\nName=NoExec\n"),
        None
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
    let hidden = "[Desktop Entry]
Type=Application
Name=Foot
Exec=foot
NoDisplay=true
";
    let foot = "[Desktop Entry]
Type=Application
Name=Foot
Exec=foot
";
    let files = "[Desktop Entry]
Type=Application
Name=Files
Exec=nautilus
";
    let entries = visible_entries(
        [
            ("foot.desktop", hidden),
            ("foot.desktop", foot),
            ("org.gnome.Nautilus.desktop", files),
        ],
        &LABWC,
    );
    assert_eq!(
        entries,
        [DesktopEntry {
            name: "Files".into(),
            argv: vec!["nautilus".into()]
        }]
    );
}
