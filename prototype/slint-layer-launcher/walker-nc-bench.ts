import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

const RUN = '/tmp/hp-run';
const base = { ...process.env, XDG_RUNTIME_DIR: RUN, WAYLAND_DISPLAY: 'wayland-0', XDG_CONFIG_HOME: '/tmp/hp-cfg' };
const N = 20;
const WARM = 3;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const clock = (line: string): number => {
  const match = line.match(/^\[(\d\d):(\d\d):(\d\d)\.(\d{6})\]/);
  if (!match) throw new Error(`no timestamp: ${line}`);
  const [, h, m, s, us] = match;
  return Math.floor(Date.now() / 86_400_000) * 86_400_000 + ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(us) / 1000;
};
const events = (log: string, kind: 'enter' | 'leave'): string[] =>
  readFileSync(log, 'utf8').split('\n').filter((line) => line.includes("wl_keyboard#") && line.includes(`.${kind}(`));
const waitFor = async (log: string, kind: 'enter' | 'leave', before: number, label: string): Promise<string> => {
  for (let waited = 0; waited < 5000; waited += 5) {
    const all = events(log, kind);
    if (all.length > before) return all[before];
    await sleep(5);
  }
  throw new Error(`${label}: no new wl_keyboard.${kind}`);
};
const report = (name: string, values: number[]): void => {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(`${name.padEnd(40)} median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms  p90 ${sorted[Math.floor(sorted.length * 0.9)].toFixed(1)} ms  min ${sorted[0].toFixed(1)} ms  n=${sorted.length}`);
};
const pokeNet = (): Promise<void> => new Promise((resolve, reject) => {
  const socket = createConnection(`${RUN}/walker/walker.sock`, () => { socket.end(); resolve(); });
  socket.on('error', reject);
});

const poke = (): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn("nc", ["-U", "-N", `${RUN}/walker/walker.sock`], { env: base, stdio: ["ignore", "ignore", "ignore"] });
  child.on("exit", () => resolve());
  child.on("error", reject);
});
const elephant = spawn('elephant', [], { env: base, stdio: 'ignore' });
const log = `${RUN}/walker-service2.log`;
const fd = openSync(log, 'w');
const service = spawn('walker', ['--gapplication-service'], { env: { ...base, WAYLAND_DEBUG: 'client' }, stdio: ['ignore', 'ignore', fd] });
await sleep(4000);
const first = Date.now();
await poke();
console.log(`first show after service start: ${(clock(await waitFor(log, 'enter', 0, 'first')) - first).toFixed(1)} ms`);
await poke();
await waitFor(log, 'leave', 0, 'first close');
await sleep(300);
const shows: number[] = [];
for (let i = 0; i < N + WARM; i++) {
  const enters = events(log, 'enter').length;
  const leaves = events(log, 'leave').length;
  const t0 = Date.now();
  await poke();
  const line = await waitFor(log, 'enter', enters, `show ${i}`);
  if (i >= WARM) shows.push(clock(line) - t0);
  await sleep(200);
  await poke();
  await waitFor(log, 'leave', leaves, `close ${i}`);
  await sleep(300);
}
report('walker service, nc -U show (warm)', shows);
service.kill();
elephant.kill();
closeSync(fd);
