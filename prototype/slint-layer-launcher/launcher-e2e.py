#!/usr/bin/env python3
"""End-to-end check of labwc-launcherd in the headless labwc session. Run as root in the VM."""
import fcntl
import os
import statistics
import struct
import subprocess
import sys
import time

RUN = "/tmp/hp-run"
BIN = "/tmp/launcher/target/release"
LOG = f"{RUN}/launcherd.log"
FAKEBIN = f"{RUN}/fakebin"
LAUNCHED = f"{RUN}/launched-args"
DATA_HOME = f"{RUN}/data"
ENV = {
    **os.environ,
    "XDG_RUNTIME_DIR": RUN,
    "WAYLAND_DISPLAY": "wayland-0",
    "XDG_CURRENT_DESKTOP": "labwc:wlroots",
    "XDG_DATA_HOME": DATA_HOME,
    "LABWC_LAUNCHER_TRACE": "1",
    "PATH": f"{FAKEBIN}:{os.environ['PATH']}",
}
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail}")
    if not ok:
        failures.append(name)


def marks(kind):
    with open(LOG) as log:
        return [float(line.split()[1]) for line in log if line.startswith(kind + " ")]


def wait_mark(kind, before, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = marks(kind)
        if len(found) > before:
            return found[before]
        time.sleep(0.002)
    return None


# ---- uinput keyboard
UI_SET_EVBIT, UI_SET_KEYBIT, UI_DEV_CREATE, UI_DEV_DESTROY = 0x40045564, 0x40045565, 0x5501, 0x5502
EV_SYN, EV_KEY = 0, 1
KEYS = {"meta": 125, "f12": 88, "esc": 1, "enter": 28, "backspace": 14, "down": 108,
        "v": 47, "i": 23, "z": 44, "m": 50, "a": 30, "r": 19, "k": 37, "e": 18}


class Keyboard:
    def __init__(self):
        self.fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        fcntl.ioctl(self.fd, UI_SET_EVBIT, EV_KEY)
        for code in KEYS.values():
            fcntl.ioctl(self.fd, UI_SET_KEYBIT, code)
        name = b"launcher-e2e-keyboard".ljust(80, b"\0")
        os.write(self.fd, name + struct.pack("<HHHHI", 3, 1, 1, 1, 0) + b"\0" * (64 * 4 * 4))
        fcntl.ioctl(self.fd, UI_DEV_CREATE)

    def emit(self, code, value):
        now = time.time()
        sec, usec = int(now), int((now % 1) * 1e6)
        os.write(self.fd, struct.pack("<qqHHi", sec, usec, EV_KEY, code, value)
                 + struct.pack("<qqHHi", sec, usec, EV_SYN, 0, 0))
        return now * 1000

    def tap(self, key, hold=0.03):
        self.emit(KEYS[key], 1)
        time.sleep(hold)
        return self.emit(KEYS[key], 0)

    def chord(self, modifier, key):
        self.emit(KEYS[modifier], 1)
        time.sleep(0.03)
        self.tap(key)
        time.sleep(0.03)
        self.emit(KEYS[modifier], 0)

    def type(self, text):
        for character in text:
            self.tap(character, 0.01)
            time.sleep(0.02)

    def close(self):
        fcntl.ioctl(self.fd, UI_DEV_DESTROY)
        os.close(self.fd)


def client(*args, stdin=None):
    return subprocess.run([f"{BIN}/labwc-launcher", *args], env=ENV, input=stdin,
                          capture_output=True, text=True, timeout=10)


def shot(name):
    subprocess.run(["grim", f"{RUN}/{name}.png"], env=ENV, check=False)


def report(name, values):
    values = sorted(values)
    print(f"{name}: median {statistics.median(values):.1f} ms, p90 {values[int(len(values) * 0.9)]:.1f} ms, "
          f"min {values[0]:.1f} ms, max {values[-1]:.1f} ms, n={len(values)}")


# ---- fixtures
os.makedirs(FAKEBIN, exist_ok=True)
with open(f"{FAKEBIN}/uwsm", "w") as fake:
    fake.write(f"#!/bin/sh\ngrep SigBlk /proc/self/status > {LAUNCHED}.mask\nprintf '%s\\n' \"$@\" > {LAUNCHED}\n")
os.chmod(f"{FAKEBIN}/uwsm", 0o755)
os.makedirs(f"{DATA_HOME}/applications", exist_ok=True)
for stale in (LAUNCHED, f"{DATA_HOME}/applications/zz-marker.desktop", f"{RUN}/labwc-launcher-shortcuts-suspended"):
    if os.path.exists(stale):
        os.remove(stale)
subprocess.run(["pkill", "-x", "labwc-launcherd"], check=False)
subprocess.run(["pkill", "-f", "walker|elephant|prototype-slint"], check=False)
time.sleep(0.3)

log_file = open(LOG, "w")
started = time.time() * 1000
daemon = subprocess.Popen([f"{BIN}/labwc-launcherd"], env=ENV, stdout=subprocess.DEVNULL, stderr=log_file)
ready = wait_mark("READY", 0)
check("daemon ready", ready is not None, f"{(ready or 0) - started:.1f} ms after spawn")
with open(f"/proc/{daemon.pid}/status") as status:
    rss = next(line for line in status if line.startswith("VmRSS")).split()[1]
print(f"idle RSS {int(rss) / 1024:.1f} MiB")
second = subprocess.run([f"{BIN}/labwc-launcherd"], env=ENV, capture_output=True, text=True, timeout=5)
check("second daemon refuses to start", second.returncode != 0 and "another launcher daemon" in second.stderr,
      second.stderr.strip())

keyboard = Keyboard()
time.sleep(1.5)

# ---- application list, typing, escape
shows = len(marks("ENTER"))
check("toggle client exits 0", client("toggle").returncode == 0)
check("toggle shows the launcher", wait_mark("ENTER", shows) is not None)
time.sleep(0.2)
shot("launcher-apps")
keyboard.type("vi")
time.sleep(0.2)
shot("launcher-typed-vi")
hides = len(marks("HIDE"))
keyboard.tap("esc")
check("escape hides", wait_mark("HIDE", hides) is not None)

# ---- catalog reload and launching through uwsm
with open(f"{DATA_HOME}/applications/zz-marker.desktop", "w") as entry:
    entry.write("[Desktop Entry]\nType=Application\nName=Zz Marker\nExec=marker-app --flag %U\n")
time.sleep(0.6)
shows = len(marks("ENTER"))
client("toggle")
wait_mark("ENTER", shows)
keyboard.type("marker")
hides = len(marks("HIDE"))
keyboard.tap("enter")
wait_mark("HIDE", hides)
time.sleep(0.3)
launched = open(LAUNCHED).read().split("\n") if os.path.exists(LAUNCHED) else []
check("enter launches through uwsm app with field codes removed",
      launched[:6] == ["app", "-t", "service", "--", "marker-app", "--flag"], repr(launched))

mask = open(f"{LAUNCHED}.mask").read().split() if os.path.exists(f"{LAUNCHED}.mask") else []
check("launched programs start with no blocked signals", mask[1:] == ["0000000000000000"], repr(mask))

# ---- Meta tap
shows, taps = len(marks("ENTER")), len(marks("TAP"))
keyboard.tap("meta")
check("meta tap shows", wait_mark("ENTER", shows) is not None)
hides = len(marks("HIDE"))
time.sleep(0.2)
keyboard.tap("meta")
check("second meta tap hides", wait_mark("HIDE", hides) is not None)
shows = len(marks("SHOW"))
keyboard.emit(KEYS["meta"], 1)
time.sleep(0.5)
keyboard.emit(KEYS["meta"], 0)
time.sleep(0.3)
check("long meta press does not show", len(marks("SHOW")) == shows)

# ---- shortcut guard
keyboard.chord("meta", "f12")
time.sleep(0.3)
check("meta+f12 writes the guard flag", os.path.exists(f"{RUN}/labwc-launcher-shortcuts-suspended"))
shows = len(marks("SHOW"))
keyboard.tap("meta")
time.sleep(0.3)
check("meta tap is inert while suspended", len(marks("SHOW")) == shows)
keyboard.chord("meta", "f12")
time.sleep(0.3)
check("meta+f12 again removes the guard flag", not os.path.exists(f"{RUN}/labwc-launcher-shortcuts-suspended"))

# ---- dmenu select and cancel
shows = len(marks("ENTER"))
picker = subprocess.Popen([f"{BIN}/labwc-launcher", "dmenu", "--prompt", "panel"], env=ENV, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
picker.stdin.write("Audio settings\nLock screen\nLog out\n")
picker.stdin.close()
wait_mark("ENTER", shows)
time.sleep(0.2)
shot("launcher-dmenu")
keyboard.tap("down")
time.sleep(0.05)
keyboard.tap("enter")
out, err = picker.communicate(timeout=5)
check("dmenu prints the chosen line", picker.returncode == 0 and out == "Lock screen\n", repr((picker.returncode, out, err)))

shows = len(marks("ENTER"))
picker = subprocess.Popen([f"{BIN}/labwc-launcher", "dmenu"], env=ENV, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
picker.stdin.write("newest\nolder\n")
picker.stdin.close()
wait_mark("ENTER", shows)
check("close client exits 0", client("close").returncode == 0)
out, err = picker.communicate(timeout=5)
check("closed dmenu exits 1 with no output", picker.returncode == 1 and out == "", repr((picker.returncode, out, err)))

# ---- latency
def measure(label, trigger, warmup=3, runs=20):
    samples = []
    for index in range(warmup + runs):
        enters, hides = len(marks("ENTER")), len(marks("HIDE"))
        t0 = trigger()
        enter = wait_mark("ENTER", enters)
        if enter is None:
            print(f"{label}: no ENTER on run {index}")
            continue
        if index >= warmup:
            samples.append(enter - t0)
        time.sleep(0.15)
        client("close")
        wait_mark("HIDE", hides)
        time.sleep(0.25)
    report(label, samples)


measure("client toggle spawn to keyboard enter", lambda: (time.time() * 1000, client("toggle"))[0])
measure("uinput meta release to keyboard enter", lambda: keyboard.tap("meta"))
client_starts = []
for _ in range(20):
    t0 = time.perf_counter()
    client("close")
    client_starts.append((time.perf_counter() - t0) * 1000)
report("client close round trip including spawn", client_starts)

if len(sys.argv) > 1 and sys.argv[1] == "--scales":
    for scale in ("2", "3"):
        subprocess.run(["wlr-randr", "--output", "HEADLESS-1", "--scale", scale], env=ENV, check=False)
        time.sleep(0.5)
        measure(f"client toggle to enter at scale {scale}", lambda: (time.time() * 1000, client("toggle"))[0])
        if scale == "2":
            client("toggle")
            time.sleep(0.4)
            shot("launcher-scale2")
            client("close")
            time.sleep(0.3)
    subprocess.run(["wlr-randr", "--output", "HEADLESS-1", "--scale", "1"], env=ENV, check=False)

keyboard.close()
daemon.terminate()
daemon.wait(timeout=5)
check("clean stop removes the socket", not os.path.exists(f"{RUN}/labwc-launcher.sock"))
print("errors logged:", [line.strip() for line in open(LOG) if line.startswith("labwc-launcherd:")])
print("FAILURES:", failures)
sys.exit(1 if failures else 0)
