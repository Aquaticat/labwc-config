/**
 End-to-end check of `labwc-pager` against a private headless labwc running this repository's `rc.xml`.

 Run as root in a disposable environment with labwc installed, such as the Hyper-V VM:

 ```sh
 deno run --allow-all launcher/test/pager-end-to-end.ts --binaries /tmp/launcher/target/release --rc-xml config/labwc/rc.xml
 ```

 Exits with status 1 when any check fails.

 @module
 */

import { logger, tagged, } from '@monochromatic-dev/module-logger';

const l = tagged({ tag: 'pager-end-to-end', },);

/** Thrown when the test cannot run at all, as opposed to a failed check. */
class PagerSetupError extends Error {
  /**
   @param message - what could not be set up
   */
  constructor(message: string,) {
    super(message,);
    this.name = PagerSetupError.name;
  }
}

/** Reads `--name value` from the command line. */
function option({ name, fallback, }: { readonly name: string; readonly fallback: string; },): string {
  const index = Deno.args.indexOf(`--${name}`,);
  return index >= 0 ? Deno.args[index + 1] ?? fallback : fallback;
}

const BINARIES = option({ name: 'binaries', fallback: '/tmp/launcher/target/release', },);
const RC_XML = option({ name: 'rc-xml', fallback: 'config/labwc/rc.xml', },);
const RUNTIME_DIR = '/tmp/pager-e2e-run';
const CONFIG_DIR = '/tmp/pager-e2e-config';
/** labwc takes the first free socket name, and the runtime directory is private, so it is always this one. */
const DISPLAY = 'wayland-0';
const ENVIRONMENT: Record<string, string> = {
  ...Deno.env.toObject(),
  XDG_RUNTIME_DIR: RUNTIME_DIR,
  WAYLAND_DISPLAY: DISPLAY,
};
/** Desktop names from `config/labwc/rc.xml`, in the order the grid reads. */
const GRID = [
  'left top', 'top', 'right top',
  'left', 'middle', 'right',
  'left bottom', 'bottom', 'right bottom',
] as const;

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

/** Runs `labwc-pager` with `args` to completion. */
async function pager({ args, }: { readonly args: readonly string[]; },): Promise<{ readonly code: number; readonly stderr: string; }> {
  const output = await new Deno.Command(`${BINARIES}/labwc-pager`, { args: [...args,], env: ENVIRONMENT, stderr: 'piped', stdout: 'null', },)
    .output();
  return { code: output.code, stderr: new TextDecoder().decode(output.stderr,), };
}

/** Lines printed by `labwc-pager watch`, each with the epoch milliseconds it arrived. */
type WatchLine = { readonly name: string; readonly at: number; };

/** Starts `labwc-pager watch` and collects its lines as they arrive. */
function startWatch(): { readonly lines: WatchLine[]; readonly child: Deno.ChildProcess; } {
  const child = new Deno.Command(`${BINARIES}/labwc-pager`, { args: ['watch',], env: ENVIRONMENT, stdout: 'piped', stderr: 'null', },)
    .spawn();
  const lines: WatchLine[] = [];
  (async () => {
    let pending = '';
    for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream(),)) {
      pending += chunk;
      const parts = pending.split('\n',);
      pending = parts.pop() ?? '';
      const at = Date.now();
      parts.forEach((name,) => lines.push({ name, at, },));
    }
  })();
  return { lines, child, };
}

/** Waits until watch line number `index` arrives and returns it. */
async function waitForLine(
  { lines, index, timeout = 3000, }: { readonly lines: readonly WatchLine[]; readonly index: number; readonly timeout?: number; },
): Promise<WatchLine | undefined> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (lines.length > index) {
      return lines[index];
    }
    await sleep({ milliseconds: 1, },);
  }
  return undefined;
}

/** Starts a private headless labwc with the repository's `rc.xml`. */
async function startCompositor(): Promise<Deno.ChildProcess> {
  await Deno.remove(RUNTIME_DIR, { recursive: true, },).catch(() => undefined);
  await Deno.mkdir(RUNTIME_DIR, { recursive: true, mode: 0o700, },);
  await Deno.mkdir(CONFIG_DIR, { recursive: true, },);
  await Deno.copyFile(RC_XML, `${CONFIG_DIR}/rc.xml`,);
  const compositor = new Deno.Command('labwc', {
    args: ['--config-dir', CONFIG_DIR,],
    env: {
      ...ENVIRONMENT,
      WLR_BACKENDS: 'headless',
      WLR_RENDERER: 'pixman',
      LIBSEAT_BACKEND: 'noop',
      WLR_HEADLESS_OUTPUTS: '1',
    },
    stdout: 'null',
    stderr: 'null',
  },).spawn();
  for (let waited = 0; waited < 5000; waited += 20) {
    if (await Deno.lstat(`${RUNTIME_DIR}/${DISPLAY}`,).catch(() => undefined)) {
      return compositor;
    }
    await sleep({ milliseconds: 20, },);
  }
  throw new PagerSetupError('the private labwc did not create its socket',);
}

