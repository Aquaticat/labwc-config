# PROTOTYPE: resident Slint launcher latency spike

Throwaway code.
Nothing on this branch is production code or merges to `main`.

## Question

Can a resident Slint process show a wlr-layer-shell launcher surface and receive keyboard focus
within the 20 ms hot-path budget,
where fuzzel,
tofi,
and walker were measured at 12 to 30 ms?

## Verdict

Yes in the Hyper-V CachyOS VM,
by a wide margin:

- warm show,
  SIGUSR1 to `wl_keyboard.enter`:
  median 2.4 ms,
  p90 3.1 ms,
  maximum 3.5 ms over 20 runs;
- first show after start:
  4.0 ms;
- process start to ready:
  12.4 ms;
- idle resident memory:
  9.1 MiB.

A positive control that sleeps 10 ms inside the show path moved the median to 13.1 ms.
A `grim` screenshot taken while the surface was shown contained the rendered text list,
anchored bottom-left,
gray-white on black.

The decision this settles is recorded on `main` in `doc/planning/hot-path-budget.md`.

## What the spike does

- Slint 1.17.1 with only the software renderer and a custom `Platform` over `MinimalSoftwareWindow`.
- smithay-client-toolkit 0.21.1 creates a layer surface on each show and destroys it on hide.
- Each configure renders the Slint window into a premultiplied RGBA buffer and copies it into a `wl_shm` ARGB8888 buffer.
- calloop dispatches Wayland events and SIGUSR1.
  The signal must be blocked before any thread starts;
  the source is therefore created first in `main`.

## Harness files

`spike-bench.ts` measured this spike.
The other TypeScript and JavaScript files are the runtime,
evdev,
child-reaping,
fuzzel,
tofi,
and walker harnesses cited in `doc/decision/typescript-runtime.md` and `doc/planning/hot-path-budget.md`.
They ran under Deno 2.9.6 as root against a headless labwc 0.20.2 session:
`WLR_BACKENDS=headless,libinput WLR_RENDERER=pixman LIBSEAT_BACKEND=noop`.

Harness gotcha:
Deno's Node-compatible `ChildProcess.kill` delivered only the first SIGUSR1 in `spike-bench.ts`;
`process.kill(pid, 'SIGUSR1')` delivered every signal.
