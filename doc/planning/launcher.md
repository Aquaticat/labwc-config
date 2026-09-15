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
- Launching passes the desktop file ID to `uwsm app -t service --`,
  as the retired `launch-new` passed IDs to `gtk-launch`.
  UWSM then applies `Exec`,
  field codes,
  `Path`,
  and `Terminal` itself,
  so the launcher does not reimplement them.
- Names follow the session locale:
  `Name[lang_COUNTRY@MODIFIER]`,
  `Name[lang_COUNTRY]`,
  `Name[lang@MODIFIER]`,
  `Name[lang]`,
  then `Name`,
  with the locale taken from `LC_ALL`,
  `LC_MESSAGES`,
  or `LANG`,
  as the Desktop Entry Specification describes.
- Launch feedback is a small surface the daemon draws,
  not the busy cursor `launch-feedback` produced.
  The cursor flip changed labwc's environment file and sent SIGHUP,
  and a labwc reconfigure stopped the compositor from answering a `wl_display.sync` for a median 13.6 ms (maximum 16.4 ms) in the VM,
  against 0.7 ms without the signal;
  that is a dropped frame on every flip and again on every revert.
  The surface shows a spinner and "Starting NAME" at the launcher's corner,
  takes no keyboard focus,
  and has an empty input region so clicks pass through.
  It ends when `ext_foreign_toplevel_list_v1` announces a toplevel created after the launch,
  but stays at least 800 ms so a fast application does not cause a blink,
  and ends after 5 s when no window appears;
  both values come from `launch-feedback`.
  Opening the launcher or `labwc-launcher close` also ends it.
- `labwc-launcher launch APP_ID` replaces `launch-new` for the taskbar's "New instance".
  It picks the entry whose desktop file ID is the app ID,
  then the same ignoring case,
  then the entry whose `StartupWMClass` matches ignoring case,
  then a command named like the app ID on `PATH`,
  and otherwise notifies that no launcher was found.
- `labwc-launcher run [--] COMMAND` replaces `launch-feedback COMMAND` in keybinds:
  the command becomes its own UWSM unit and gets launch feedback.
- `labwc-launcher dmenu` accepts `-p TEXT` as well as `--prompt TEXT`,
  so `uuctl labwc-launcher dmenu -p` works.
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
  launch feedback,
  application directory watching,
  and the socket server at `$XDG_RUNTIME_DIR/labwc-launcher.sock`.
  `user-unit/labwc-launcherd.service` runs it in the graphical session.
- `launcher/client`,
  binary `labwc-launcher`:
  `toggle`,
  `close`,
  `launch APP_ID`,
  `run [--] COMMAND [ARGUMENT...]`,
  and `dmenu [--prompt TEXT | -p TEXT]`.
  Arguments cannot contain line breaks,
  which the line-based protocol cannot carry.
  It depends only on `launcher/core`,
  so it links no Wayland or Slint code.

## Test seams

Delegated to the implementer by the user:

- `search`:
  query and names in,
  display order out.
- Desktop entry parsing:
  file text,
  desktop file ID,
  and locale in,
  visible entry out;
  app ID lookup over visible entries.
- Protocol codec:
  requests and replies to bytes and back.
- Meta tap recognizer:
  evdev key events in,
  tap,
  chord,
  and guard-toggle actions out.
- Session:
  keys,
  clicks,
  and scroll steps in,
  visible rows and outcomes out.
- Client command line:
  arguments in,
  request or dmenu prompt out.

Wayland,
rendering,
evdev reading,
and process launching are verified end to end in the VM session.

## Verified end to end in the VM on 2026-09-14

`launcher/test/end-to-end.ts` drives the release binaries in the headless labwc session.
It creates a `/dev/uinput` keyboard and an absolute pointer with a wheel through libc FFI,
and puts a stand-in `uwsm` first on `PATH` that records its arguments and starts real programs after `--`.
Run it as root in a disposable session:

```sh
deno run --allow-all launcher/test/end-to-end.ts --binaries /tmp/launcher/target/release --runtime-dir /tmp/hp-run
```

Every check passed:

- a second daemon refuses to start while the first serves the socket;
- `labwc-launcher toggle` shows the list,
  typing filters it,
  and Esc hides it;
- a desktop file written while the daemon runs appears without a restart,
  and Enter on it runs `uwsm app -t service -- zz-marker.desktop`;
- the launched `uwsm` starts with an empty blocked-signal mask,
  a check that failed with SIGINT and SIGTERM blocked before the daemon reset the mask for children;
- launch feedback appears,
  and without a window it ends 5000 ms later;
- `labwc-launcher launch MarkerApp` finds the entry by `StartupWMClass`,
  and `labwc-launcher launch true` falls back to the command;
- `labwc-launcher run -- foot` shows feedback that ends 832 ms later,
  after foot's window appeared;
- opening a foot window while the launcher is shown hides the launcher;
- clicking the third visible row launches that row's entry;
- three wheel notches move the list three rows,
  confirmed by clicking the new first row and by a screenshot;
- the uinput devices,
  created after the daemon started,
  are picked up by hotplug;
- a Meta tap shows the list,
  a second tap hides it,
  and a 500 ms press does nothing;
- Meta+F12 writes the guard flag,
  a tap is inert while suspended,
  and Meta+F12 again removes the flag;
- `labwc-launcher dmenu -p panel` shows the prompt,
  and Down then Enter prints `Lock screen` with status 0;
- `labwc-launcher close` cancels a pending dmenu,
  which exits with status 1 and no output;
- a clean stop removes the socket.

An earlier run of a Python version of the script also confirmed a sharp render at output scale 2.
Latency results are in `doc/planning/hot-path-budget.md`.

## Verified in a real uwsm session on 2026-09-15

The dev VM installed the packages from a local repository signed with a throwaway key,
and getty's autologin with the packaged fish login hook started labwc through uwsm:

- every session unit ran,
  and no user unit failed;
- each of the 18 visible desktop entries launched through `uwsm app -t service -- ID` without an error,
  including the `Terminal=true` entries for btop and micro,
  which uwsm opened in foot;
  foot is therefore a dependency of the `labwc-config` package.

## Not verified or not built yet

- The user must be in the `input` group for the Meta tap;
  without it the daemon logs the permission error and F13 still works.
  The installer adds the group.
- `DBusActivatable` entries without `Exec` are not listed.
- Measurement on the physical desktop.
