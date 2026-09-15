import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const R = '/tmp/rt';
const env = { ...process.env, LD_LIBRARY_PATH: `${R}/usr/lib`, DENO_DIR: `${R}/deno-cache`, NO_COLOR: '1' };
const B = `${R}/usr/bin`;
const cases = {
  'node toggle.ts': [`${B}/node`, `${R}/toggle.ts`],
  'bun toggle.ts': [`${B}/bun`, `${R}/toggle.ts`],
  'deno run toggle.ts': [`${B}/deno`, 'run', '--allow-read', `${R}/toggle.ts`],
  'qjs toggle-qjs.js': [`${B}/qjs`, `${R}/toggle-qjs.js`],
  'bun --compile binary': [`${R}/toggle-bun`],
  'deno compile binary': [`${R}/toggle-deno`],
};
const once = (cmd) => {
  const start = process.hrtime.bigint();
  const r = spawnSync(cmd[0], cmd.slice(1), { env, stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) throw new Error(`${cmd.join(' ')} exited ${r.status}: ${r.stderr}`);
  return Number(process.hrtime.bigint() - start) / 1e6;
};
const N = 40;
for (const round of [1, 2]) {
  for (const [name, cmd] of Object.entries(cases)) {
    try {
      for (let i = 0; i < 5; i++) once(cmd);
      const t = Array.from({ length: N }, () => once(cmd)).sort((a, b) => a - b);
      console.log(`round ${round}  ${name.padEnd(22)} median ${t[N / 2].toFixed(1)} ms  p90 ${t[Math.floor(N * 0.9)].toFixed(1)} ms  min ${t[0].toFixed(1)} ms`);
    } catch (error) {
      console.log(`round ${round}  ${name.padEnd(22)} FAILED ${String(error).slice(0, 200)}`);
    }
  }
}
const idle = {
  node: [`${B}/node`, `${R}/idle.ts`],
  bun: [`${B}/bun`, `${R}/idle.ts`],
  deno: [`${B}/deno`, 'run', `${R}/idle.ts`],
  qjs: [`${B}/qjs`, `${R}/idle-qjs.js`],
};
for (const [name, cmd] of Object.entries(idle)) {
  const child = spawn(cmd[0], cmd.slice(1), { env, stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const rss = readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1];
  console.log(`idle RSS ${name.padEnd(5)} ${(Number(rss) / 1024).toFixed(1)} MiB`);
  child.kill();
}
