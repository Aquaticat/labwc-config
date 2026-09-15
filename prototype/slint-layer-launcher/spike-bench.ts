import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';

const RUN = '/tmp/hp-run';
const env = { ...process.env, XDG_RUNTIME_DIR: RUN, WAYLAND_DISPLAY: 'wayland-0' };
const N = 20;
const WARM = 3;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const marks = (log: string, kind: string): number[] =>
  readFileSync(log, 'utf8').split('\n').filter((line) => line.startsWith(`${kind} `)).map((line) => Number(line.slice(kind.length + 1)));
const waitFor = async (log: string, kind: string, before: number): Promise<number> => {
  for (let waited = 0; waited < 5000; waited += 2) {
    const all = marks(log, kind);
    if (all.length > before) return all[before];
    await sleep(2);
  }
  throw new Error(`no new ${kind}`);
};
const report = (name: string, values: number[]): void => {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(`${name.padEnd(40)} median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms  p90 ${sorted[Math.floor(sorted.length * 0.9)].toFixed(1)} ms  min ${sorted[0].toFixed(1)} ms  max ${sorted.at(-1)!.toFixed(1)} ms  n=${sorted.length}`);
};

const log = `${RUN}/spike.log`;
const fd = openSync(log, 'w');
const started = Date.now();
const daemon = spawn(Deno.args[0] ?? '/tmp/spike/target/release/prototype-slint-layer-launcher', [], { env, stdio: ['ignore', 'ignore', fd] });
const ready = await waitFor(log, 'READY', 0);
console.log(`daemon start to READY: ${(ready - started).toFixed(1)} ms`);
const rss = readFileSync(`/proc/${daemon.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1];
console.log(`idle RSS: ${(Number(rss) / 1024).toFixed(1)} MiB`);

const shows: number[] = [];
for (let i = 0; i < N + WARM; i++) {
  const enters = marks(log, 'ENTER').length;
  const leaves = marks(log, 'HIDE').length;
  const t0 = Date.now();
  process.kill(daemon.pid!, 'SIGUSR1');
  const enter = await waitFor(log, 'ENTER', enters);
  if (i === 0) console.log(`first show: ${(enter - t0).toFixed(1)} ms`);
  if (i >= WARM) shows.push(enter - t0);
  await sleep(200);
  process.kill(daemon.pid!, 'SIGUSR1');
  await waitFor(log, 'HIDE', leaves);
  await sleep(300);
}
report('slint spike, SIGUSR1 show (warm)', shows);
daemon.kill();
closeSync(fd);
