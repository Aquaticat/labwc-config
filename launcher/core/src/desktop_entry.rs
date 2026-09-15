//! Reads the parts of a freedesktop desktop entry the launcher shows.
//!
//! Follows the Desktop Entry Specification's value escapes, visibility keys, and localized `Name` lookup.
//! Only the `[Desktop Entry]` group is read.
//! Launching passes the desktop file ID to UWSM, which handles `Exec`, field codes, `Path`, and `Terminal`.

use std::collections::HashMap;

/// A visible application: what the list shows and what launching names.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopEntry {
    /// Desktop file ID, such as `org.gnome.Nautilus.desktop`.
    pub id: String,
    /// `Name` in the best available locale, shown and searched.
    pub name: String,
    /// `StartupWMClass`, which names the app ID of the windows the application opens.
    pub startup_wm_class: Option<String>,
}

/// Finds the entry that opens windows with `app_id`, for starting another instance from a taskbar item.
///
/// Tries the desktop file ID named after the app ID, then the same ignoring case, then `StartupWMClass` ignoring case.
pub fn find_by_app_id<'a>(entries: &'a [DesktopEntry], app_id: &str) -> Option<&'a DesktopEntry> {
    let file_name = format!("{app_id}.desktop");
    entries
        .iter()
        .find(|entry| entry.id == file_name)
        .or_else(|| {
            entries
                .iter()
                .find(|entry| entry.id.eq_ignore_ascii_case(&file_name))
        })
        .or_else(|| {
            entries.iter().find(|entry| {
                entry
                    .startup_wm_class
                    .as_deref()
                    .is_some_and(|class| class.eq_ignore_ascii_case(app_id))
            })
        })
}

/// Returns the locale that governs messages, from `LC_ALL`, `LC_MESSAGES`, and `LANG` in that order.
///
/// Empty values are skipped, and the `C` and `POSIX` locales mean no localization.
pub fn message_locale<'a>(
    lc_all: Option<&'a str>,
    lc_messages: Option<&'a str>,
    lang: Option<&'a str>,
) -> Option<&'a str> {
    [lc_all, lc_messages, lang]
        .into_iter()
        .flatten()
        .find(|value| !value.is_empty())
        .filter(|locale| {
            let base = locale.split(['.', '@']).next().unwrap_or_default();
            base != "C" && base != "POSIX"
        })
}

/// Returns the `Name` keys to try for `locale`, most specific first, ending with the unlocalized key.
///
/// A locale has the form `lang_COUNTRY.ENCODING@MODIFIER`; the encoding never takes part in matching.
pub fn name_keys(locale: Option<&str>) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(locale) = locale {
        let (without_modifier, modifier) = locale
            .split_once('@')
            .map_or((locale, None), |(rest, modifier)| (rest, Some(modifier)));
        let without_encoding = without_modifier
            .split_once('.')
            .map_or(without_modifier, |(rest, _)| rest);
        let (language, country) = without_encoding
            .split_once('_')
            .map_or((without_encoding, None), |(language, country)| {
                (language, Some(country))
            });
        let mut candidates = Vec::new();
        if let (Some(country), Some(modifier)) = (country, modifier) {
            candidates.push(format!("{language}_{country}@{modifier}"));
        }
        if let Some(country) = country {
            candidates.push(format!("{language}_{country}"));
        }
        if let Some(modifier) = modifier {
            candidates.push(format!("{language}@{modifier}"));
        }
        candidates.push(language.to_owned());
        keys.extend(
            candidates
                .into_iter()
                .filter(|candidate| !candidate.is_empty())
                .map(|candidate| format!("Name[{candidate}]")),
        );
    }
    keys.push("Name".to_owned());
    keys
}

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

/// Reports whether a `;`-separated desktop list names any of `desktops`.
fn lists_any(list: &str, desktops: &[&str]) -> bool {
    list.split(';')
        .any(|listed| !listed.is_empty() && desktops.contains(&listed))
}

/// Parses a desktop entry and returns it only when the launcher should show it.
///
/// `desktops` are the names from `XDG_CURRENT_DESKTOP`, used for `OnlyShowIn` and `NotShowIn`,
/// and `name_keys` come from [`name_keys`].
/// Returns `None` for non-applications, hidden entries, entries for other desktops, and entries without a name or command.
pub fn parse_entry(
    id: &str,
    text: &str,
    desktops: &[&str],
    name_keys: &[String],
) -> Option<DesktopEntry> {
    let pairs = main_group(text);
    let flag = |key: &str| pairs.get(key).is_some_and(|value| value == "true");
    if pairs.get("Type").map(String::as_str) != Some("Application")
        || flag("NoDisplay")
        || flag("Hidden")
    {
        return None;
    }
    if pairs
        .get("OnlyShowIn")
        .is_some_and(|list| !lists_any(list, desktops))
    {
        return None;
    }
    if pairs
        .get("NotShowIn")
        .is_some_and(|list| lists_any(list, desktops))
    {
        return None;
    }
    pairs.get("Exec").filter(|exec| !exec.trim().is_empty())?;
    let name = name_keys
        .iter()
        .find_map(|key| pairs.get(key.as_str()).filter(|name| !name.is_empty()))?;
    Some(DesktopEntry {
        id: id.to_owned(),
        name: name.clone(),
        startup_wm_class: pairs
            .get("StartupWMClass")
            .filter(|class| !class.is_empty())
            .cloned(),
    })
}

/// Returns the desktop file ID for a file at `relative_path` below an `applications` directory.
///
/// Returns `None` for files that are not desktop entries.
pub fn desktop_file_id(relative_path: &str) -> Option<String> {
    relative_path
        .ends_with(".desktop")
        .then(|| relative_path.replace('/', "-"))
}

/// Parses `(desktop file ID, text)` pairs in data-directory precedence order into the entries to show.
///
/// The first file for an ID wins, so a hidden user override masks a system entry with the same ID.
pub fn visible_entries<'a>(
    files: impl IntoIterator<Item = (&'a str, &'a str)>,
    desktops: &[&str],
    name_keys: &[String],
) -> Vec<DesktopEntry> {
    let mut seen = std::collections::HashSet::new();
    files
        .into_iter()
        .filter(|(id, _)| seen.insert(*id))
        .filter_map(|(id, text)| parse_entry(id, text, desktops, name_keys))
        .collect()
}

#[cfg(test)]
#[path = "desktop_entry_tests.rs"]
mod tests;
