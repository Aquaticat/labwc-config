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
The cursor flip in `launch-feedback` is therefore a QuickJS-ng hot path,
while its Wayland window watcher stays on Deno.
