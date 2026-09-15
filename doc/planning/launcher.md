# Resident Slint launcher

## Purpose

Replace fuzzel,
`fuzzel-toggle`,
`meta-tap-launcher`,
and the dmenu uses of fuzzel with one resident daemon that reaches keyboard focus well inside the 20 ms budget.
The measurements and architecture decisions are in `doc/planning/hot-path-budget.md`.

## Behavior decided by the user on 2026-09-14

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
- dmenu lines keep the order the client supplied,
  both for an empty query and within a match tier,
  because clipboard history arrives newest first and the panel menu has a deliberate order.
  Applications stay alphabetical as decided.
- A higher-precedence desktop file masks a lower one with the same desktop file ID even when it hides the entry,
  as the Desktop Entry Specification requires.
- Clicks on the bare desktop close the launcher through labwc `Root` mousebinds running `labwc-launcher close`,
  as they closed fuzzel before.
  Clicks on the panel do not close it,
  also as before;
  a transparent click-catching surface would cover the panel but adds a second full-output commit to every show and has not been measured.
- A cancelled dmenu exits with status 1 and prints nothing,
  as dmenu and fuzzel do.
- The shortcut guard flag lives at `$XDG_RUNTIME_DIR/labwc-launcher-shortcuts-suspended`.
  It survives a daemon crash and restart,
  and a clean stop at session end removes it,
  because labwc's own `ToggleKeybinds` state also resets with the session.
- Rendering uses the integer buffer scale the compositor reports,
  starting from the largest output scale before the first report.
  `wp_fractional_scale_v1` is not used,
  so a fractional output scale renders at whatever integer scale labwc reports for it.

## Components

- `launcher/core`:
  platform-free logic with unit tests:
  ranking,
  desktop entry parsing and masking,
  the socket protocol codec,
  the Meta tap recognizer,
  and the query and selection session.
- `launcher/daemon`,
  binary `labwc-launcherd`:
  Wayland layer surface,
  Slint software rendering with Inter 4.1 bundled from `launcher/daemon/font/`,
  evdev reading with device hotplug,
  application directory watching,
  and the socket server at `$XDG_RUNTIME_DIR/labwc-launcher.sock`.
  `user-unit/labwc-launcherd.service` runs it in the graphical session.
- `launcher/client`,
  binary `labwc-launcher`:
  `toggle`,
  `close`,
  and `dmenu [--prompt TEXT]`.
  It depends only on `launcher/core`,
  so it links no Wayland or Slint code.

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

## Verified end to end in the VM on 2026-09-14

A script drove the release binaries in the headless labwc session with a `/dev/uinput` keyboard
and a stand-in `uwsm` on `PATH` that records its arguments.
Every check passed:

- a second daemon refuses to start while the first serves the socket;
- `labwc-launcher toggle` shows the list and Esc hides it;
- typing filters the list,
  confirmed by a screenshot showing only Vim for "vi";
- a desktop file written while the daemon runs appears without a restart,
  and Enter on it runs `uwsm app -t service -- marker-app --flag` with the `%U` field code removed;
- the launched `uwsm` starts with an empty blocked-signal mask,
  a check that failed with SIGINT and SIGTERM blocked before the daemon reset the mask for children;
- the uinput keyboard,
  created after the daemon started,
  is picked up by hotplug;
- a Meta tap shows the list,
  a second tap hides it,
  and a 500 ms press does nothing;
- Meta+F12 writes the guard flag,
  a tap is inert while suspended,
  and Meta+F12 again removes the flag;
- `labwc-launcher dmenu --prompt panel` shows the prompt,
  and Down then Enter prints `Lock screen` with status 0;
- `labwc-launcher close` cancels a pending dmenu,
  which exits with status 1 and no output;
- at output scale 2 the screenshot is sharp at twice the pixel size;
- a clean stop removes the socket.

Latency results are in `doc/planning/hot-path-budget.md`.

## Not verified or not built yet

- Clicking a row and wheel scrolling:
  the script injects no pointer input.
- Hiding when keyboard focus moves to another window:
  the headless session had no other window.
- The busy cursor after a launch,
  which moved into the daemon from `launch-feedback`.
- The end-to-end script is Python kept outside the repository;
  it needs porting to Deno,
  using FFI for the uinput ioctls,
  before it can be committed.
- `Terminal=true` entries start without a terminal,
  `DBusActivatable` is ignored,
  and names are unlocalized.
- The user must be in the `input` group for the Meta tap;
  without it the daemon logs the permission error and F13 still works.
  The installer does not add the group yet.
- `panel-menu` still calls `fuzzel --dmenu` until it is ported,
  so `config/fuzzel/fuzzel.ini` stays for now.
- Measurement on the physical desktop.
