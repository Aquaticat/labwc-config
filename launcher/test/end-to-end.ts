/**
 End-to-end check of `labwc-launcherd` and `labwc-launcher` in a running labwc session.

 Drives a `/dev/uinput` keyboard and absolute pointer through libc,
 puts a stand-in `uwsm` first on `PATH` that records its arguments and starts real programs,
 and reads the daemon's `LABWC_LAUNCHER_TRACE` marks.
 Run as root inside a disposable session, such as the headless labwc in the Hyper-V VM:

 ```sh
 deno run --allow-all launcher/test/end-to-end.ts --binaries target/release --runtime-dir /tmp/hp-run
 ```

 Exits with status 1 when any check fails.

 @module
 */

import { logger, tagged, } from '@monochromatic-dev/module-logger';

const l = tagged({ tag: 'launcher-end-to-end', },);

/** Thrown when the test cannot run at all, as opposed to a failed check. */
class EndToEndSetupError extends Error {
  /**
   @param message - what could not be set up
   */
  constructor(message: string,) {
    super(message,);
    this.name = EndToEndSetupError.name;
  }
}

/** Reads `--name value` from the command line. */
function option({ name, fallback, }: { readonly name: string; readonly fallback: string; },): string {
  const index = Deno.args.indexOf(`--${name}`,);
  return index >= 0 ? Deno.args[index + 1] ?? fallback : fallback;
}

const BINARIES = option({ name: 'binaries', fallback: '/tmp/launcher/target/release', },);
const RUNTIME_DIR = option({ name: 'runtime-dir', fallback: '/tmp/hp-run', },);
const TRACE_LOG = `${RUNTIME_DIR}/launcherd.log`;
const FAKE_BIN = `${RUNTIME_DIR}/fakebin`;
const LAUNCHED = `${RUNTIME_DIR}/launched-args`;
const DATA_HOME = `${RUNTIME_DIR}/data`;
const GUARD_FLAG = `${RUNTIME_DIR}/labwc-launcher-shortcuts-suspended`;
const SOCKET = `${RUNTIME_DIR}/labwc-launcher.sock`;
const ENVIRONMENT: Record<string, string> = {
  ...Deno.env.toObject(),
  XDG_RUNTIME_DIR: RUNTIME_DIR,
  WAYLAND_DISPLAY: 'wayland-0',
  XDG_CURRENT_DESKTOP: 'labwc:wlroots',
  XDG_DATA_HOME: DATA_HOME,
  LABWC_LAUNCHER_TRACE: '1',
  PATH: `${FAKE_BIN}:${Deno.env.get('PATH',) ?? '/usr/bin'}`,
};
/** Launcher geometry from `launcher/daemon/src/daemon.rs`, in logical pixels. */
const LAUNCHER = { width: 480, height: 364, firstRowTop: 48, rowHeight: 28, } as const;

const failures: string[] = [];

/** Records one check result. */
function check({ name, ok, detail = '', }: { readonly name: string; readonly ok: boolean; readonly detail?: string; },): void {
  if (ok) {
    l.info(`PASS ${name} ${detail}`,);
    return;
  }
  l.error(`FAIL ${name} ${detail}`,);
  failures.push(name,);
}

/** Resolves after `milliseconds`. */
function sleep({ milliseconds, }: { readonly milliseconds: number; },): Promise<void> {
  return new Promise((resolve,) => setTimeout(resolve, milliseconds,));
}

/** Every epoch-millisecond value the daemon traced for `mark`. */
function marks({ mark, }: { readonly mark: string; },): number[] {
  return Deno.readTextFileSync(TRACE_LOG,)
    .split('\n',)
    .filter((line,) => line.startsWith(`${mark} `,))
    .map((line,) => Number(line.slice(mark.length + 1,),));
}

/** Waits for trace mark number `index` (zero-based) and returns its time, or `undefined` after `timeout`. */
async function waitForMark(
  { mark, index, timeout = 3000, }: { readonly mark: string; readonly index: number; readonly timeout?: number; },
): Promise<number | undefined> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = marks({ mark, },);
    if (found.length > index) {
      return found[index];
    }
    await sleep({ milliseconds: 2, },);
  }
  return undefined;
}

