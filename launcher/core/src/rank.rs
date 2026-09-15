//! Orders application names for a start-menu style substring search.
//!
//! Matching is case-insensitive containment.
//! Results are grouped into tiers (name prefix, word start, anywhere) and sorted alphabetically within a tier.

/// How strongly a name matches a query; lower sorts first.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum Tier {
    /// The whole name starts with the query.
    Prefix,
    /// A word inside the name starts with the query.
    WordStart,
    /// The query appears somewhere else in the name.
    Anywhere,
}

/// Classifies how `name` contains `query`, both already lowercased.
///
/// Returns `None` when the name does not contain the query.
fn tier(name: &str, query: &str) -> Option<Tier> {
    if name.starts_with(query) {
        return Some(Tier::Prefix);
    }
    let mut found = false;
    for (offset, _) in name.match_indices(query) {
        found = true;
        // A word starts after whitespace or punctuation.
        let starts_word = name[..offset].chars().next_back().is_some_and(|previous| !previous.is_alphanumeric());
        if starts_word {
            return Some(Tier::WordStart);
        }
    }
    found.then_some(Tier::Anywhere)
}

/// Returns indices into `names` for every name matching `query`, in display order.
///
/// An empty query matches every name.
/// Ties within a tier sort by lowercased name, then by original position, so output is deterministic.
pub fn search(query: &str, names: &[&str]) -> Vec<usize> {
    let query = query.to_lowercase();
    let mut matches: Vec<(Tier, String, usize)> = names
        .iter()
        .enumerate()
        .filter_map(|(index, name)| {
            let lowered = name.to_lowercase();
            tier(&lowered, &query).map(|found| (found, lowered, index))
        })
        .collect();
    matches.sort();
    matches.into_iter().map(|(_, _, index)| index).collect()
}

#[cfg(test)]
#[path = "rank_tests.rs"]
mod tests;
