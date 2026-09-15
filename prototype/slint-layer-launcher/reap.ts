import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const zombieChildren = (): number => readdirSync('/proc')
  .filter((name) => /^\d+$/.test(name))
  .filter((pid) => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return fields[0] === 'Z' && Number(fields[1]) === process.pid;
    } catch {
      return false;
    }
  }).length;

for (let i = 0; i < 5; i++) spawn('true', [], { detached: true, stdio: 'ignore' }).unref();
setTimeout(() => {
  console.log(`zombies after 1.5 s: ${zombieChildren()}`);
  setTimeout(() => {}, 0);
}, 1500);
