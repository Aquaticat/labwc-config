import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

// Positive control: a shell that backgrounds `true` and then execs `sleep` never reaps it,
// so the same /proc parsing used in reap.ts must count one zombie under that parent.
const parent = spawn('sh', ['-c', 'true & exec sleep 3'], { stdio: 'ignore' });
setTimeout(() => {
  const zombies = readdirSync('/proc').filter((name) => /^\d+$/.test(name)).filter((pid) => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return fields[0] === 'Z' && Number(fields[1]) === parent.pid;
    } catch {
      return false;
    }
  }).length;
  console.log(`control zombies: ${zombies}`);
  parent.kill();
}, 1000);
