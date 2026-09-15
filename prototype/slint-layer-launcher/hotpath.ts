import { spawn, spawnSync } from 'node:child_process';
import { openSync, readFileSync, closeSync } from 'node:fs';

const env = { ...process.env, XDG_RUNTIME_DIR: '/tmp/hp-run', WAYLAND_DISPLAY: 'wayland-0' };
const N = 20;
const quantiles = (label: string, values: number[]): void => {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(`${label.padEnd(34)} median ${sorted[Math.floor(N / 2)].toFixed(1)} ms  p90 ${sorted[Math.floor(N * 0.9)].toFixed(1)} ms  min ${sorted[0].toFixed(1)} ms`);
};
const timeCommand = (argv: string[]): number => {
  const start = performance.now();
  spawnSync(argv[0], argv.slice(1), { env, stdio: 'ignore' });
  return performance.now() - start;
};
const parseClock = (line: string): number => {
  const match = line.match(/^\[(\d\d):(\d\d):(\d\d)\.(\d{6})\]/);
  if (!match) throw new Error(`no timestamp: ${line}`);
  const [, h, m, s, us] = match;
  const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  return dayStart + ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(us) / 1000;
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

for (const round of [1, 2]) {
  for (const argv of [['uwsm', 'version'], ['python3', '-c', 'pass'], ['qjs', '-e', '0']]) {
    for (let i = 0; i < 3; i++) timeCommand(argv);
    quantiles(`round ${round} ${argv.join(' ')}`, Array.from({ length: N }, () => timeCommand(argv)));
  }
  const focus: number[] = [];
  for (let i = 0; i < N + 3; i++) {
    const log = `/tmp/hp-run/fuzzel-${i}.log`;
    const fd = openSync(log, 'w');
    const spawnedAt = Date.now();
    const child = spawn('fuzzel', [], { env: { ...env, WAYLAND_DEBUG: 'client' }, stdio: ['ignore', 'ignore', fd] });
    await sleep(600);
    child.kill();
    await sleep(100);
    closeSync(fd);
    const enter = readFileSync(log, 'utf8').split('\n').find((line) => /wl_keyboard#\d+\.enter\(/.test(line));
    if (!enter) throw new Error(`fuzzel run ${i}: no wl_keyboard.enter`);
    if (i >= 3) focus.push(parseClock(enter) - spawnedAt);
  }
  quantiles(`round ${round} fuzzel spawn -> keyboard.enter`, focus);
}
