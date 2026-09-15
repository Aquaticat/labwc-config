/**
 End-to-end check of the bundled QuickJS-ng helpers in a running labwc session with `labwc-launcherd`.

 Uses real `cliphist`, `wl-copy`, `wl-paste`, `grim`, and `slurp`,
 and stand-ins on `PATH` for programs that would leave the session or open windows:
 `systemctl`, `swaylock`, `uuctl`, `uwsm`, and `swappy`.
 Run as root in a disposable session, such as the headless labwc in the Hyper-V VM:

 ```sh
 deno run --allow-all helpers/test/end-to-end.ts --helpers helpers/dist --binaries /var/tmp/launcher-target/release --runtime-dir /tmp/hp-run
 ```

 Exits with status 1 when any check fails.

 @module
 */

import { logger, tagged, } from '@monochromatic-dev/module-logger';

import {
  BTN_LEFT,
  closeLibc,
  EV_KEY,
  KEYS,
  movePointer,
  outputSize,
  sleep,
  tap,
  UinputDevice,
} from '../../test-support/uinput.ts';

const l = tagged({ tag: 'helpers-end-to-end', },);

/** Reads `--name value` from the command line. */
function option({ name, fallback, }: { readonly name: string; readonly fallback: string; },): string {
  const index = Deno.args.indexOf(`--${name}`,);
  return index >= 0 ? Deno.args[index + 1] ?? fallback : fallback;
}

const HELPERS = option({ name: 'helpers', fallback: 'helpers/dist', },);
const BINARIES = option({ name: 'binaries', fallback: '/var/tmp/launcher-target/release', },);
const RUNTIME_DIR = option({ name: 'runtime-dir', fallback: '/tmp/hp-run', },);
const WORK = `${RUNTIME_DIR}/helpers-e2e`;
const FAKE_BIN = `${WORK}/fakebin`;
const HOME = `${WORK}/home`;
const TRACE_LOG = `${WORK}/launcherd.log`;
const ENVIRONMENT: Record<string, string> = {
  ...Deno.env.toObject(),
  HOME,
  XDG_RUNTIME_DIR: RUNTIME_DIR,
  XDG_CACHE_HOME: `${WORK}/cache`,
  XDG_CONFIG_HOME: `${HOME}/.config`,
  WAYLAND_DISPLAY: 'wayland-0',
  XDG_CURRENT_DESKTOP: 'labwc:wlroots',
  LABWC_LAUNCHER_TRACE: '1',
  PATH: `${FAKE_BIN}:${BINARIES}:${Deno.env.get('PATH',) ?? '/usr/bin'}`,
};

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

/** Every epoch-millisecond value the daemon traced for `mark`. */
function marks({ mark, }: { readonly mark: string; },): number[] {
  return Deno.readTextFileSync(TRACE_LOG,)
    .split('\n',)
    .filter((line,) => line.startsWith(`${mark} `,))
    .map((line,) => Number(line.slice(mark.length + 1,),));
}

/** Waits for trace mark number `index` and returns its time, or `undefined` after `timeout`. */
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

/**
 Starts a program in the session without waiting.

 Output is discarded because `wl-copy` forks a server that would hold captured pipes open until the clipboard changes.
 */
function start({ program, args = [], }: { readonly program: string; readonly args?: readonly string[]; },): Deno.ChildProcess {
  return new Deno.Command(program, { args: [...args,], env: ENVIRONMENT, stdin: 'null', stdout: 'null', stderr: 'null', },).spawn();
}

/** Runs a program in the session and returns its exit code and output. */
async function runToEnd(
  { program, args = [], stdin, }: { readonly program: string; readonly args?: readonly string[]; readonly stdin?: string; },
): Promise<{ readonly code: number; readonly stdout: Uint8Array; readonly stderr: string; }> {
  const child = new Deno.Command(program, {
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
  return { code: output.code, stdout: output.stdout, stderr: new TextDecoder().decode(output.stderr,), };
}

/** Reads a text file, or returns an empty string when it does not exist. */
function readOrEmpty({ path, }: { readonly path: string; },): string {
  try {
    return Deno.readTextFileSync(path,);
  } catch {
    return '';
  }
}

/** Writes the stand-in programs and the test home. */
function writeFixtures(): void {
  Deno.removeSync(WORK, { recursive: true, },);
  Deno.mkdirSync(FAKE_BIN, { recursive: true, },);
  const recorder = (name: string,) => `#!/bin/sh\nprintf '%s\\n' "$@" > ${WORK}/${name}-args\n`;
  ['systemctl', 'swaylock', 'uuctl', 'uwsm',].forEach((name,) => {
    Deno.writeTextFileSync(`${FAKE_BIN}/${name}`, recorder(name,),);
    Deno.chmodSync(`${FAKE_BIN}/${name}`, 0o755,);
  },);
  Deno.writeTextFileSync(`${FAKE_BIN}/swappy`, `#!/bin/sh\nprintf '%s\\n' "$@" > ${WORK}/swappy-args\ncat > ${WORK}/swappy-input\n`,);
  Deno.chmodSync(`${FAKE_BIN}/swappy`, 0o755,);
  Deno.mkdirSync(`${HOME}/.config`, { recursive: true, },);
  Deno.writeTextFileSync(`${HOME}/.config/user-dirs.dirs`, 'XDG_PICTURES_DIR="$HOME/Shots"\n',);
}

/** Whether `bytes` start with the PNG signature. */
function isPng({ bytes, }: { readonly bytes: Uint8Array; },): boolean {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,].every((byte, index,) => bytes[index] === byte);
}

/** Summarizes latency samples. */
function report({ name, samples, }: { readonly name: string; readonly samples: readonly number[]; },): void {
  const sorted = [...samples,].sort((a, b,) => a - b);
  const at = (fraction: number,): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction,),)] ?? NaN;
  l.info(`${name}: median ${at(0.5,).toFixed(1,)} ms, p90 ${at(0.9,).toFixed(1,)} ms, max ${(sorted.at(-1,) ?? NaN).toFixed(1,)} ms, n=${sorted.length}`,);
}

