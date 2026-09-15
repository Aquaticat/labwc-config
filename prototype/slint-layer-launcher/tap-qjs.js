import * as os from 'qjs:os';
import * as std from 'qjs:std';

const EVENT_BYTES = 24;
let metaDown = false;
let chorded = false;
const handle = (type, code, value) => {
  if (type !== 1) return;
  const meta = code === 125 || code === 126;
  if (meta && value === 1) { metaDown = true; chorded = false; }
  else if (meta && value === 0) { if (metaDown && !chorded) { std.out.puts(`TAP ${Date.now()}\n`); std.out.flush(); } metaDown = false; }
  else if (metaDown && value === 1) chorded = true;
};
const fd = os.open(scriptArgs[1] ?? '/dev/input/event0', os.O_RDONLY);
const buffer = new ArrayBuffer(EVENT_BYTES * 64);
os.setReadHandler(fd, () => {
  const bytes = os.read(fd, buffer, 0, buffer.byteLength);
  const view = new DataView(buffer);
  for (let offset = 0; offset + EVENT_BYTES <= bytes; offset += EVENT_BYTES) {
    handle(view.getUint16(offset + 16, true), view.getUint16(offset + 18, true), view.getInt32(offset + 20, true));
  }
});
std.out.puts('READY\n');
std.out.flush();
