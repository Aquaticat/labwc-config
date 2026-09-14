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

## Open questions for the user

- Whether chains that end in a third-party application window,
  such as New instance or launching Dolphin,
  count as hot paths ending at that window,
  or end at the first feedback surface this repository controls.