/** Measures spawning `helper` until the launcher surface has keyboard focus, closing it after each run. */
async function measureToFocus({ name, helper, }: { readonly name: string; readonly helper: string; },): Promise<void> {
  const samples: number[] = [];
  for (let run = 0; run < 23; run++) {
    const before = marks({ mark: 'ENTER', },).length;
    const started = Date.now();
    const child = start({ program: `${HELPERS}/${helper}`, },);
    const entered = await waitForMark({ mark: 'ENTER', index: before, },);
    if (entered !== undefined && run >= 3) {
      samples.push(entered - started,);
    }
    await sleep({ milliseconds: 100, },);
    await runToEnd({ program: 'labwc-launcher', args: ['close',], },);
    await child.output();
    await sleep({ milliseconds: 150, },);
  }
  report({ name, samples, },);
}

/** Runs every check. */
async function main(): Promise<void> {
  Deno.mkdirSync(WORK, { recursive: true, },);
  writeFixtures();
  await runToEnd({ program: 'pkill', args: ['-x', 'labwc-launcherd',], },);
  await sleep({ milliseconds: 300, },);
  Deno.writeTextFileSync(TRACE_LOG, '',);
  const daemon = new Deno.Command('sh', {
    args: ['-c', `exec '${BINARIES}/labwc-launcherd' 2>> '${TRACE_LOG}'`,],
    env: ENVIRONMENT,
    stdout: 'null',
  },).spawn();
  check({ name: 'daemon ready', ok: (await waitForMark({ mark: 'READY', index: 0, },)) !== undefined, },);
  const keyboard = UinputDevice.create({ name: 'helpers-e2e-keyboard', keys: Object.values(KEYS,), absolute: false, },);
  const pointer = UinputDevice.create({ name: 'helpers-e2e-pointer', keys: [BTN_LEFT,], absolute: true, },);
  const size = await outputSize({ environment: ENVIRONMENT, },);
  await sleep({ milliseconds: 1500, },);

  // Panel menu: choose the fourth entry.
  let enters = marks({ mark: 'ENTER', },).length;
  const menu = start({ program: `${HELPERS}/labwc-panel-menu`, },);
  check({ name: 'panel menu shows through the daemon', ok: (await waitForMark({ mark: 'ENTER', index: enters, },)) !== undefined, },);
  await sleep({ milliseconds: 150, },);
  await runToEnd({ program: 'grim', args: [`${WORK}/panel-menu.png`,], },);
  for (let step = 0; step < 3; step++) {
    await tap({ device: keyboard, key: 'down', },);
    await sleep({ milliseconds: 30, },);
  }
  await tap({ device: keyboard, key: 'enter', },);
  const menuResult = await menu.output();
  check({
    name: 'choosing Restart panel restarts the panel unit',
    ok: menuResult.code === 0 && readOrEmpty({ path: `${WORK}/systemctl-args`, },) === '--user\n--no-block\nrestart\nlabwc-panel.service\n',
    detail: JSON.stringify({ code: menuResult.code, args: readOrEmpty({ path: `${WORK}/systemctl-args`, },), },),
  },);
  enters = marks({ mark: 'ENTER', },).length;
  const dismissedMenu = start({ program: `${HELPERS}/labwc-panel-menu`, },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  await tap({ device: keyboard, key: 'esc', },);
  const dismissedMenuResult = await dismissedMenu.output();
  check({ name: 'dismissing the panel menu runs nothing and exits 0', ok: dismissedMenuResult.code === 0 && readOrEmpty({ path: `${WORK}/swaylock-args`, },) === '', },);

  // Clipboard picker with a real cliphist database.
  await runToEnd({ program: 'cliphist', args: ['store',], stdin: 'older entry', },);
  await runToEnd({ program: 'cliphist', args: ['store',], stdin: 'newest entry 🙂 剪贴板', },);
  await start({ program: 'wl-copy', args: ['unchanged before picking',], },).status;
  enters = marks({ mark: 'ENTER', },).length;
  const dismissedPick = start({ program: `${HELPERS}/labwc-clipboard-pick`, },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  await tap({ device: keyboard, key: 'esc', },);
  await dismissedPick.output();
  const afterDismiss = new TextDecoder().decode((await runToEnd({ program: 'wl-paste', args: ['--no-newline',], },)).stdout,);
  check({ name: 'dismissing the clipboard picker leaves the clipboard untouched', ok: afterDismiss === 'unchanged before picking', detail: JSON.stringify(afterDismiss,), },);
  enters = marks({ mark: 'ENTER', },).length;
  const pick = start({ program: `${HELPERS}/labwc-clipboard-pick`, },);
  await waitForMark({ mark: 'ENTER', index: enters, },);
  await sleep({ milliseconds: 150, },);
  await runToEnd({ program: 'grim', args: [`${WORK}/clipboard-pick.png`,], },);
  await tap({ device: keyboard, key: 'enter', },);
  const pickResult = await pick.output();
  await sleep({ milliseconds: 200, },);
  const picked = new TextDecoder().decode((await runToEnd({ program: 'wl-paste', args: ['--no-newline',], },)).stdout,);
  check({
    name: 'Enter copies the newest history entry back, including non-ASCII text',
    ok: pickResult.code === 0 && picked === 'newest entry 🙂 剪贴板',
    detail: JSON.stringify({ code: pickResult.code, picked, },),
  },);

  // Full-screen screenshot.
  const shot = await start({ program: `${HELPERS}/labwc-screenshot`, },).status;
  const shots = [...Deno.readDirSync(`${HOME}/Shots`,),].map((entry,) => entry.name);
  const savedPath = shots.length === 1 ? `${HOME}/Shots/${shots[0]}` : '';
  check({
    name: 'screenshot saves one PNG into the pictures directory from user-dirs.dirs',
    ok: shot.code === 0 && /^screenshot-\d+\.png$/u.test(shots[0] ?? '',) && isPng({ bytes: Deno.readFileSync(savedPath,), },),
    detail: JSON.stringify({ code: shot.code, shots, },),
  },);
  await sleep({ milliseconds: 200, },);
  const types = new TextDecoder().decode((await runToEnd({ program: 'wl-paste', args: ['--list-types',], },)).stdout,);
  check({ name: 'screenshot copies the image to the clipboard', ok: types.split('\n',).includes('image/png',), detail: JSON.stringify(types,), },);

  // Region screenshot: dismiss with Escape, then drag a region.
  const dismissedRegion = start({ program: `${HELPERS}/labwc-screenshot-region`, },);
  await sleep({ milliseconds: 500, },);
  await tap({ device: keyboard, key: 'esc', },);
  const dismissedRegionResult = await dismissedRegion.output();
  check({
    name: 'dismissing the region selection captures nothing and exits 0',
    ok: dismissedRegionResult.code === 0 && readOrEmpty({ path: `${WORK}/swappy-args`, },) === '',
  },);
  const region = start({ program: `${HELPERS}/labwc-screenshot-region`, },);
  await sleep({ milliseconds: 500, },);
  movePointer({ pointer, x: 100, y: 100, size, },);
  await sleep({ milliseconds: 50, },);
  pointer.emit({ type: EV_KEY, code: BTN_LEFT, value: 1, },);
  await sleep({ milliseconds: 50, },);
  movePointer({ pointer, x: 300, y: 250, size, },);
  await sleep({ milliseconds: 50, },);
  pointer.emit({ type: EV_KEY, code: BTN_LEFT, value: 0, },);
  const regionResult = await region.output();
  const swappyInput = await Deno.readFile(`${WORK}/swappy-input`,).catch(() => new Uint8Array(),);
  check({
    name: 'dragging a region sends a PNG of it to swappy',
    ok: regionResult.code === 0 && readOrEmpty({ path: `${WORK}/swappy-args`, },) === '-f\n-\n' && isPng({ bytes: swappyInput, },),
    detail: JSON.stringify({ code: regionResult.code, bytes: swappyInput.length, },),
  },);

  // Hot paths through the helpers.
  await measureToFocus({ name: 'labwc-panel-menu spawn to keyboard enter', helper: 'labwc-panel-menu', },);
  await measureToFocus({ name: 'labwc-clipboard-pick spawn to keyboard enter', helper: 'labwc-clipboard-pick', },);

  keyboard.destroy();
  pointer.destroy();
  daemon.kill('SIGTERM',);
  await daemon.status;
  closeLibc();
  l.info(`failures: ${JSON.stringify(failures,)}`,);
  Deno.exitCode = failures.length > 0 ? 1 : 0;
  await logger.flush();
}

await main();
