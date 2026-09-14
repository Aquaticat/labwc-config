# UWSM scope launches inherit the caller's environment, which breaks theming and xwayland-satellite

## Metadata

- **Status**:
  Verified behavior with a local fix.
- **First observed**:
  2026-07-20 on UWSM 0.26.1,
  labwc 0.9.6,
  and xwayland-satellite 0.8.1 in the Bazzite rehearsal.
- **Re-checked**:
  2026-08-29 on UWSM 0.26.2,
  labwc 0.20.2,
  and xwayland-satellite 0.8.2 in the CachyOS VM.
- **Evidence**:
  `archive/bazzite-rehearsal/HANDOVER.md`,
  sections dated 2026-07-20 evening,
  2026-07-20 night,
  and 2026-08-29.

## Symptom

Two symptoms share one cause:

- A Dolphin window opened from the panel's **New instance** menu rendered light,
  while Dolphin opened from fuzzel rendered black.
- On CachyOS,
  an application launched through `launch-feedback` connected to `DISPLAY=:0`,
  where no X server listens,
  instead of xwayland-satellite on `DISPLAY=:12`.

## Root cause

`uwsm app` defaults to a transient scope.
A scope's process is a child of the caller and inherits the caller's environment.

In the light Dolphin case,
sfwbar had been restarted from an SSH shell,
so its environment lacked `QT_QPA_PLATFORMTHEME=kde`
and contained `SSH_CLIENT`.
Every scope sfwbar started inherited that environment.

In the `DISPLAY` case,
labwc's own environment still says `DISPLAY=:0`.
labwc's built-in Xwayland is disabled through `WLR_XWAYLAND` pointing at a nonexistent path,
but wlroots sets `DISPLAY=:0` in labwc's environment anyway.
UWSM finalization then exports labwc's `DISPLAY=:0` into the systemd activation environment
after `~/.config/uwsm/env` is read.

## Fix

Launch applications with `uwsm app -t service --`.
A service starts from the systemd user activation environment,
not from the caller.

Make xwayland-satellite the last writer of `DISPLAY`.
`user-unit/xwayland-satellite.service.d/override.conf` pins the display and republishes it after the unit starts:

```ini
# user-unit/xwayland-satellite.service.d/override.conf
[Service]
ExecStart=
ExecStart=/usr/bin/xwayland-satellite :12
ExecStartPost=/usr/bin/systemctl --user set-environment DISPLAY=:12
ExecStartPost=-/usr/bin/dbus-update-activation-environment DISPLAY=:12
```

The satellite unit is ordered after `graphical-session.target`,
which UWSM reaches after finalization,
so its `ExecStartPost` runs after the stale export.

## Verification

Check which unit and display a launched application received:

```bash
systemctl --user list-units 'app-*' --no-pager
tr '\0' '\n' < "/proc/$(pgrep --newest dolphin)/environ" | rg '^(DISPLAY|QT_QPA_PLATFORMTHEME|SSH_CLIENT)='
```

A correct launch runs as an `app-…@….service` unit under `app-graphical.slice`,
shows `DISPLAY=:12`,
and shows no `SSH_CLIENT`.

## Related behavior

- `systemctl --user restart wayland-wm@labwc.service` was cancelled by UWSM's own teardown in the rehearsal.
  Stop the unit instead;
  tty1 autologin restarts the session.
- Java applications such as IntelliJ IDEA rendered blank windows under xwayland-satellite until
  `_JAVA_AWT_WM_NONREPARENTING=1` was set in `~/.config/uwsm/env`,
  as xwayland-satellite's README advises.
- xwayland-satellite applies one scale factor,
  taken from the monitor with the smallest DPI,
  to every X11 window.
