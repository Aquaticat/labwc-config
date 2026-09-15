# Choose the TypeScript runtime for the session helpers and the installer

## Status

Decided by the user on 2026-09-14,
against the ranking in this record:

> QuickJS-ng hot paths + Deno rest.
> Hot paths is defined by:
> from user input to the required surface becoming interactive.
> Hot paths must be under 20ms.

The installer also runs on Deno,
installed into the live ISO session with pacman rather than compiled.

## Decision

- **Hot path**:
  the chain from a user input event to the surface that input requires becoming interactive.
  The budget is under 20 ms for the whole chain,
  including programs this repository does not own,
  such as fuzzel's own startup.
- **QuickJS-ng**:
  every helper on a hot path.
  QuickJS-ng has no socket API,
  so a hot-path helper cannot speak the Wayland protocol itself.
- **Deno**:
  every other helper,
  including the Wayland clients `wlr-pager` and the window watcher in `launch-feedback`,
  and the machine installer.
- The budget is enforced by measurement in a labwc session on the physical desktop.
  The Hyper-V VM runs on a slower laptop CPU and renders in software,
  so its numbers are indicative only:
  a VM pass suggests a physical pass,
  and a VM failure of CPU-bound work is strong but not conclusive evidence of a physical failure.

## Amendment on 2026-09-14

The launcher chains moved to a resident Rust and Slint daemon with a Rust socket client,
by user decision recorded in `doc/planning/hot-path-budget.md`.
QuickJS-ng remains the runtime for any other hot-path helper,
and Deno for the rest.

## Amendment on 2026-09-14: hot-path helpers that speak Wayland

A hot-path helper that must talk to the compositor is written in Rust.
QuickJS-ng has no sockets,
so it cannot open the Wayland connection,
and Deno's 55 ms start alone is more than twice the budget.
The first such helper is `labwc-pager`,
which switches workspaces from sfwbar pager clicks through ext-workspace-v1;
its measurements are in `doc/planning/hot-path-budget.md`.
Helpers that only run programs,
such as the panel menu,
stay on QuickJS-ng.

## Logging on QuickJS-ng

`@monochromatic-dev/module-logger` 0.4.0 does not run on QuickJS-ng 0.16.2.
Bundled into a helper,
its flush timed out because no sink verified,
its error report then failed because `console.warn` and `console.error` are undefined there,
and it added about 2.3 ms to every helper start in the VM
(3.5 ms against 1.2 ms for a helper without it).
The QuickJS-ng helpers therefore use `helpers/src/qjs-log.ts`,
which keeps the `tagged({ tag, l, })` shape and the module-logger line format and writes to standard error.
QuickJS-ng 0.16.2 also has no `TextEncoder` or `TextDecoder`,
so `helpers/src/utf8.ts` implements the WHATWG UTF-8 codec,
tested against Deno's built-in one.

## Consequences

- Which helpers sit on hot paths follows from the definition and is recorded in
  `doc/planning/hot-path-budget.md` together with how each chain is measured.
- QuickJS-ng sources use `qjs:os` and `qjs:std`,
  so they are an exception to the cross-runtime rule.
  They are written in TypeScript and transpiled at package build time.
- The recommendation ranked Bun first;
  the user chose QuickJS-ng plus Deno instead.
  The measurements and options are kept for the record.

## Original evaluation

Measured on 2026-09-14.

## Workloads

- `fuzzel-toggle`:
  runs on every Meta tap and every launcher-icon click;
  cold start dominates.
- `meta-tap-launcher`:
  a daemon reading evdev `struct input_event` records and spawning the launcher;
  idle memory and child reaping matter.
- `wlr-pager`:
  a Wayland protocol client over a Unix socket feeding sfwbar's pager.
- `launch-feedback`:
  renders an animated XCursor from an application icon,
  watches for the application's first window over the Wayland socket,
  and signals labwc.
- `launch-new`,
  `panel-menu`,
  `toggle-shortcut-guard`:
  short-lived process launchers.
- The machine installer:
  runs from the CachyOS live ISO,
  which ships no JavaScript runtime.

## Measurements

The Hyper-V CachyOS VM ran with 12 vCPUs on a Ryzen 7 PRO 7840U,
on AC power with Host Resource Protection on.
Runtimes were the CachyOS packages nodejs 26.8.2-1,
bun 1.4.0-1,
deno 2.9.6-1.1,
and quickjs-ng 0.16.2-1.1,
extracted into `/tmp` without installation.

### Cold start of the toggle workload

The probe lists `/proc` and reads every `/proc/<pid>/stat` looking for a live fuzzel.
Each case ran 5 warm-up and 40 measured iterations,
twice;
medians of the two rounds differed by at most 4 ms.

- QuickJS-ng,
  JavaScript using `qjs:os` and `qjs:std`:
  median 5.0 to 5.3 ms.
