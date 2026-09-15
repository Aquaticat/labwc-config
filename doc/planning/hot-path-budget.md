# Hot-path inventory and the 20 ms budget

## Rule

A hot path is the chain from a user input event to the surface that input requires becoming interactive.
Every hot path must finish in under 20 ms,
measured on the physical desktop
(`doc/decision/typescript-runtime.md`).

## Chains found in the current configuration

Each chain lists the programs it passes through,
from the archived helpers and the live `config/`:

- **Bare Meta tap opens the launcher**:
  key release seen by `meta-tap-launcher`,
  then `fuzzel-toggle`,
  then `uwsm app -- fuzzel`,
  then fuzzel's layer surface receives keyboard focus.
  A tap is recognized only on release,
  so the chain starts at the release event.
- **F13 opens the launcher**:
  labwc `Execute`,
  then `fuzzel-toggle` onward as for the Meta tap.
- **Launcher icon click opens the launcher**:
  sfwbar `Exec`,
  then `fuzzel-toggle` onward.
- **Meta tap,
  F13,
  or icon click closes the launcher**:
  the same chains ending when fuzzel's surface is gone and focus returns to the previous surface.
- **Desktop click closes the launcher**:
  labwc `Execute` of `pkill -x fuzzel`.
- **Empty panel right-click opens the panel menu**:
  sfwbar `Exec`,
  then `panel-menu`,
  then `fuzzel --dmenu` receives keyboard focus.
- **Meta+V opens the clipboard picker**:
  labwc `Execute` of `sh -c 'cliphist list | fuzzel --dmenu | …'`,
  ending when fuzzel receives keyboard focus.
- **Meta+Shift+S starts a region screenshot**:
  labwc `Execute` of `sh -c 'grim -g "$(slurp)" - | swappy -f -'`,
  ending when slurp's selection surface receives pointer input.
- **Meta+F12 toggles the shortcut guard**:
  labwc `ToggleKeybinds` needs no helper;
  `meta-tap-launcher` flips its flag and sends a notification through `notify-send` to swaync.
- **Taskbar New instance**:
  sfwbar menu `Exec`,
  then `launch-new`,
  then `uwsm app -t service -- gtk-launch`,
  ending when the application's window is interactive.
- **Launching from fuzzel,
  Meta+Return,
  or Meta+E**:
  `launch-feedback`,
  then `uwsm app -t service --`,
  ending when the application's window is interactive;
  the busy cursor is the intermediate feedback surface.

## Programs this repository does not own

Several chains pass through programs whose own startup counts against the budget:
fuzzel,
`uwsm app`,
which is a Python program,
`cliphist`,
slurp,
`notify-send` and swaync,
and every launched application.
Their cost has not been measured.
UWSM also ships `uwsm-app`,
a client for its application daemon intended to launch faster than `uwsm app`;
that claim needs measuring before relying on it.

## VM measurements on 2026-09-14

Environment:
the Hyper-V CachyOS VM,
labwc 0.20.2 as root with `WLR_BACKENDS=headless,libinput`,
`WLR_RENDERER=pixman`,
and `LIBSEAT_BACKEND=noop`,
so fuzzel received a real `wl_keyboard.enter`;
fuzzel 1.15.0,
uwsm 0.26.7,
9 desktop entries,
Inter not installed.
Each case ran 3 warm-up and 20 measured iterations from a Deno harness.

- `uwsm version`:
  median 65.0 to 67.0 ms across two rounds.
  `python3 -c pass` alone:
  9.9 to 11.1 ms.
  `qjs -e 0`:
  1.2 to 1.4 ms.
- fuzzel from spawn to `wl_keyboard.enter`:
  - default configuration:
    median 26.8 to 27.5 ms;
  - `config/fuzzel/fuzzel.ini`:
    median 30.1 ms;
  - the same with `--no-icons`:
    median 29.6 ms;
  - `--dmenu` with 5 lines:
    median 28.8 ms.
- Positive control,
  `sh -c 'sleep 0.010; exec fuzzel …'`:
  median 42.7 ms,
  12.6 ms above the uncontrolled run,
  so the method resolves a 10 ms delay.

