/**
 Virtual keyboards and pointers through `/dev/uinput`, for end-to-end tests that run as root in a disposable session.

 @module
 */

/** Thrown when a virtual device cannot be created or configured. */
export class UinputSetupError extends Error {
  /**
   @param message - what could not be set up
   */
  constructor(message: string,) {
    super(message,);
    this.name = UinputSetupError.name;
  }
}

/** Resolves after `milliseconds`. */
export function sleep({ milliseconds, }: { readonly milliseconds: number; },): Promise<void> {
  return new Promise((resolve,) => setTimeout(resolve, milliseconds,));
}

const libc = Deno.dlopen('libc.so.6', {
  open: { parameters: ['buffer', 'i32',], result: 'i32', },
  write: { parameters: ['i32', 'buffer', 'usize',], result: 'isize', },
  close: { parameters: ['i32',], result: 'i32', },
  ioctl: { parameters: ['i32', 'u64', 'u64',], result: 'i32', },
},);

const O_WRONLY = 1;
const O_NONBLOCK = 0o4000;
const UI_SET_EVBIT = 0x40045564n;
const UI_SET_KEYBIT = 0x40045565n;
const UI_SET_RELBIT = 0x40045566n;
const UI_SET_ABSBIT = 0x40045567n;
const UI_DEV_CREATE = 0x5501n;
const UI_DEV_DESTROY = 0x5502n;
export const EV_SYN = 0;
export const EV_KEY = 1;
export const EV_REL = 2;
export const EV_ABS = 3;
export const REL_WHEEL = 8;
export const ABS_X = 0;
export const ABS_Y = 1;
export const BTN_LEFT = 0x110;
export const ABSOLUTE_MAXIMUM = 32767;
export const KEYS: Readonly<Record<string, number>> = {
  meta: 125, f12: 88, esc: 1, enter: 28, backspace: 14, down: 108, space: 57,
  a: 30, c: 46, e: 18, i: 23, k: 37, l: 38, m: 50, o: 24, r: 19, s: 31, t: 20, v: 47, z: 44,
  '0': 11, '2': 3,
};

/** Calls ioctl and throws on failure. */
function ioctl({ fd, request, value, }: { readonly fd: number; readonly request: bigint; readonly value: number; },): void {
  if (libc.symbols.ioctl(fd, request, BigInt(value,),) < 0) {
    throw new UinputSetupError(`ioctl 0x${request.toString(16,)} failed`,);
  }
}

/** A virtual input device created through `/dev/uinput`. */
export class UinputDevice {
  /**
   @param fd - open `/dev/uinput` descriptor for this device
   */
  private constructor(private readonly fd: number,) {}

  /** Creates a device with the given capabilities; `absolute` adds a pointer spanning the output layout. */
  static create(
    { name, keys, absolute, }: { readonly name: string; readonly keys: readonly number[]; readonly absolute: boolean; },
  ): UinputDevice {
    const fd = libc.symbols.open(new TextEncoder().encode('/dev/uinput\0',), O_WRONLY | O_NONBLOCK,);
    if (fd < 0) {
      throw new UinputSetupError('cannot open /dev/uinput; run as root',);
    }
    ioctl({ fd, request: UI_SET_EVBIT, value: EV_KEY, },);
    keys.forEach((code,) => ioctl({ fd, request: UI_SET_KEYBIT, value: code, },));
    const setup = new Uint8Array(1116,);
    setup.set(new TextEncoder().encode(name,).slice(0, 79,),);
    const view = new DataView(setup.buffer,);
    view.setUint16(80, 3, true,);
    view.setUint16(82, 1, true,);
    view.setUint16(84, absolute ? 2 : 1, true,);
    if (absolute) {
      ioctl({ fd, request: UI_SET_EVBIT, value: EV_ABS, },);
      ioctl({ fd, request: UI_SET_EVBIT, value: EV_REL, },);
      ioctl({ fd, request: UI_SET_ABSBIT, value: ABS_X, },);
      ioctl({ fd, request: UI_SET_ABSBIT, value: ABS_Y, },);
      ioctl({ fd, request: UI_SET_RELBIT, value: REL_WHEEL, },);
      // absmax[ABS_X] and absmax[ABS_Y] start at byte 92.
      view.setInt32(92 + ABS_X * 4, ABSOLUTE_MAXIMUM, true,);
      view.setInt32(92 + ABS_Y * 4, ABSOLUTE_MAXIMUM, true,);
    }
    libc.symbols.write(fd, setup, BigInt(setup.length,),);
    ioctl({ fd, request: UI_DEV_CREATE, value: 0, },);
    return new UinputDevice(fd,);
  }

