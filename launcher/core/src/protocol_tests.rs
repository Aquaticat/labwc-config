//! Tests for the client and daemon wire format.

use super::{ProtocolError, Reply, Request, decode_reply, decode_request, encode_reply, encode_request};

#[test]
fn round_trips_a_toggle_request() {
    let bytes = encode_request(&Request::Toggle);
    assert_eq!(bytes, b"toggle\n");
    assert_eq!(decode_request(&bytes), Ok(Request::Toggle));
}

#[test]
fn round_trips_a_dmenu_request_with_prompt_and_lines() {
    let request = Request::Dmenu { prompt: "panel".into(), lines: vec!["Audio".into(), "Lock screen".into()] };
    let bytes = encode_request(&request);
    assert_eq!(bytes, b"dmenu\npanel\nAudio\nLock screen\n");
    assert_eq!(decode_request(&bytes), Ok(request));
}

#[test]
fn keeps_empty_dmenu_lines_but_not_the_final_terminator() {
    assert_eq!(
        decode_request(b"dmenu\n\na\n\nb\n"),
        Ok(Request::Dmenu { prompt: String::new(), lines: vec!["a".into(), String::new(), "b".into()] }),
    );
}

#[test]
fn rejects_unknown_commands_and_invalid_utf8() {
    assert_eq!(decode_request(b"launch firefox\n"), Err(ProtocolError::UnknownCommand("launch firefox".into())));
    assert_eq!(decode_request(b"dmenu\n\xff\n"), Err(ProtocolError::InvalidUtf8));
    assert_eq!(decode_request(b""), Err(ProtocolError::UnknownCommand(String::new())));
}

#[test]
fn round_trips_selection_and_cancel_replies() {
    assert_eq!(encode_reply(&Reply::Selected("Lock screen".into())), b"Lock screen\n");
    assert_eq!(decode_reply(b"Lock screen\n"), Ok(Reply::Selected("Lock screen".into())));
    assert_eq!(encode_reply(&Reply::Cancelled), b"");
    assert_eq!(decode_reply(b""), Ok(Reply::Cancelled));
}
