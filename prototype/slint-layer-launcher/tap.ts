import { createReadStream } from 'node:fs';

const EVENT_BYTES = 24;
const EV_KEY = 1;
const META_CODES = new Set([125, 126]);
let metaDown = false;
let chorded = false;
let pending = new Uint8Array(0);

const handle = (type: number, code: number, value: number): void => {
  if (type !== EV_KEY) return;
  if (META_CODES.has(code) && value === 1) {
    metaDown = true;
    chorded = false;
  } else if (META_CODES.has(code) && value === 0) {
    if (metaDown && !chorded) console.log(`TAP ${Date.now()}`);
    metaDown = false;
  } else if (metaDown && value === 1) {
    chorded = true;
  }
};

createReadStream(process.argv[2] ?? '/dev/input/event0').on('data', (chunk: Uint8Array | string) => {
  if (typeof chunk === 'string') throw new TypeError('expected binary chunk');
  const joined = new Uint8Array(pending.length + chunk.length);
  joined.set(pending);
  joined.set(chunk, pending.length);
  const view = new DataView(joined.buffer);
  let offset = 0;
  for (; offset + EVENT_BYTES <= joined.length; offset += EVENT_BYTES) {
    handle(view.getUint16(offset + 16, true), view.getUint16(offset + 18, true), view.getInt32(offset + 20, true));
  }
  pending = joined.slice(offset);
});
console.log('READY');
