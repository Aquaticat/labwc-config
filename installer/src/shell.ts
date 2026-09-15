/**
 Runs the installer's commands and file writes.

 Installation steps call a `Shell` directly instead of returning step descriptions,
 so tests pass a recording shell and production passes `createSystemShell`.
 Secrets reach commands only through standard input or the environment,
 never through arguments,
 which other users can read in `/proc`.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

/** Mount point of the installed system while the live environment configures it. */
export const TARGET_ROOT = '/mnt';

/** A command to run without a shell. */
export type Command = {
  /** What the command achieves, logged before it runs. */
  readonly description: string;
  /** Program and arguments. */
  readonly argv: readonly string[];
  /** Text written to the command's standard input, such as a passphrase. */
  readonly stdin?: string;
  /** Variables added to the command's environment, such as systemd-cryptenroll's `PASSWORD`. */
  readonly environment?: Readonly<Record<string, string>>;
};

/** A file to create or replace. */
export type FileWrite = {
  /** What the file configures, logged before it is written. */
  readonly description: string;
  /** Absolute path, including `TARGET_ROOT` when the file belongs to the installed system. */
  readonly path: string;
  /** Complete file content. */
  readonly content: string;
  /** Permission bits, such as `0o644`. */
  readonly mode: number;
};

/** Side effects the installer performs. */
export type Shell = {
  /** Runs a command and throws when it fails. */
  readonly run: (command: Command,) => Promise<void>;
  /** Runs a command and returns its standard output; throws when it fails. */
  readonly capture: (command: Command,) => Promise<string>;
  /** Writes a file, creating parent directories. */
  readonly writeFile: (file: FileWrite,) => Promise<void>;
  /** Reads a file that already exists. */
  readonly readFile: (path: string,) => Promise<string>;
};

/** Thrown when a command exits unsuccessfully. */
export class CommandFailedError extends Error {
  /**
   @param message - the failed command and its exit code
   */
  constructor(message: string,) {
    super(message,);
    this.name = CommandFailedError.name;
  }
}

/**
 Prefixes a command so it runs inside the installed system.

 @param argv - program and arguments as the installed system would run them
 @returns `arch-chroot` invocation, so installed-system commands read as ordinary commands
 @example
 ```ts
 await shell.run({ description: 'generate locales', argv: inTarget(['locale-gen',],), },);
 ```
 */
export function inTarget(argv: readonly string[],): readonly string[] {
  return ['arch-chroot', TARGET_ROOT, ...argv,];
}

/**
 Starts a command and feeds its standard input.

 @param command - command to run
 @param stdout - whether standard output is captured or shown
 @returns exit status and captured output
 @throws {CommandFailedError} when the command exits unsuccessfully
 @example
 ```ts
 const output = await execute({ command, stdout: 'piped', },);
 ```
 */
async function execute({ command, stdout, }: {
  readonly command: Command;
  readonly stdout: 'piped' | 'inherit';
},): Promise<string> {
  const l = tagged({ tag: execute.name, },);
  const [program, ...args] = command.argv;
  if (program === undefined) {
    throw new CommandFailedError(`${command.description}: empty command`,);
  }
  l.info(`${command.description}: ${command.argv.join(' ',)}`,);
  const child = new Deno.Command(program, {
    args,
    stdin: command.stdin === undefined ? 'null' : 'piped',
    stdout,
    stderr: 'inherit',
    env: { ...command.environment, },
  },).spawn();
  if (command.stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(command.stdin,),);
    await writer.close();
  }
  const result = await child.output();
  if (!result.success) {
    l.error(`${command.description} failed with exit code ${result.code}`,);
    throw new CommandFailedError(`${command.description}: ${program} exited with code ${result.code}`,);
  }
  return new TextDecoder().decode(result.stdout,);
}

/**
 Creates the shell that changes the real system.

 @returns shell backed by `Deno.Command` and the file system
 @example
 ```ts
 const shell = createSystemShell();
 ```
 */
export function createSystemShell(): Shell {
  const l = tagged({ tag: createSystemShell.name, },);
  return {
    run: async (command,) => {
      await execute({ command, stdout: 'inherit', },);
    },
    capture: async (command,) => await execute({ command, stdout: 'piped', },),
    writeFile: async (file,) => {
      l.info(`${file.description}: writing ${file.path}`,);
      const parent = file.path.slice(0, file.path.lastIndexOf('/',),);
      await Deno.mkdir(parent, { recursive: true, },);
      await Deno.writeTextFile(file.path, file.content, { mode: file.mode, },);
      // writeTextFile applies the mode only when it creates the file.
      await Deno.chmod(file.path, file.mode,);
    },
    readFile: async (path,) => await Deno.readTextFile(path,),
  };
}
