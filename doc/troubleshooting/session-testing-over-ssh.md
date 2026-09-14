# Testing the session over SSH: self-killing commands, blocking notifications, and phantom lock screens

## Metadata

- **Status**:
  Verified pitfalls with workarounds.
- **Observed**:
  2026-07-20 in the Bazzite rehearsal,
  while driving the guest session over SSH.
- **Evidence**:
  `archive/bazzite-rehearsal/HANDOVER.md`,
  sections "Session end state" and 2026-07-20 latest.

## `pkill --full` kills the SSH command that runs it

### Symptom

An SSH one-liner that restarts an application exits with status 255 and prints nothing.

### Root cause

`pkill --full <pattern>` matches the remote shell,
because the shell's own command line contains the pattern.
The bracket trick (`[y]afti_gtk.py`) protects only that argument;
any other literal copy of the name in the same command line,
such as the relaunch command or a `sed` expression,
still matches.

### Fix

- Prefer `pkill --exact <name>`,
  which matches the process name rather than the command line.
- When a full-command-line match is unavoidable,
  run the kill and the relaunch in separate SSH invocations.

## `notify-send --action` blocks the shell

`notify-send` with an action waits until the notification is acted on or closed.
Run it in the background when testing notification styling.

## swaync's user stylesheet replaces the stock one

`~/.config/swaync/style.css` is loaded instead of `/etc/xdg/swaync/style.css`,
not in addition to it.
`config/swaync/style.css` is therefore the full stock sheet followed by an override block of CSS custom properties.
Apply changes with `swaync-client --reload-css`.

## Screenshots show only a lock surface

During the rehearsal,
every screenshot showed a uniform `#1b1e20` surface for an hour of debugging.
swayidle's 600-second timeout had started swaylock.
The session no longer runs swayidle;
locking is manual through Meta+L.

## Capture the session from inside

Take screenshots inside the guest with `grim`,
after importing the session environment:

```bash
export XDG_RUNTIME_DIR="/run/user/$(id --user)"
export WAYLAND_DISPLAY="$(systemctl --user show-environment | sed --quiet 's/^WAYLAND_DISPLAY=//p')"
grim /tmp/session.png
```