/** Runs the client to completion. */
async function client(
  { args, stdin, }: { readonly args: readonly string[]; readonly stdin?: string; },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string; }> {
  const child = new Deno.Command(`${BINARIES}/labwc-launcher`, {
    args: [...args,],
    env: ENVIRONMENT,
    stdin: stdin === undefined ? 'null' : 'piped',
    stdout: 'piped',
    stderr: 'piped',
  },).spawn();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin,),);
    await writer.close();
  }
  const output = await child.output();
  const decoder = new TextDecoder();
  return { code: output.code, stdout: decoder.decode(output.stdout,), stderr: decoder.decode(output.stderr,), };
}

/** Runs a program in the session and waits for it. */
async function runInSession({ program, args, }: { readonly program: string; readonly args: readonly string[]; },): Promise<number> {
  const output = await new Deno.Command(program, { args: [...args,], env: ENVIRONMENT, stdout: 'null', stderr: 'null', },)
    .output();
  return output.code;
}

/** Arguments the stand-in `uwsm` received most recently, or an empty list. */
function launchedArguments(): string[] {
  try {
    return Deno.readTextFileSync(LAUNCHED,).split('\n',).filter((line,) => line !== '',);
  } catch {
    return [];
  }
}

// ---- libc through FFI, for uinput

const libc = Deno.dlopen('libc.so.6', {
  open: { parameters: ['buffer', 'i32',], result: 'i32', },
  write: { parameters: ['i32', 'buffer', 'usize',], result: 'isize', },
  close: { parameters: ['i32',], result: 'i32', },
  ioctl: { parameters: ['i32', 'u64', 'u64',], result: 'i32', },
},);

const O_WRONLY = 1;
const O_NONBLOCK = 0o4000;
const UI_SET_EVBIT = 0x40045564n;
const UI_SET_KEYBIT = 0x40045565n;
const UI_SET_RELBIT = 0x40045566n;
const UI_SET_ABSBIT = 0x40045567n;
const UI_DEV_CREATE = 0x5501n;
const UI_DEV_DESTROY = 0x5502n;
const EV_SYN = 0;
const EV_KEY = 1;
const EV_REL = 2;
const EV_ABS = 3;
const REL_WHEEL = 8;
const ABS_X = 0;
const ABS_Y = 1;
const BTN_LEFT = 0x110;
const ABSOLUTE_MAXIMUM = 32767;
const KEYS: Readonly<Record<string, number>> = {
  meta: 125, f12: 88, esc: 1, enter: 28, backspace: 14, down: 108, space: 57,
  a: 30, c: 46, e: 18, i: 23, k: 37, l: 38, m: 50, o: 24, r: 19, s: 31, t: 20, v: 47, z: 44,
  '0': 11, '2': 3,
};

/** Calls ioctl and throws on failure. */
function ioctl({ fd, request, value, }: { readonly fd: number; readonly request: bigint; readonly value: number; },): void {
  if (libc.symbols.ioctl(fd, request, BigInt(value,),) < 0) {
    throw new EndToEndSetupError(`ioctl 0x${request.toString(16,)} failed`,);
  }
}

/** A virtual input device created through `/dev/uinput`. */
class UinputDevice {
  /**
   @param fd - open `/dev/uinput` descriptor for this device
   */
  private constructor(private readonly fd: number,) {}

  /** Creates a device with the given capabilities; `absolute` adds a pointer spanning the output layout. */
  static create(
    { name, keys, absolute, }: { readonly name: string; readonly keys: readonly number[]; readonly absolute: boolean; },
  ): UinputDevice {
    const fd = libc.symbols.open(new TextEncoder().encode('/dev/uinput\0',), O_WRONLY | O_NONBLOCK,);
    if (fd < 0) {
      throw new EndToEndSetupError('cannot open /dev/uinput; run as root',);
    }
    ioctl({ fd, request: UI_SET_EVBIT, value: EV_KEY, },);
    keys.forEach((code,) => ioctl({ fd, request: UI_SET_KEYBIT, value: code, },));
    const setup = new Uint8Array(1116,);
    setup.set(new TextEncoder().encode(name,).slice(0, 79,),);
    const view = new DataView(setup.buffer,);
    view.setUint16(80, 3, true,);
    view.setUint16(82, 1, true,);
    view.setUint16(84, absolute ? 2 : 1, true,);
    if (absolute) {
      ioctl({ fd, request: UI_SET_EVBIT, value: EV_ABS, },);
      ioctl({ fd, request: UI_SET_EVBIT, value: EV_REL, },);
      ioctl({ fd, request: UI_SET_ABSBIT, value: ABS_X, },);
      ioctl({ fd, request: UI_SET_ABSBIT, value: ABS_Y, },);
      ioctl({ fd, request: UI_SET_RELBIT, value: REL_WHEEL, },);
      // absmax[ABS_X] and absmax[ABS_Y] start at byte 92.
      view.setInt32(92 + ABS_X * 4, ABSOLUTE_MAXIMUM, true,);
      view.setInt32(92 + ABS_Y * 4, ABSOLUTE_MAXIMUM, true,);
    }
    libc.symbols.write(fd, setup, BigInt(setup.length,),);
    ioctl({ fd, request: UI_DEV_CREATE, value: 0, },);
    return new UinputDevice(fd,);
  }

