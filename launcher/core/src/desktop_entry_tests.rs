//! Tests for [`super::parse_entry`].

use super::{DesktopEntry, parse_entry};

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
