# Resident Slint launcher

## Purpose

Replace fuzzel,
`fuzzel-toggle`,
`meta-tap-launcher`,
and the dmenu uses of fuzzel with one resident daemon that reaches keyboard focus well inside the 20 ms budget.
The measurements and architecture decisions are in `doc/planning/hot-path-budget.md`.

## Behavior decided by the user on 2026-09-15

- **Matching**:
  case-insensitive substring containment against the desktop entry `Name` only.
- **Ordering**:
  names that start with the query,
  then names where a word starts with the query,
  then every other containing name;
  alphabetical within each tier.
- **Empty query**:
  every application,
  alphabetical.
- **Closing**:
  Esc,
  the same trigger again (Meta tap,
  F13,
  or the panel icon),
  a click outside the launcher,
  and keyboard focus moving to another surface.
- **Look**:
  bundled Inter,
  gray-white text on black,
  no icons.

## Settled without asking

- Case-insensitive matching:
  a start-menu search that distinguishes case would contradict the requested Windows-like behavior.
- A word starts after whitespace or punctuation,
  so "code" starts a word in "VS Code" and "org.code".
- Launching uses `uwsm app -t service --` with the entry's `Exec` field codes removed,
  as `launch-new` and `launch-feedback` do today.

## Components

- `launcher/core`:
  platform-free logic with unit tests:
  ranking,
  desktop entry parsing,
  the socket protocol codec,
  and the Meta tap recognizer.
- `launcher/app`:
  Linux binaries:
  the daemon (Wayland layer surface,
  Slint rendering,
  evdev,
  socket server)
  and the client (toggle and dmenu requests).

## Test seams

Delegated to the implementer by the user:

- `search`:
  query and names in,
  display order out.
- Desktop entry parsing:
  file text in,
  visible name and launch command out.
- Protocol codec:
  requests and replies to bytes and back.
- Meta tap recognizer:
  evdev key events in,
  tap,
  chord,
  and guard-toggle actions out.

Wayland,
rendering,
evdev reading,
and process launching are verified end to end in the VM session.
