/**
 A `Shell` that records calls instead of changing the system, for installer tests.

 @module
 */

import type {
  Command,
  FileWrite,
  Shell,
} from './shell.ts';

/** One recorded shell call, in call order. */
export type RecordedCall =
  | { readonly kind: 'run' | 'capture'; readonly command: Command; }
  | { readonly kind: 'writeFile'; readonly file: FileWrite; };

/** Recording shell plus the calls it has seen. */
export type RecordingShell = {
  /** Shell to pass to the code under test. */
  readonly shell: Shell;
  /** Calls in order; grows as the code under test runs. */
  readonly calls: readonly RecordedCall[];
};

/**
 Creates a recording shell.

 @param captures - standard output to return for each captured command, keyed by its arguments joined with spaces
 @param files - content returned by `readFile`, keyed by path, standing in for files the live system already has
 @returns shell and the calls it records
 @example
 ```ts
 const { shell, calls, } = createRecordingShell({ captures: { 'blkid': 'uuid\n', }, files: {}, },);
 ```
 */
export function createRecordingShell({ captures, files, }: {
  readonly captures: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
},): RecordingShell {
  const calls: RecordedCall[] = [];
  const written: Record<string, string> = {};
  return {
    calls,
    shell: {
      run: async (command,) => {
        calls.push({ kind: 'run', command, },);
      },
      capture: async (command,) => {
        calls.push({ kind: 'capture', command, },);
        return captures[command.argv.join(' ',)] ?? '';
      },
      writeFile: async (file,) => {
        calls.push({ kind: 'writeFile', file, },);
        written[file.path] = file.content;
      },
      // A file written earlier in the test wins over the live system's copy, as it would on disk.
      readFile: async (path,) => written[path] ?? files[path] ?? '',
    },
  };
}

/**
 Lists the argument vectors of recorded commands.

 @param calls - recorded calls
 @returns argv of every run and capture in order, so tests match commands without depending on descriptions
 @example
 ```ts
 const argvs = commandsOf(calls,);
 ```
 */
export function commandsOf(calls: readonly RecordedCall[],): readonly (readonly string[])[] {
  return calls.flatMap((call,) => call.kind === 'writeFile' ? [] : [call.command.argv,]);
}

/**
 Finds the last write to a path.

 @param calls - recorded calls
 @param path - absolute path
 @returns written content, or undefined when the path was never written
 @example
 ```ts
 const fstab = writtenFile({ calls, path: '/mnt/etc/fstab', },);
 ```
 */
export function writtenFile({ calls, path, }: {
  readonly calls: readonly RecordedCall[];
  readonly path: string;
},): FileWrite | undefined {
  return calls.flatMap((call,) => call.kind === 'writeFile' && call.file.path === path ? [call.file,] : []).at(-1,);
}
