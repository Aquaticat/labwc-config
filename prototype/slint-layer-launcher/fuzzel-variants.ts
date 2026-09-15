import { spawn } from 'node:child_process';
import { openSync, readFileSync, closeSync, readdirSync } from 'node:fs';

const env = { ...process.env, XDG_RUNTIME_DIR: '/tmp/hp-run', WAYLAND_DISPLAY: 'wayland-0', WAYLAND_DEBUG: 'client' };
const N = 20;
const parseClock = (line: string): number => {
  const match = line.match(/^\[(\d\d):(\d\d):(\d\d)\.(\d{6})\]/);
  if (!match) throw new Error(`no timestamp: ${line}`);
  const [, h, m, s, us] = match;
  const dayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  return dayStart + ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(us) / 1000;
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const variants: Record<string, { argv: string[]; stdin?: string }> = {
  'default config': { argv: ['fuzzel'] },
  'repo fuzzel.ini': { argv: ['fuzzel', '--config', '/tmp/rt/fuzzel.ini'] },
  'repo fuzzel.ini, no icons': { argv: ['fuzzel', '--config', '/tmp/rt/fuzzel.ini', '--no-icons'] },
  'dmenu, 5 lines': { argv: ['fuzzel', '--config', '/tmp/rt/fuzzel.ini', '--dmenu'], stdin: 'a\nb\nc\nd\ne\n' },
  'sleep 10 && fuzzel (control)': { argv: ['sh', '-c', 'sleep 0.010; exec fuzzel --config /tmp/rt/fuzzel.ini'] },
};
console.log(`desktop entries: ${readdirSync('/usr/share/applications').length}`);
for (const [name, variant] of Object.entries(variants)) {
  const focus: number[] = [];
  for (let i = 0; i < N + 3; i++) {
    const log = `/tmp/hp-run/v-${i}.log`;
    const fd = openSync(log, 'w');
    const spawnedAt = Date.now();
    const child = spawn(variant.argv[0], variant.argv.slice(1), { env, stdio: ['pipe', 'ignore', fd] });
    child.stdin.end(variant.stdin ?? '');
    await sleep(600);
    child.kill();
    await sleep(100);
    closeSync(fd);
    const enter = readFileSync(log, 'utf8').split('\n').find((line) => /wl_keyboard#\d+\.enter\(/.test(line));
    if (!enter) throw new Error(`${name} run ${i}: no wl_keyboard.enter`);
    if (i >= 3) focus.push(parseClock(enter) - spawnedAt);
  }
  const sorted = focus.sort((a, b) => a - b);
  console.log(`${name.padEnd(30)} median ${sorted[N / 2].toFixed(1)} ms  p90 ${sorted[Math.floor(N * 0.9)].toFixed(1)} ms  min ${sorted[0].toFixed(1)} ms`);
}
