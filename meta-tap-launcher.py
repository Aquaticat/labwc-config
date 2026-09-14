#!/usr/bin/env python3
"""Bare-Meta-tap launcher: passive evdev observer, no grabs, no uinput.

Fires CMD when LEFTMETA is pressed and released with no other key or
mouse button in between (KDE Meta-tap semantics). Coexists with ydotoold
and any other input tooling because it never modifies the event stream.
Requires membership in the 'input' group and python3-evdev.
"""
import select
import subprocess

import evdev
from evdev import ecodes

CMD = ["uwsm", "app", "--", "fuzzel"]
TAP_TIMEOUT_S = 0.4


def open_devices():
    devs = []
    for path in evdev.list_devices():
        try:
            d = evdev.InputDevice(path)
        except OSError:
            continue
        caps = d.capabilities().get(ecodes.EV_KEY, [])
        # keyboards (have LEFTMETA) and pointers (buttons veto the tap)
        if ecodes.KEY_LEFTMETA in caps or ecodes.BTN_LEFT in caps:
            devs.append(d)
    return devs


def main():
    devs = open_devices()
    if not devs:
        raise SystemExit("no input devices readable (not in 'input' group?)")
    fdmap = {d.fd: d for d in devs}
    armed = False
    t_down = 0.0
    while True:
        ready, _, _ = select.select(fdmap, [], [], None)
        for fd in ready:
            try:
                events = fdmap[fd].read()
            except OSError:
                fdmap.pop(fd)
                continue
            for ev in events:
                if ev.type != ecodes.EV_KEY:
                    continue
                if ev.code == ecodes.KEY_LEFTMETA:
                    if ev.value == 1:  # down
                        armed = True
                        t_down = ev.timestamp()
                    elif ev.value == 0:  # up
                        if armed and ev.timestamp() - t_down <= TAP_TIMEOUT_S:
                            subprocess.Popen(CMD)
                        armed = False
                elif ev.value == 1:  # any other press vetoes the tap
                    armed = False


if __name__ == "__main__":
    main()