  /** Writes one event followed by a sync report and returns the epoch milliseconds of the write. */
  emit({ type, code, value, }: { readonly type: number; readonly code: number; readonly value: number; },): number {
    const now = Date.now();
    const record = new Uint8Array(48,);
    const view = new DataView(record.buffer,);
    view.setBigInt64(0, BigInt(Math.floor(now / 1000,),), true,);
    view.setBigInt64(8, BigInt((now % 1000) * 1000,), true,);
    view.setUint16(16, type, true,);
    view.setUint16(18, code, true,);
    view.setInt32(20, value, true,);
    view.setBigInt64(24, BigInt(Math.floor(now / 1000,),), true,);
    view.setBigInt64(32, BigInt((now % 1000) * 1000,), true,);
    view.setUint16(40, EV_SYN, true,);
    libc.symbols.write(this.fd, record, 48n,);
    return now;
  }

  /** Removes the device. */
  destroy(): void {
    ioctl({ fd: this.fd, request: UI_DEV_DESTROY, value: 0, },);
    libc.symbols.close(this.fd,);
  }
}

/** Presses and releases `key`, returning the release time. */
async function tap(
  { device, key, hold = 30, }: { readonly device: UinputDevice; readonly key: string; readonly hold?: number; },
): Promise<number> {
  device.emit({ type: EV_KEY, code: KEYS[key] ?? 0, value: 1, },);
  await sleep({ milliseconds: hold, },);
  return device.emit({ type: EV_KEY, code: KEYS[key] ?? 0, value: 0, },);
}

/** Types `text` one key at a time; spaces use the space key. */
async function typeText({ device, text, }: { readonly device: UinputDevice; readonly text: string; },): Promise<void> {
  for (const character of text) {
    await tap({ device, key: character === ' ' ? 'space' : character, hold: 10, },);
    await sleep({ milliseconds: 20, },);
  }
}

/** Holds `modifier` while tapping `key`. */
async function chord(
  { device, modifier, key, }: { readonly device: UinputDevice; readonly modifier: string; readonly key: string; },
): Promise<void> {
  device.emit({ type: EV_KEY, code: KEYS[modifier] ?? 0, value: 1, },);
  await sleep({ milliseconds: 30, },);
  await tap({ device, key, },);
  await sleep({ milliseconds: 30, },);
  device.emit({ type: EV_KEY, code: KEYS[modifier] ?? 0, value: 0, },);
}

/** Output size in logical pixels, from `wlr-randr --json`. */
async function outputSize(): Promise<{ readonly width: number; readonly height: number; }> {
  const output = await new Deno.Command('wlr-randr', { args: ['--json',], env: ENVIRONMENT, stdout: 'piped', },).output();
  const outputs: { modes: { width: number; height: number; current: boolean; }[]; scale: number; }[] = JSON.parse(
    new TextDecoder().decode(output.stdout,),
  );
  const first = outputs[0];
  const mode = first?.modes.find((candidate,) => candidate.current);
  if (first === undefined || mode === undefined) {
    throw new EndToEndSetupError('wlr-randr reported no current output mode',);
  }
  return { width: mode.width / first.scale, height: mode.height / first.scale, };
}

/** Moves the absolute pointer to logical `x`, `y` on the single output. */
function movePointer(
  { pointer, x, y, size, }: {
    readonly pointer: UinputDevice;
    readonly x: number;
    readonly y: number;
    readonly size: { readonly width: number; readonly height: number; };
  },
): void {
  pointer.emit({ type: EV_ABS, code: ABS_X, value: Math.round((x / size.width) * ABSOLUTE_MAXIMUM,), },);
  pointer.emit({ type: EV_ABS, code: ABS_Y, value: Math.round((y / size.height) * ABSOLUTE_MAXIMUM,), },);
}

