//! Chooses which workspace a pager command targets.
//!
//! Workspaces are indexed in the order the compositor announces them,
//! which for labwc is the order of `<desktops><names>` in `rc.xml`, read left to right and top to bottom.

/// Which way `next` and `prev` move.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    /// Toward the following workspace.
    Next,
    /// Toward the preceding workspace.
    Previous,
}

/// Resolves a grid index such as `4` or a workspace name such as `middle` to an index into `names`.
pub fn resolve(target: &str, names: &[String]) -> Option<usize> {
    target
        .parse::<usize>()
        .ok()
        .filter(|index| *index < names.len())
        .or_else(|| names.iter().position(|name| name == target))
}

/// Returns the index `direction` reaches from `active` among `count` workspaces, wrapping at both ends.
///
/// With no active workspace the first workspace counts as active.
pub fn step(active: Option<usize>, count: usize, direction: Direction) -> Option<usize> {
    if count == 0 {
        return None;
    }
    let current = active.unwrap_or(0) % count;
    Some(match direction {
        Direction::Next => (current + 1) % count,
        Direction::Previous => (current + count - 1) % count,
    })
}

#[cfg(test)]
#[path = "order_tests.rs"]
mod tests;
