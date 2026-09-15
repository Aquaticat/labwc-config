//! Tests for command-line parsing.

use launcher_core::protocol::Request;

use super::{Invocation, parse_command_line};

/// Parses `line` split on spaces.
fn parse(line: &str) -> Result<Invocation, String> {
    let arguments: Vec<String> = line.split(' ').map(str::to_owned).collect();
    parse_command_line(&arguments)
}

#[test]
fn parses_toggle_close_and_launch() {
    assert_eq!(parse("toggle"), Ok(Invocation::Send(Request::Toggle)));
    assert_eq!(parse("close"), Ok(Invocation::Send(Request::Close)));
    assert_eq!(
        parse("launch org.gnome.Nautilus"),
        Ok(Invocation::Send(Request::Launch {
            app_id: "org.gnome.Nautilus".into()
        }))
    );
}

#[test]
fn parses_run_with_or_without_a_separator() {
    let expected = Ok(Invocation::Send(Request::Run {
        argv: vec!["dolphin".into(), "--new-window".into()],
    }));
    assert_eq!(parse("run -- dolphin --new-window"), expected);
    assert_eq!(parse("run dolphin --new-window"), expected);
}

#[test]
fn parses_dmenu_prompts_in_every_accepted_spelling() {
    let prompt = |text: &str| {
        Ok(Invocation::Dmenu {
            prompt: text.into(),
        })
    };
    assert_eq!(parse("dmenu"), prompt(""));
    assert_eq!(parse("dmenu --prompt panel"), prompt("panel"));
    assert_eq!(parse("dmenu --prompt=panel"), prompt("panel"));
    assert_eq!(parse("dmenu -p services"), prompt("services"));
}

#[test]
fn rejects_missing_arguments_unknown_commands_and_line_breaks() {
    assert!(parse("launch").is_err());
    assert!(parse("run").is_err());
    assert!(parse("run --").is_err());
    assert!(parse("dmenu --bogus").is_err());
    assert!(parse("open firefox").is_err());
    assert!(parse_command_line(&["run".into(), "two\nlines".into()]).is_err());
}