/** Summarizes latency samples. */
function report({ name, samples, }: { readonly name: string; readonly samples: readonly number[]; },): void {
  const sorted = [...samples,].sort((a, b,) => a - b);
  const at = (fraction: number,): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction,),)] ?? NaN;
  l.info(`${name}: median ${at(0.5,).toFixed(1,)} ms, p90 ${at(0.9,).toFixed(1,)} ms, max ${(sorted.at(-1,) ?? NaN).toFixed(1,)} ms, n=${sorted.length}`,);
}

/** Runs every check. */
async function main(): Promise<void> {
  const compositor = await startCompositor();
  const { lines, child: watcher, } = startWatch();

  const initial = await waitForLine({ lines, index: 0, },);
  check({ name: 'watch prints the first desktop at start', ok: initial?.name === GRID[0], detail: JSON.stringify(initial?.name,), },);

  const expectLine = async ({ name, args, expected, }: { readonly name: string; readonly args: readonly string[]; readonly expected: string; },) => {
    const before = lines.length;
    const result = await pager({ args, },);
    const line = await waitForLine({ lines, index: before, },);
    check({ name, ok: result.code === 0 && line?.name === expected, detail: JSON.stringify({ code: result.code, line: line?.name, },), },);
  };
  await expectLine({ name: 'activate by grid index', args: ['activate', '4',], expected: 'middle', },);
  await expectLine({ name: 'next moves right in reading order', args: ['next',], expected: 'right', },);
  await expectLine({ name: 'next wraps from a row end to the next row', args: ['next',], expected: 'left bottom', },);
  await expectLine({ name: 'prev moves back', args: ['prev',], expected: 'right', },);
  await expectLine({ name: 'activate by name', args: ['activate', 'right bottom',], expected: 'right bottom', },);
  await expectLine({ name: 'next wraps from the last desktop to the first', args: ['next',], expected: 'left top', },);
  await expectLine({ name: 'prev wraps from the first desktop to the last', args: ['prev',], expected: 'right bottom', },);

  const unknown = await pager({ args: ['activate', 'nowhere',], },);
  check({ name: 'unknown workspace exits 1', ok: unknown.code === 1 && unknown.stderr.includes('no workspace matches nowhere',), detail: unknown.stderr.trim(), },);
  const usage = await pager({ args: ['sideways',], },);
  check({ name: 'unknown command exits 1 with usage', ok: usage.code === 1 && usage.stderr.includes('usage:',), },);

  const measureSteps = async ({ name, delayed, }: { readonly name: string; readonly delayed: boolean; },): Promise<void> => {
    const samples: number[] = [];
    // An even number of alternating steps returns to the starting desktop, which the restart check below relies on.
    for (let run = 0; run < 24; run++) {
      const before = lines.length;
      const direction = run % 2 === 0 ? 'next' : 'prev';
      const started = Date.now();
      if (delayed) {
        // Positive control: a known 10 ms delay must show up in the measurement.
        await new Deno.Command('sh', { args: ['-c', `sleep 0.010; exec '${BINARIES}/labwc-pager' ${direction}`,], env: ENVIRONMENT, },).output();
      } else {
        await pager({ args: [direction,], },);
      }
      const line = await waitForLine({ lines, index: before, },);
      if (line !== undefined && run >= 3) {
        samples.push(line.at - started,);
      }
      await sleep({ milliseconds: 100, },);
    }
    report({ name, samples, },);
  };
  await measureSteps({ name: 'pager next or prev spawn to watch output', delayed: false, },);
  await measureSteps({ name: 'positive control with a 10 ms sleep before the pager', delayed: true, },);

  compositor.kill('SIGTERM',);
  await compositor.status;
  const reconnectBefore = lines.length;
  const restarted = await startCompositor();
  const afterRestart = await waitForLine({ lines, index: reconnectBefore, timeout: 6000, },);
  check({ name: 'watch reconnects after the compositor restarts', ok: afterRestart?.name === GRID[0], detail: JSON.stringify(afterRestart?.name,), },);

  watcher.kill('SIGTERM',);
  await watcher.status;
  restarted.kill('SIGTERM',);
  await restarted.status;
  l.info(`failures: ${JSON.stringify(failures,)}`,);
  Deno.exitCode = failures.length > 0 ? 1 : 0;
  await logger.flush();
}

await main();
