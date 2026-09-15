//! Finds the applications to list by scanning `applications` directories in XDG data-directory precedence.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use launcher_core::desktop_entry::{DesktopEntry, desktop_file_id, visible_entries};

/// Data directories searched when `XDG_DATA_DIRS` is unset or empty.
const DEFAULT_DATA_DIRS: &str = "/usr/local/share:/usr/share";

/// Returns every `applications` directory, most important first.
pub fn application_dirs() -> Vec<PathBuf> {
    let data_home = env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    let data_dirs = env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_DATA_DIRS.to_owned());
    data_home
        .into_iter()
        .chain(
            data_dirs
                .split(':')
                .filter(|dir| !dir.is_empty())
                .map(PathBuf::from),
        )
        .map(|dir| dir.join("applications"))
        .collect()
}

/// Desktop names from `XDG_CURRENT_DESKTOP`, used for `OnlyShowIn` and `NotShowIn`.
pub fn current_desktops() -> Vec<String> {
    env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .split(':')
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Reads every desktop entry below `dirs` and returns the ones to show.
pub fn load(dirs: &[PathBuf], desktops: &[String]) -> Vec<DesktopEntry> {
    let mut files = Vec::new();
    for dir in dirs {
        collect(dir, dir, &mut files);
    }
    let desktops: Vec<&str> = desktops.iter().map(String::as_str).collect();
    visible_entries(
        files.iter().map(|(id, text)| (id.as_str(), text.as_str())),
        &desktops,
    )
}

/// Appends `(desktop file ID, text)` for every desktop file below `dir`, recursing into subdirectories.
///
/// Unreadable directories and files are skipped: one broken package must not empty the launcher.
fn collect(root: &Path, dir: &Path, files: &mut Vec<(String, String)>) {
    let Ok(listing) = fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = listing
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            collect(root, &path, files);
            continue;
        }
        let Some(id) = path
            .strip_prefix(root)
            .ok()
            .and_then(Path::to_str)
            .and_then(desktop_file_id)
        else {
            continue;
        };
        if let Ok(text) = fs::read_to_string(&path) {
            files.push((id, text));
        }
    }
}