/** Clicks visible launcher row `row`, counted from the top. */
async function clickRow(
  { pointer, row, size, }: {
    readonly pointer: UinputDevice;
    readonly row: number;
    readonly size: { readonly width: number; readonly height: number; };
  },
): Promise<void> {
  const top = size.height - LAUNCHER.height;
  movePointer({ pointer, x: 120, y: top + LAUNCHER.firstRowTop + LAUNCHER.rowHeight * row + LAUNCHER.rowHeight / 2, size, },);
  await sleep({ milliseconds: 50, },);
  pointer.emit({ type: EV_KEY, code: BTN_LEFT, value: 1, },);
  await sleep({ milliseconds: 30, },);
  pointer.emit({ type: EV_KEY, code: BTN_LEFT, value: 0, },);
}

/** Summarizes latency samples. */
function report({ name, samples, }: { readonly name: string; readonly samples: readonly number[]; },): void {
  const sorted = [...samples,].sort((a, b,) => a - b);
  const at = (fraction: number,): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction,),)] ?? NaN;
  l.info(
    `${name}: median ${at(0.5,).toFixed(1,)} ms, p90 ${at(0.9,).toFixed(1,)} ms, min ${(sorted[0] ?? NaN).toFixed(1,)} ms, max ${
      (sorted.at(-1,) ?? NaN).toFixed(1,)
    } ms, n=${sorted.length}`,
  );
}

/** Writes the stand-in `uwsm` and the test desktop entries. */
function writeFixtures(): void {
  Deno.mkdirSync(FAKE_BIN, { recursive: true, },);
  Deno.writeTextFileSync(
    `${FAKE_BIN}/uwsm`,
    [
      '#!/bin/sh',
      `grep SigBlk /proc/self/status > ${LAUNCHED}.mask`,
      `printf '%s\\n' "$@" > ${LAUNCHED}`,
      '# Start real programs after "--" so windows appear; desktop file IDs are only recorded.',
      'while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done',
      '[ "$1" = "--" ] && shift',
      'if [ "$#" -gt 0 ] && [ "${1%.desktop}" = "$1" ] && command -v "$1" >/dev/null 2>&1; then',
      '  setsid "$@" >/dev/null 2>&1 &',
      'fi',
      '',
    ].join('\n',),
  );
  Deno.chmodSync(`${FAKE_BIN}/uwsm`, 0o755,);
  Deno.mkdirSync(`${DATA_HOME}/applications`, { recursive: true, },);
  for (let number = 0; number < 20; number++) {
    const padded = String(number,).padStart(2, '0',);
    Deno.writeTextFileSync(
      `${DATA_HOME}/applications/scroll-test-${padded}.desktop`,
      `[Desktop Entry]\nType=Application\nName=Scroll Test ${padded}\nExec=true\n`,
    );
  }
  for (const stale of [LAUNCHED, `${DATA_HOME}/applications/zz-marker.desktop`, GUARD_FLAG,]) {
    try {
      Deno.removeSync(stale,);
    } catch {
      // Already absent.
    }
  }
}

/** Measures `trigger` to trace `mark` over warm-up and measured runs, closing between runs. */
async function measure(
  { name, mark, trigger, runs = 20, warmup = 3, }: {
    readonly name: string;
    readonly mark: string;
    readonly trigger: () => Promise<number>;
    readonly runs?: number;
    readonly warmup?: number;
  },
): Promise<void> {
  const samples: number[] = [];
  for (let run = 0; run < warmup + runs; run++) {
    const before = marks({ mark, },).length;
    const started = await trigger();
    const reached = await waitForMark({ mark, index: before, },);
    if (reached === undefined) {
      l.warn(`${name}: no ${mark} on run ${run}`,);
      continue;
    }
    if (run >= warmup) {
      samples.push(reached - started,);
    }
    await sleep({ milliseconds: 150, },);
    await client({ args: ['close',], },);
    await sleep({ milliseconds: 250, },);
  }
  report({ name, samples, },);
}

