/**
 Type declarations for the QuickJS-ng 0.16 built-in modules the helpers use.

 Only the members the helpers call are declared,
 with signatures taken from QuickJS-ng's `quickjs-libc.c`.

 @module
 */

declare module 'qjs:os' {
  /** Options accepted by `exec`. */
  export type ExecOptions = {
    /** Wait for the child and return its exit status; when false, return its process ID. Defaults to true. */
    readonly block?: boolean;
    /** Search `PATH` for the program. Defaults to true. */
    readonly usePath?: boolean;
    /** Descriptor to use as the child's standard input. */
    readonly stdin?: number;
    /** Descriptor to use as the child's standard output. */
    readonly stdout?: number;
    /** Descriptor to use as the child's standard error. */
    readonly stderr?: number;
  };
  /** Starts a program; the child closes every descriptor above 2 before exec. */
  export function exec(args: readonly string[], options?: ExecOptions,): number;
  /** Creates a pipe and returns `[readDescriptor, writeDescriptor]`, or `null` on failure. */
  export function pipe(): [number, number,] | null;
  /** Closes a descriptor. */
  export function close(fd: number,): number;
  /** Reads into `buffer`; returns the byte count, 0 at end of file, or a negative errno. */
  export function read(fd: number, buffer: ArrayBuffer, offset: number, length: number,): number;
  /** Writes from `buffer`; returns the byte count or a negative errno. */
  export function write(fd: number, buffer: ArrayBuffer, offset: number, length: number,): number;
  /** Waits for a child and returns `[pid, rawWaitStatus]`. */
  export function waitpid(pid: number, options: number,): [number, number,];
  /** Opens a file and returns its descriptor or a negative errno. */
  export function open(filename: string, flags: number, mode?: number,): number;
  /** Creates a directory; returns 0 or a negative errno. */
  export function mkdir(path: string, mode?: number,): number;
  /** Open for reading only. */
  export const O_RDONLY: number;
}

declare module 'qjs:std' {
  /** A C stdio stream. */
  export type FILE = {
    /** Writes a string. */
    puts(text: string,): void;
    /** Flushes buffered output. */
    flush(): void;
  };
  /** Reads an environment variable. */
  export function getenv(name: string,): string | undefined;
  /** Reads a whole file as text, or returns `null` when it cannot be read. */
  export function loadFile(filename: string,): string | null;
  /** Exits the process. */
  export function exit(code: number,): never;
  /** Standard error. */
  export const err: FILE;
}