- Bun running the TypeScript source:
  median 24.3 to 26.1 ms.
- Bun `--compile` binary:
  median 21.9 to 24.7 ms;
  65 MB file.
- Node running bundled JavaScript:
  median 47.3 to 49.2 ms.
- Deno running the TypeScript source with `--allow-all`:
  median 56.8 ms.
- Deno `compile` binary:
  median 53.9 ms;
  104 MB file.
- Node running the TypeScript source through type stripping:
  median 86.8 to 90.7 ms.

Deno refused to read `/proc` with only `--allow-read` and required `--allow-all`.

### Idle resident memory

A process holding a pending timer,
sampled after 2 seconds:

- QuickJS-ng:
  3.8 MiB.
- Bun:
  30.7 MiB.
- Deno:
  58.7 MiB.
- Node:
  59.1 MiB.

### Evdev tap detection

One TypeScript source using `node:fs` `createReadStream` ran unchanged on Node,
Bun,
and Deno;
QuickJS-ng needed a separate source using `setReadHandler`.
All four read the VM keyboard at `/dev/input/event0` as root.
Keys were injected through Hyper-V's `Msvm_Keyboard`:
a bare Meta tap,
a Meta+E chord,
and another bare Meta tap.
Every runtime reported exactly the two bare taps and ignored the chord.

### Child reaping

A process spawned five detached `true` children with `stdio: 'ignore'` and `unref()`,
then counted its own zombie children after 1.5 seconds.
Node,
Bun,
and Deno each reported 0.
A positive control,
`sh -c 'true & exec sleep 3'`,
reported 1 zombie under that shell with the same `/proc` parsing.

## Capability findings

From upstream documentation and source,
gathered by a research subagent on 2026-09-14:

- QuickJS-ng's `qjs:os` has no socket API,
  so it cannot run `wlr-pager` or the Wayland window watcher in `launch-feedback`
  (`docs/docs/stdlib.md` at v0.16.2).
  It has no npm compatibility and no TypeScript support.
- Node runs async `fs` reads of character devices on the libuv threadpool,
  which defaults to 4 threads;
  each open evdev stream holds one thread in a blocking `read`.
- `bun build --compile` copies the running `bun`;
  CachyOS's `bun` links system ICU,
  so a portable installer binary must name the official `bun-linux-x64` build through `compile.executablePath`.
- `deno compile` downloads `denort` from dl.deno.land,
  so a PKGBUILD `build()` would need network access or a pre-fetched `DENORT_BIN`.
- resvg-js runs on Node,
  Bun,
  and Deno.
  CachyOS also packages the `resvg` CLI and `xorg-xcursorgen`,
  which render SVG frames and pack an XCursor from any runtime without npm modules.
- `/sys/class/input/eventN/device/name` gives device names without an `EVIOCGNAME` ioctl,
  so no FFI is needed for keyboard selection.

## Options

### Bun for everything

- Pros:
  one runtime and one API surface;
  helpers written against `node:` APIs stay runnable on Node and Deno,
  which satisfies the cross-runtime rule;
  npm modules such as `@monochromatic-dev/module-logger` remain usable;
  second-fastest start and second-smallest idle memory measured;
  a compiled installer binary works from the live ISO.
- Cons:
  about 19 ms slower to start than QuickJS-ng on the toggle,
  and about 27 MiB more idle memory for the watcher;
  `#!/usr/bin/env bun` shebangs make these helpers a documented Bun island under `AP4`.

### QuickJS-ng for the hot paths, Bun for the rest

- Pros:
  the fastest toggle and the smallest watcher measured.
- Cons:
  two runtimes and two API surfaces;
  the QuickJS helpers cannot use npm modules or the shared logger,
  need a separate transpile step,
  and do not follow the cross-runtime rule.

### Node for everything

- Pros:
  the reference runtime for every npm module and for the repository's tooling.
- Cons:
  roughly twice Bun's start time with bundled JavaScript and more than three times it with type stripping;
  twice Bun's idle memory;
  the evdev threadpool limit;
  a single-executable installer needs a 150 MB official binary.

### Deno for everything

- Pros:
  permissions compiled into binaries.
- Cons:
  start time and memory close to Node's;
  `/proc` access needs `--allow-all`,
  which removes the permission benefit;
  compiling inside a PKGBUILD needs network access.

## Ranking

Bun for everything > QuickJS-ng plus Bun > Node > Deno.

- Bun over the split:
  one portable API surface with npm access outweighs the measured 19 ms and 27 MiB,
  and the split still needs Bun for the Wayland clients.
- The split over Node:
  the split keeps Bun's advantages for the socket clients and adds the fastest hot paths,
  while Node offers no measured advantage over Bun on these workloads.
- Node over Deno:
  similar measured cost,
  but Deno's `/proc` permission requirement and network-bound compile add friction without a benefit here.