/** Runs every check. */
async function main(): Promise<void> {
  writeFixtures();
  await runInSession({ program: 'pkill', args: ['-x', 'labwc-launcherd',], },);
  await runInSession({ program: 'pkill', args: ['-x', 'foot',], },);
  await sleep({ milliseconds: 300, },);

  Deno.writeTextFileSync(TRACE_LOG, '',);
  const spawnedAt = Date.now();
  // The shell redirects stderr straight into the file, so marks are readable as soon as the daemon writes them.
  const daemon = new Deno.Command('sh', {
    args: ['-c', `exec '${BINARIES}/labwc-launcherd' 2>> '${TRACE_LOG}'`,],
    env: ENVIRONMENT,
    stdout: 'null',
  },).spawn();
  const ready = await waitForMark({ mark: 'READY', index: 0, },);
  check({ name: 'daemon ready', ok: ready !== undefined, detail: `${((ready ?? 0) - spawnedAt).toFixed(1,)} ms after spawn`, },);
  const rss = Deno.readTextFileSync(`/proc/${daemon.pid}/status`,).match(/VmRSS:\s+(\d+)/,)?.[1];
  l.info(`idle RSS ${(Number(rss,) / 1024).toFixed(1,)} MiB`,);
  const second = await new Deno.Command(`${BINARIES}/labwc-launcherd`, { env: ENVIRONMENT, stderr: 'piped', },).output();
  const secondError = new TextDecoder().decode(second.stderr,);
  check({
    name: 'second daemon refuses to start',
    ok: second.code !== 0 && secondError.includes('another launcher daemon',),
    detail: secondError.trim(),
  },);

  const keyboard = UinputDevice.create({ name: 'launcher-e2e-keyboard', keys: Object.values(KEYS,), absolute: false, },);
  const pointer = UinputDevice.create({ name: 'launcher-e2e-pointer', keys: [BTN_LEFT,], absolute: true, },);
  const size = await outputSize();
  await sleep({ milliseconds: 1500, },);

  // Application list, typing, and Escape.
  let enters = marks({ mark: 'ENTER', },).length;
  check({ name: 'toggle client exits 0', ok: (await client({ args: ['toggle',], },)).code === 0, },);
  check({ name: 'toggle shows the launcher', ok: (await waitForMark({ mark: 'ENTER', index: enters, },)) !== undefined, },);
  await typeText({ device: keyboard, text: 'vi', },);
  await sleep({ milliseconds: 200, },);
  await runInSession({ program: 'grim', args: [`${RUNTIME_DIR}/launcher-typed-vi.png`,], },);
  let hides = marks({ mark: 'HIDE', },).length;
  await tap({ device: keyboard, key: 'esc', },);
  check({ name: 'escape hides', ok: (await waitForMark({ mark: 'HIDE', index: hides, },)) !== undefined, },);

  // Catalog reload, desktop file ID launching, feedback timeout.
  Deno.writeTextFileSync(
    `${DATA_HOME}/applications/zz-marker.desktop`,
    '[Desktop Entry]\nType=Application\nName=Zz Marker\nExec=marker-app --flag %U\nStartupWMClass=MarkerApp\n',
  );
  await sleep({ milliseconds: 600, },);
  enters = marks({ mark: 'ENTER', },).length;
  await client({ args: ['toggle',], },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  await typeText({ device: keyboard, text: 'marker', },);
  const feedbacks = marks({ mark: 'FEEDBACK', },).length;
  const feedbackEnds = marks({ mark: 'FEEDBACK_END', },).length;
  await tap({ device: keyboard, key: 'enter', },);
  const feedbackShown = await waitForMark({ mark: 'FEEDBACK', index: feedbacks, },);
  check({ name: 'enter shows launch feedback', ok: feedbackShown !== undefined, },);
  await sleep({ milliseconds: 300, },);
  await runInSession({ program: 'grim', args: [`${RUNTIME_DIR}/launcher-feedback.png`,], },);
  check({
    name: 'enter launches the desktop file ID through uwsm app',
    ok: launchedArguments().join(' ',) === 'app -t service -- zz-marker.desktop',
    detail: JSON.stringify(launchedArguments(),),
  },);
  const mask = Deno.readTextFileSync(`${LAUNCHED}.mask`,).trim().split(/\s+/,);
  check({ name: 'launched programs start with no blocked signals', ok: mask[1] === '0000000000000000', detail: mask.join(' ',), },);
  const feedbackEnded = await waitForMark({ mark: 'FEEDBACK_END', index: feedbackEnds, timeout: 7000, },);
  const timeoutSpan = (feedbackEnded ?? 0) - (feedbackShown ?? 0);
  check({
    name: 'feedback without a window ends after the 5 s timeout',
    ok: feedbackEnded !== undefined && timeoutSpan >= 4800 && timeoutSpan <= 5400,
    detail: `${timeoutSpan.toFixed(0,)} ms`,
  },);

  // Taskbar "New instance" by app ID.
  await client({ args: ['launch', 'MarkerApp',], },);
  await sleep({ milliseconds: 300, },);
  check({
    name: 'launch finds the entry by StartupWMClass',
    ok: launchedArguments().at(-1,) === 'zz-marker.desktop',
    detail: JSON.stringify(launchedArguments(),),
  },);
  await client({ args: ['launch', 'true',], },);
  await sleep({ milliseconds: 300, },);
  check({
    name: 'launch falls back to a command named like the app ID',
    ok: launchedArguments().join(' ',) === 'app -t service -- true',
    detail: JSON.stringify(launchedArguments(),),
  },);
  await client({ args: ['close',], },);

  // A window from the launched program ends feedback early.
  const windows = marks({ mark: 'WINDOW', },).length;
  const runFeedbacks = marks({ mark: 'FEEDBACK', },).length;
  const runEnds = marks({ mark: 'FEEDBACK_END', },).length;
  await client({ args: ['run', '--', 'foot',], },);
  const runShown = await waitForMark({ mark: 'FEEDBACK', index: runFeedbacks, },);
  const windowSeen = await waitForMark({ mark: 'WINDOW', index: windows, timeout: 5000, },);
  const runEnded = await waitForMark({ mark: 'FEEDBACK_END', index: runEnds, timeout: 7000, },);
  const earlySpan = (runEnded ?? 0) - (runShown ?? 0);
  check({ name: 'a new window is noticed', ok: windowSeen !== undefined, },);
  check({
    name: 'feedback ends after the window, no sooner than 800 ms',
    ok: runEnded !== undefined && earlySpan >= 780 && earlySpan < 4800,
    detail: `${earlySpan.toFixed(0,)} ms`,
  },);
  await runInSession({ program: 'pkill', args: ['-x', 'foot',], },);
  await sleep({ milliseconds: 500, },);

  // Focus moving to a new window hides the launcher.
  enters = marks({ mark: 'ENTER', },).length;
  await client({ args: ['toggle',], },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  hides = marks({ mark: 'HIDE', },).length;
  const foot = new Deno.Command('foot', { env: ENVIRONMENT, stdout: 'null', stderr: 'null', },).spawn();
  check({
    name: 'focus moving to another window hides the launcher',
    ok: (await waitForMark({ mark: 'HIDE', index: hides, timeout: 5000, },)) !== undefined,
  },);
  foot.kill();
  await foot.status;
  await sleep({ milliseconds: 500, },);

  // Pointer: click a row, and scroll then click.
  enters = marks({ mark: 'ENTER', },).length;
  await client({ args: ['toggle',], },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  await typeText({ device: keyboard, text: 'scroll test 0', },);
  await sleep({ milliseconds: 100, },);
  await clickRow({ pointer, row: 2, size, },);
  await sleep({ milliseconds: 400, },);
  check({
    name: 'clicking a row launches it',
    ok: launchedArguments().at(-1,) === 'scroll-test-02.desktop',
    detail: JSON.stringify(launchedArguments(),),
  },);
  enters = marks({ mark: 'ENTER', },).length;
  await client({ args: ['toggle',], },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  await typeText({ device: keyboard, text: 'scroll test', },);
  movePointer({ pointer, x: 120, y: size.height - LAUNCHER.height / 2, size, },);
  await sleep({ milliseconds: 50, },);
  for (let notch = 0; notch < 3; notch++) {
    pointer.emit({ type: EV_REL, code: REL_WHEEL, value: -1, },);
    await sleep({ milliseconds: 30, },);
  }
  await sleep({ milliseconds: 100, },);
  await runInSession({ program: 'grim', args: [`${RUNTIME_DIR}/launcher-scrolled.png`,], },);
  await clickRow({ pointer, row: 0, size, },);
  await sleep({ milliseconds: 400, },);
  check({
    name: 'wheel scrolling moves the list three rows',
    ok: launchedArguments().at(-1,) === 'scroll-test-03.desktop',
    detail: JSON.stringify(launchedArguments(),),
  },);
  await client({ args: ['close',], },);
  await sleep({ milliseconds: 5500, },);

  // Meta tap and the shortcut guard.
  enters = marks({ mark: 'ENTER', },).length;
  await tap({ device: keyboard, key: 'meta', },);
  check({ name: 'meta tap shows', ok: (await waitForMark({ mark: 'ENTER', index: enters, },)) !== undefined, },);
  hides = marks({ mark: 'HIDE', },).length;
  await sleep({ milliseconds: 200, },);
  await tap({ device: keyboard, key: 'meta', },);
  check({ name: 'second meta tap hides', ok: (await waitForMark({ mark: 'HIDE', index: hides, },)) !== undefined, },);
  let shows = marks({ mark: 'SHOW', },).length;
  await tap({ device: keyboard, key: 'meta', hold: 500, },);
  await sleep({ milliseconds: 300, },);
  check({ name: 'long meta press does not show', ok: marks({ mark: 'SHOW', },).length === shows, },);
  await chord({ device: keyboard, modifier: 'meta', key: 'f12', },);
  await sleep({ milliseconds: 300, },);
  check({ name: 'meta+f12 writes the guard flag', ok: (await Deno.lstat(GUARD_FLAG,).catch(() => undefined)) !== undefined, },);
  shows = marks({ mark: 'SHOW', },).length;
  await tap({ device: keyboard, key: 'meta', },);
  await sleep({ milliseconds: 300, },);
  check({ name: 'meta tap is inert while suspended', ok: marks({ mark: 'SHOW', },).length === shows, },);
  await chord({ device: keyboard, modifier: 'meta', key: 'f12', },);
  await sleep({ milliseconds: 300, },);
  check({ name: 'meta+f12 again removes the guard flag', ok: (await Deno.lstat(GUARD_FLAG,).catch(() => undefined)) === undefined, },);

  // dmenu selection with the short prompt flag, and cancellation.
  enters = marks({ mark: 'ENTER', },).length;
  const picked = client({ args: ['dmenu', '-p', 'panel',], stdin: 'Audio settings\nLock screen\nLog out\n', },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  await sleep({ milliseconds: 200, },);
  await runInSession({ program: 'grim', args: [`${RUNTIME_DIR}/launcher-dmenu.png`,], },);
  await tap({ device: keyboard, key: 'down', },);
  await sleep({ milliseconds: 50, },);
  await tap({ device: keyboard, key: 'enter', },);
  const pickedResult = await picked;
  check({
    name: 'dmenu prints the chosen line',
    ok: pickedResult.code === 0 && pickedResult.stdout === 'Lock screen\n',
    detail: JSON.stringify(pickedResult,),
  },);
  enters = marks({ mark: 'ENTER', },).length;
  const cancelled = client({ args: ['dmenu',], stdin: 'newest\nolder\n', },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  check({ name: 'close client exits 0', ok: (await client({ args: ['close',], },)).code === 0, },);
  const cancelledResult = await cancelled;
  check({
    name: 'closed dmenu exits 1 with no output',
    ok: cancelledResult.code === 1 && cancelledResult.stdout === '',
    detail: JSON.stringify(cancelledResult,),
  },);

  // Latency.
  await measure({
    name: 'client toggle spawn to keyboard enter',
    mark: 'ENTER',
    trigger: async () => {
      const started = Date.now();
      await client({ args: ['toggle',], },);
      return started;
    },
  },);
  await measure({ name: 'uinput meta release to keyboard enter', mark: 'ENTER', trigger: () => tap({ device: keyboard, key: 'meta', },), },);
  await measure({
    name: 'client run spawn to feedback committed',
    mark: 'FEEDBACK',
    warmup: 1,
    runs: 10,
    trigger: async () => {
      const started = Date.now();
      await client({ args: ['run', '--', 'true',], },);
      return started;
    },
  },);

  keyboard.destroy();
  pointer.destroy();
  daemon.kill('SIGTERM',);
  await daemon.status;
  check({ name: 'clean stop removes the socket', ok: (await Deno.lstat(SOCKET,).catch(() => undefined)) === undefined, },);
  const logged = Deno.readTextFileSync(TRACE_LOG,).split('\n',).filter((line,) => line.startsWith('labwc-launcherd:',));
  l.info(`daemon diagnostics: ${JSON.stringify(logged,)}`,);
  l.info(`failures: ${JSON.stringify(failures,)}`,);
  Deno.exitCode = failures.length > 0 ? 1 : 0;
  // Exiting explicitly would drop log records the sinks have not written yet.
  await logger.flush();
  libc.close();
}

await main();