  /** Writes one event followed by a sync report and returns the epoch milliseconds of the write. */
  emit({ type, code, value, }: { readonly type: number; readonly code: number; readonly value: number; },): number {
    const now = Date.now();
    const record = new Uint8Array(48,);
    const view = new DataView(record.buffer,);
    view.setBigInt64(0, BigInt(Math.floor(now / 1000,),), true,);
    view.setBigInt64(8, BigInt((now % 1000) * 1000,), true,);
    view.setUint16(16, type, true,);
    view.setUint16(18, code, true,);
    view.setInt32(20, value, true,);
    view.setBigInt64(24, BigInt(Math.floor(now / 1000,),), true,);
    view.setBigInt64(32, BigInt((now % 1000) * 1000,), true,);
    view.setUint16(40, EV_SYN, true,);
    libc.symbols.write(this.fd, record, 48n,);
    return now;
  }

  /** Removes the device. */
  destroy(): void {
    ioctl({ fd: this.fd, request: UI_DEV_DESTROY, value: 0, },);
    libc.symbols.close(this.fd,);
  }
}

/** Presses and releases `key`, returning the release time. */
export async function tap(
  { device, key, hold = 30, }: { readonly device: UinputDevice; readonly key: string; readonly hold?: number; },
): Promise<number> {
  device.emit({ type: EV_KEY, code: KEYS[key] ?? 0, value: 1, },);
  await sleep({ milliseconds: hold, },);
  return device.emit({ type: EV_KEY, code: KEYS[key] ?? 0, value: 0, },);
}

/** Types `text` one key at a time; spaces use the space key. */
export async function typeText({ device, text, }: { readonly device: UinputDevice; readonly text: string; },): Promise<void> {
  for (const character of text) {
    await tap({ device, key: character === ' ' ? 'space' : character, hold: 10, },);
    await sleep({ milliseconds: 20, },);
  }
}

/** Holds `modifier` while tapping `key`. */
export async function chord(
  { device, modifier, key, }: { readonly device: UinputDevice; readonly modifier: string; readonly key: string; },
): Promise<void> {
  device.emit({ type: EV_KEY, code: KEYS[modifier] ?? 0, value: 1, },);
  await sleep({ milliseconds: 30, },);
  await tap({ device, key, },);
  await sleep({ milliseconds: 30, },);
  device.emit({ type: EV_KEY, code: KEYS[modifier] ?? 0, value: 0, },);
}

/** Output size in logical pixels, from `wlr-randr --json`. */
export async function outputSize(
  { environment, }: { readonly environment: Readonly<Record<string, string>>; },
): Promise<{ readonly width: number; readonly height: number; }> {
  const output = await new Deno.Command('wlr-randr', { args: ['--json',], env: { ...environment, }, stdout: 'piped', },).output();
  const outputs: { modes: { width: number; height: number; current: boolean; }[]; scale: number; }[] = JSON.parse(
    new TextDecoder().decode(output.stdout,),
  );
  const first = outputs[0];
  const mode = first?.modes.find((candidate,) => candidate.current);
  if (first === undefined || mode === undefined) {
    throw new UinputSetupError('wlr-randr reported no current output mode',);
  }
  return { width: mode.width / first.scale, height: mode.height / first.scale, };
}

/** Moves the absolute pointer to logical `x`, `y` on the single output. */
export function movePointer(
  { pointer, x, y, size, }: {
    readonly pointer: UinputDevice;
    readonly x: number;
    readonly y: number;
    readonly size: { readonly width: number; readonly height: number; };
  },
): void {
  pointer.emit({ type: EV_ABS, code: ABS_X, value: Math.round((x / size.width) * ABSOLUTE_MAXIMUM,), },);
  pointer.emit({ type: EV_ABS, code: ABS_Y, value: Math.round((y / size.height) * ABSOLUTE_MAXIMUM,), },);
}

/** Releases the libc handle so the process can exit. */
export function closeLibc(): void {
  libc.close();
}