The libwayland debug timestamp is wall-clock UTC time with microsecond digits:
a `WAYLAND_DEBUG=client` line printed `[23:37:20.527503]` between two `date +%s.%N` readings of
`1789429040.524231464` and `1789429040.528685439`.

### Conclusions

- `uwsm app` cannot sit on a hot path:
  its startup alone is about 3 times the budget in the VM.
- fuzzel's own startup exceeds the budget in the VM,
  independent of icons and dmenu mode.
  It needs measuring on the physical desktop before the launcher choice is final.
- The Meta-tap daemon is already resident,
  so it can check for and spawn fuzzel itself,
  with no separate toggle process on that chain.

## Decisions after the VM measurements

Decided by the user on 2026-09-14:

- Hot-path helpers start fuzzel directly,
  not through `uwsm app`,
  `uwsm-app`,
  or `systemd-run`.
  Applications launched from the launcher still get their own UWSM units.
- Faster launchers are researched and measured in the VM with the same harness before fuzzel is kept or replaced.

## Launcher candidates measured in the VM on 2026-09-14

Same VM and headless labwc session,
run inside `dbus-run-session`;
3 warm-up and 20 measured iterations each.
Resident launchers were measured from the trigger to `wl_keyboard.enter` in the resident process's `WAYLAND_DEBUG` log.
Candidates came from a research pass over resident and startup-optimized layer-shell launchers;
walker 2.17.0 is in the CachyOS repository,
tofi 0.9.1 and elephant 2.22.0 were built from AUR snapshots.

- fuzzel 1.15.0 with `config/fuzzel/fuzzel.ini`:
  median 29.6 ms,
  p90 33.0 ms.
- fuzzel with `render-workers=0` and `match-workers=0`:
  median 27.1 ms,
  p90 31.8 ms.
- `tofi-drun` with a font file path,
  `--hint-font false`,
  anchored bottom-left at 480×360:
  median 12.2 ms,
  p90 13.3 ms.
  tofi draws no application icons.
- `tofi` in dmenu mode with 5 lines:
  median 12.4 ms,
  p90 14.3 ms.
- walker service (`walker --gapplication-service` with elephant),
  shown by connecting to `$XDG_RUNTIME_DIR/walker/walker.sock` from the harness:
  median 17.7 ms,
  p90 21.9 ms,
  after a one-time first show of 141.6 ms.
- walker service shown by spawning `nc -U -N` on that socket,
  as a QuickJS-ng helper would have to because QuickJS-ng has no sockets:
  median 19.0 ms,
  p90 22.9 ms.
- `walker --dmenu`,
  which starts a GTK client that forwards to the service:
  median 74.6 ms,
  p90 77.9 ms.

The first walker attempt closed the window with `walker --close` and timed out:
that GTK client had not finished before the next show,
so the next socket connection toggled the window closed.
Closing through the same socket and waiting for `wl_keyboard.leave` fixed the harness.

Feature gaps from the research pass,
not yet verified in a session:
walker has no close-on-focus-loss,
and its click-to-close needs a fullscreen surface;
tofi keeps exclusive keyboard focus and has no close-on-focus-loss either.

## Resident Slint launcher spike on 2026-09-14

Proposed by the user after the launcher measurements:

> write a Slint app that bundles in Inter font and has string contains search,
> like how Windows start menu works.
> Icons aren't needed.
> Theming other than gray-ish white on black isn't needed.

The user also allowed a daemon architecture.

A throwaway spike on branch `prototype/slint-layer-launcher`,
directory `prototype/slint-layer-launcher/`,
kept a Slint 1.17.1 software-rendered window resident and created a smithay-client-toolkit 0.21.1 layer surface on SIGUSR1.
In the same VM session:

- warm show to `wl_keyboard.enter`:
  median 2.4 ms,
  p90 3.1 ms,
  maximum 3.5 ms over 20 runs;
- first show after start:
  4.0 ms;
- process start to ready:
  12.4 ms;
- idle resident memory:
  9.1 MiB;
- positive control with a 10 ms sleep in the show path:
  median 13.1 ms;
- a `grim` screenshot while shown contained the rendered list,
  anchored bottom-left.

Verdict:
a resident Slint launcher fits the budget with the most headroom of every candidate measured,
about 12 times faster than fuzzel and 7 times faster than walker's warm socket show in the VM.

