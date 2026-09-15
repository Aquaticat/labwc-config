import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const enters = (log: string): string[] => readFileSync(log, 'utf8').split('\n').filter((line) => /wl_keyboard#\d+\.enter\(/.test(line));
const report = (name: string, values: number[]): void => {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(`${name.padEnd(40)} median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms  p90 ${sorted[Math.floor(sorted.length * 0.9)].toFixed(1)} ms  min ${sorted[0].toFixed(1)} ms  n=${sorted.length}`);
};
const waitForEnter = async (log: string, before: number, label: string): Promise<string> => {
  for (let waited = 0; waited < 3000; waited += 5) {
    const all = enters(log);
    if (all.length > before) return all[before];
    await sleep(5);
  }
  throw new Error(`${label}: no new wl_keyboard.enter`);
};

const freshProcess = async (name: string, argv: string[], stdin = ''): Promise<void> => {
  const values: number[] = [];
  for (let i = 0; i < N + WARM; i++) {
    const log = `${RUN}/lb-${i}.log`;
    const fd = openSync(log, 'w');
    const t0 = Date.now();
    const child = spawn(argv[0], argv.slice(1), { env: { ...base, WAYLAND_DEBUG: 'client' }, stdio: ['pipe', 'ignore', fd] });
    child.stdin.end(stdin);
    const line = await waitForEnter(log, 0, name);
    child.kill();
    await sleep(150);
    closeSync(fd);
    if (i >= WARM) values.push(clock(line) - t0);
  }
  report(name, values);
};

// walker config: bottom-left, not fullscreen, no exclusive zone.
mkdirSync('/tmp/hp-cfg/walker', { recursive: true });
writeFileSync('/tmp/hp-cfg/walker/config.toml', readFileSync('/etc/xdg/walker/config.toml', 'utf8')
  .replace('exclusive_zone = -1', 'exclusive_zone = 0').replace('anchor_top = true', 'anchor_top = false').replace('anchor_right = true', 'anchor_right = false'));
writeFileSync('/tmp/rt/fuzzel-noworkers.ini', readFileSync('/tmp/rt/fuzzel.ini', 'utf8').replace(/^/, 'render-workers=0\nmatch-workers=0\n'));

await freshProcess('fuzzel repo ini', ['fuzzel', '--config', '/tmp/rt/fuzzel.ini']);
await freshProcess('fuzzel repo ini, 0 workers', ['fuzzel', '--config', '/tmp/rt/fuzzel-noworkers.ini']);
await freshProcess('tofi-drun font path, bottom-left', ['tofi-drun', '--font', '/usr/share/fonts/TTF/DejaVuSans.ttf', '--hint-font', 'false', '--anchor', 'bottom-left', '--width', '480', '--height', '360']);
await freshProcess('tofi dmenu font path', ['tofi', '--font', '/usr/share/fonts/TTF/DejaVuSans.ttf', '--hint-font', 'false', '--anchor', 'bottom-left', '--width', '480', '--height', '360'], 'a\nb\nc\nd\ne\n');

const elephant = spawn('elephant', [], { env: base, stdio: 'ignore' });
const serviceLog = `${RUN}/walker-service.log`;
const serviceFd = openSync(serviceLog, 'w');
const service = spawn('walker', ['--gapplication-service'], { env: { ...base, WAYLAND_DEBUG: 'client' }, stdio: ['ignore', 'ignore', serviceFd] });
await sleep(4000);
const socketShow: number[] = [];
for (let i = 0; i < N + WARM; i++) {
  const before = enters(serviceLog).length;
  const t0 = Date.now();
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(`${RUN}/walker/walker.sock`, () => { socket.end(); resolve(); });
    socket.on('error', reject);
  });
  const line = await waitForEnter(serviceLog, before, 'walker socket show');
  if (i >= WARM) socketShow.push(clock(line) - t0);
  spawn('walker', ['--close'], { env: base, stdio: 'ignore' });
  await sleep(400);
}
report('walker service, socket show', socketShow);
const dmenu: number[] = [];
for (let i = 0; i < N + WARM; i++) {
  const before = enters(serviceLog).length;
  const t0 = Date.now();
  const client = spawn('walker', ['--dmenu'], { env: base, stdio: ['pipe', 'ignore', 'ignore'] });
  client.stdin.end('a\nb\nc\nd\ne\n');
  const line = await waitForEnter(serviceLog, before, 'walker dmenu');
  if (i >= WARM) dmenu.push(clock(line) - t0);
  spawn('walker', ['--close'], { env: base, stdio: 'ignore' });
  await sleep(400);
  client.kill();
}
report('walker service, --dmenu client', dmenu);
service.kill();
elephant.kill();
closeSync(serviceFd);
