//! Query editing, selection, and scrolling for one shown launcher or dmenu.
//!
//! The daemon translates Wayland input into [`Key`]s, clicks, and scroll steps,
//! and renders [`Session::rows`] after every [`Outcome::Redraw`].

use crate::rank::{Order, search};

/// Input the session understands.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Key {
    /// Text produced by a key press.
    Text(String),
    /// Delete the last query character.
    Backspace,
    /// Select the previous match.
    Up,
    /// Select the next match.
    Down,
    /// Choose the selected match.
    Enter,
    /// Close without choosing.
    Escape,
}

/// What the daemon should do after an input.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Outcome {
    /// Visible state changed; render again.
    Redraw,
    /// Nothing changed.
    Ignored,
    /// The choice at this index of the original list was chosen.
    Activate(usize),
    /// Close without choosing.
    Dismiss,
}

/// One visible row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Row<'a> {
    /// Text of the choice.
    pub text: &'a str,
    /// Whether Enter would choose this row.
    pub selected: bool,
}

/// State of one shown list.
#[derive(Debug)]
pub struct Session {
    /// Choices in the order supplied.
    choices: Vec<String>,
    /// Tie order for ranking.
    order: Order,
    /// Text typed so far.
    query: String,
    /// Indices into `choices` in display order.
    matches: Vec<usize>,
    /// Position in `matches` of the selected match.
    selected: usize,
    /// Position in `matches` of the first visible row.
    top: usize,
    /// How many rows fit on screen.
    visible_rows: usize,
}

impl Session {
    /// Starts a session with an empty query over `choices`, showing at most `visible_rows` rows.
    pub fn new(choices: Vec<String>, order: Order, visible_rows: usize) -> Self {
        let mut session = Self {
            choices,
            order,
            query: String::new(),
            matches: Vec::new(),
            selected: 0,
            top: 0,
            visible_rows: visible_rows.max(1),
        };
        session.refilter();
        session
    }

    /// Text typed so far.
    pub fn query(&self) -> &str {
        &self.query
    }

    /// Rows currently visible, top to bottom.
    pub fn rows(&self) -> Vec<Row<'_>> {
        self.matches
            .iter()
            .enumerate()
            .skip(self.top)
            .take(self.visible_rows)
            .map(|(position, index)| Row {
                text: &self.choices[*index],
                selected: position == self.selected,
            })
            .collect()
    }

    /// Applies one key.
    pub fn handle(&mut self, key: Key) -> Outcome {
        match key {
            Key::Text(text) => {
                if text.is_empty() || text.chars().any(char::is_control) {
                    return Outcome::Ignored;
                }
                self.query.push_str(&text);
                self.refilter();
                Outcome::Redraw
            }
            Key::Backspace => {
                if self.query.pop().is_none() {
                    return Outcome::Ignored;
                }
                self.refilter();
                Outcome::Redraw
            }
            Key::Up => self.select(self.selected.checked_sub(1)),
            Key::Down => {
                self.select(Some(self.selected + 1).filter(|next| *next < self.matches.len()))
            }
            Key::Enter => self
                .matches
                .get(self.selected)
                .map_or(Outcome::Ignored, |index| Outcome::Activate(*index)),
            Key::Escape => Outcome::Dismiss,
        }
    }

    /// Chooses the visible row at `row`, counted from the top.
    pub fn click(&mut self, row: usize) -> Outcome {
        if row >= self.visible_rows {
            return Outcome::Ignored;
        }
        self.matches
            .get(self.top + row)
            .map_or(Outcome::Ignored, |index| Outcome::Activate(*index))
    }

    /// Moves the visible window by `rows`, negative toward the top.
    pub fn scroll(&mut self, rows: isize) -> Outcome {
        let last_top = self.matches.len().saturating_sub(self.visible_rows);
        let top = self.top.saturating_add_signed(rows).min(last_top);
        if top == self.top {
            return Outcome::Ignored;
        }
        self.top = top;
        let last_visible = (top + self.visible_rows).saturating_sub(1);
        self.selected = self.selected.clamp(top, last_visible);
        Outcome::Redraw
    }

    /// Recomputes matches for the current query and selects the best one.
    fn refilter(&mut self) {
        let names: Vec<&str> = self.choices.iter().map(String::as_str).collect();
        self.matches = search(&self.query, &names, self.order);
        self.selected = 0;
        self.top = 0;
    }

    /// Moves the selection to `position` when it exists, scrolling it into view.
    fn select(&mut self, position: Option<usize>) -> Outcome {
        let Some(position) = position else {
            return Outcome::Ignored;
        };
        self.selected = position;
        if position < self.top {
            self.top = position;
        }
        if position >= self.top + self.visible_rows {
            self.top = position + 1 - self.visible_rows;
        }
        Outcome::Redraw
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