## Launcher architecture decisions on 2026-09-14

Decided by the user after the spike:

- The launcher is a resident Rust and Slint daemon living in this repository.
- The daemon reads evdev keyboards itself and recognizes the bare Meta tap in-process,
  replacing the separate `meta-tap-launcher` watcher and the IPC hop on that chain.
  The Meta+F12 shortcut-guard flag moves into the daemon with it.
- F13,
  the panel launcher icon,
  the panel menu,
  and the clipboard picker reach the daemon through a small Rust client binary over a Unix socket:
  a toggle request,
  and a dmenu request that sends lines and receives the selection.
- The same daemon serves application launching and dmenu roles.
- Search is substring containment over names,
  without icons,
  with bundled Inter and gray-white text on black.

The daemon therefore absorbs `fuzzel-toggle`,
`meta-tap-launcher`,
`toggle-shortcut-guard`,
and fuzzel's dmenu roles.
Because the daemon now launches applications,
the busy-cursor flip from `launch-feedback` moves into the daemon as well,
superseding the earlier plan to port that flip to QuickJS-ng;
only the Wayland window watcher that ends the busy cursor remains a Deno helper.
The TypeScript ports that remain are `launch-new`,
`wlr-pager`,
the command dispatch after a `panel-menu` selection,
and that window watcher.

These chains therefore leave the QuickJS-ng runtime decision:
the launcher daemon and its client are native binaries.
The client's start cost is measured in the next section.

Considered after the spike and not benchmarked:
a second research pass found Noctalia 5.1.0,
a native shell with a raw-socket launcher and dmenu,
but its launcher creates a new layer surface and GLES scene on every show
and has no labwc backend for finding the focused output,
so it cannot beat the resident spike's show path.

## Resident launcher daemon measured in the VM on 2026-09-14

`labwc-launcherd` and `labwc-launcher` from `launcher/`,
release builds,
in the same headless labwc session as root,
with a `/dev/uinput` keyboard for key input,
3 warm-up and 20 measured iterations per case.
Marks come from the daemon's `LABWC_LAUNCHER_TRACE` output,
printed from the same `wl_keyboard.enter` handler position the spike's positive control validated.

- `labwc-launcher toggle`,
  from the harness spawning the client to keyboard focus:
  median 3.7 to 3.8 ms,
  p90 4.5 to 4.9 ms,
  across three runs.
- Meta release written to the uinput device to keyboard focus:
  median 2.1 to 2.2 ms,
  p90 2.5 to 2.7 ms.
- `labwc-launcher close` round trip including the client's process start:
  median 0.8 to 0.9 ms.
- Client toggle to keyboard focus at output scale 2:
  median 4.3 ms,
  p90 5.0 ms;
  at output scale 3:
  median 5.8 ms,
  p90 8.0 ms.
- Daemon spawn to ready:
  12.6 to 16.2 ms;
  idle resident memory:
  8.1 to 8.3 MiB.

Every launcher chain fits the budget in the VM with at least 12 ms to spare at scale 3.
Physical measurement remains open.

## Measurement method to validate

- **Input time**:
  the kernel timestamp in the evdev `input_event` that triggers the chain.
- **Interactive time**:
  for keyboard-driven surfaces,
  the `wl_keyboard.enter` event delivered to the new surface,
  logged with `WAYLAND_DEBUG=client` in that client;
  for pointer-driven surfaces,
  the first `wl_pointer.enter`.
- Both clocks must be proven comparable before use:
  evdev defaults to `CLOCK_REALTIME` unless the reader sets another clock,
  and the libwayland debug timestamp source must be read from libwayland's source.
- A positive control with a deliberate delay must move the measured interval by that delay.
- Run-to-run spread is measured before comparing designs.

## Application launches

Decided by the user on 2026-09-14:
a chain that ends in a third-party application window is a hot path that ends at the first feedback this repository controls,
such as the busy cursor.
The application's own startup is measured and reported but not bound by the budget.
The cursor flip was first planned as a QuickJS-ng hot path in `launch-feedback`;
after the launcher architecture decisions it belongs to the launcher daemon,
while the Wayland window watcher stays on Deno.
