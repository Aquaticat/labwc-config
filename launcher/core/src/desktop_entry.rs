//! Reads the parts of a freedesktop desktop entry the launcher shows and runs.
//!
//! Follows the Desktop Entry Specification's value escapes, `Exec` quoting, and field codes.
//! Only the `[Desktop Entry]` group is read; action groups and localized keys are ignored.

use std::collections::HashMap;

/// A visible application: what the list shows and what launching runs.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopEntry {
    /// Unlocalized `Name`, shown and searched.
    pub name: String,
    /// `Exec` split into arguments with field codes removed.
    pub argv: Vec<String>,
}

/// Field codes that expand to file, URL, or metadata arguments the launcher never supplies.
const FIELD_CODES: [char; 13] = ['f', 'F', 'u', 'U', 'd', 'D', 'n', 'N', 'i', 'c', 'k', 'v', 'm'];

/// Collects `key=value` pairs from the `[Desktop Entry]` group, with string escapes resolved.
fn main_group(text: &str) -> HashMap<&str, String> {
    let mut in_main_group = false;
    let mut pairs = HashMap::new();
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_main_group = line == "[Desktop Entry]";
            continue;
        }
        if !in_main_group {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            pairs.insert(key.trim(), unescape_value(value.trim()));
        }
    }
    pairs
}

/// Resolves the string-value escapes `\s`, `\n`, `\t`, `\r`, and `\\`; other backslashes are kept.
fn unescape_value(value: &str) -> String {
    let mut resolved = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(current) = chars.next() {
        if current != '\\' {
            resolved.push(current);
            continue;
        }
        match chars.next() {
            Some('s') => resolved.push(' '),
            Some('n') => resolved.push('\n'),
            Some('t') => resolved.push('\t'),
            Some('r') => resolved.push('\r'),
            Some('\\') => resolved.push('\\'),
            Some(other) => {
                resolved.push('\\');
                resolved.push(other);
            }
            None => resolved.push('\\'),
        }
    }
    resolved
}

/// Splits an `Exec` value into arguments, honoring double quotes and their backslash escapes.
fn split_exec(exec: &str) -> Vec<String> {
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut has_token = false;
    let mut quoted = false;
    let mut chars = exec.chars();
    while let Some(character) = chars.next() {
        if quoted && character == '\\' {
            if let Some(escaped) = chars.next() {
                current.push(escaped);
            }
        } else if character == '"' {
            quoted = !quoted;
            has_token = true;
        } else if !quoted && character.is_whitespace() {
            if has_token {
                arguments.push(std::mem::take(&mut current));
                has_token = false;
            }
        } else {
            current.push(character);
            has_token = true;
        }
    }
    if has_token {
        arguments.push(current);
    }
    arguments
}

/// Removes field codes from one argument and turns `%%` into `%`.
///
/// Returns `None` when the argument consisted only of field codes.
fn strip_field_codes(argument: &str) -> Option<String> {
    let mut stripped = String::with_capacity(argument.len());
    let mut removed_code = false;
    let mut chars = argument.chars();
    while let Some(character) = chars.next() {
        if character != '%' {
            stripped.push(character);
            continue;
        }
        match chars.next() {
            Some('%') => stripped.push('%'),
            Some(code) if FIELD_CODES.contains(&code) => removed_code = true,
            Some(other) => {
                stripped.push('%');
                stripped.push(other);
            }
            None => stripped.push('%'),
        }
    }
    (!(removed_code && stripped.is_empty())).then_some(stripped)
}

/// Reports whether a `;`-separated desktop list names any of `desktops`.
fn lists_any(list: &str, desktops: &[&str]) -> bool {
    list.split(';').any(|listed| !listed.is_empty() && desktops.contains(&listed))
}

/// Parses a desktop entry and returns it only when the launcher should show it.
///
/// `desktops` are the names from `XDG_CURRENT_DESKTOP`, used for `OnlyShowIn` and `NotShowIn`.
/// Returns `None` for non-applications, hidden entries, entries for other desktops, and entries without a name or command.
pub fn parse_entry(text: &str, desktops: &[&str]) -> Option<DesktopEntry> {
    let pairs = main_group(text);
    let flag = |key: &str| pairs.get(key).is_some_and(|value| value == "true");
    if pairs.get("Type").map(String::as_str) != Some("Application") || flag("NoDisplay") || flag("Hidden") {
        return None;
    }
    if pairs.get("OnlyShowIn").is_some_and(|list| !lists_any(list, desktops)) {
        return None;
    }
    if pairs.get("NotShowIn").is_some_and(|list| lists_any(list, desktops)) {
        return None;
    }
    let name = pairs.get("Name").filter(|name| !name.is_empty())?.clone();
    let argv: Vec<String> = split_exec(pairs.get("Exec")?).iter().filter_map(|argument| strip_field_codes(argument)).collect();
    (!argv.is_empty()).then_some(DesktopEntry { name, argv })
}

#[cfg(test)]
#[path = "desktop_entry_tests.rs"]
mod tests;
