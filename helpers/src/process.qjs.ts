/**
 Runs programs and pipelines from QuickJS-ng without a shell.

 @module
 */

/// <reference path="./qjs.d.ts" />

import * as os from 'qjs:os';

import {
  decodeUtf8,
  encodeUtf8,
} from './utf8.ts';

/** Thrown when a pipe cannot be created. */
export class PipeError extends Error {
  /**
   @param message - which pipe failed
   */
  constructor(message: string,) {
    super(message,);
    this.name = PipeError.name;
  }
}

/** Result of a pipeline. */
export type PipelineResult = {
  /** Exit status of each command in order; 128 plus the signal number for a killed command. */
  readonly statuses: readonly number[];
  /** Standard output of the last command when captured, otherwise empty. */
  readonly output: string;
};

/** Creates a pipe or throws. */
function createPipe({ purpose, }: { readonly purpose: string; },): [number, number,] {
  const created = os.pipe();
  if (created === null) {
    throw new PipeError(`creating a pipe for ${purpose} failed`,);
  }
  return created;
}

/** Converts a raw wait status into a shell-style exit status. */
function exitStatus({ rawStatus, }: { readonly rawStatus: number; },): number {
  const signal = rawStatus & 0x7f;
  return signal === 0 ? (rawStatus >> 8) & 0xff : 128 + signal;
}

/** Writes all of `text` to `fd` as UTF-8. */
function writeAll({ fd, text, }: { readonly fd: number; readonly text: string; },): void {
  const bytes = encodeUtf8(text,);
  let offset = 0;
  while (offset < bytes.length) {
    const written = os.write(fd, bytes.buffer as ArrayBuffer, bytes.byteOffset + offset, bytes.length - offset,);
    if (written <= 0) {
      return;
    }
    offset += written;
  }
}

/** Reads `fd` to end of file as UTF-8. */
function readAll({ fd, }: { readonly fd: number; },): string {
  const chunks: Uint8Array[] = [];
  const buffer = new ArrayBuffer(65536,);
  for (;;) {
    const count = os.read(fd, buffer, 0, buffer.byteLength,);
    if (count <= 0) {
      break;
    }
    chunks.push(new Uint8Array(buffer.slice(0, count,),),);
  }
  const total = chunks.reduce((sum, chunk,) => sum + chunk.length, 0,);
  const joined = new Uint8Array(total,);
  chunks.reduce((offset, chunk,) => {
    joined.set(chunk, offset,);
    return offset + chunk.length;
  }, 0,);
  return decodeUtf8(joined,);
}

/**
 Runs commands with each one's standard output feeding the next one's standard input.

 `input`, when given, is written to the first command after every command has started,
 so it must be small enough not to fill a pipe before the command reads it,
 or the command must read all input before writing much output.

 @param commands - argument vectors, looked up on `PATH`
 @param input - text for the first command's standard input; the command inherits it when omitted
 @param stdinFd - descriptor for the first command's standard input, used instead of `input`
 @param captureOutput - whether to return the last command's standard output instead of inheriting it
 @returns exit statuses and captured output
 */
export function runPipeline(
  { commands, input, stdinFd, captureOutput = false, }: {
    readonly commands: readonly (readonly string[])[];
    readonly input?: string;
    readonly stdinFd?: number;
    readonly captureOutput?: boolean;
  },
): PipelineResult {
  const inputPipe = input === undefined ? undefined : createPipe({ purpose: 'pipeline input', },);
  let previousRead = inputPipe?.[0] ?? stdinFd;
  let outputRead: number | undefined;
  const pids = commands.map((argv, index,) => {
    const last = index === commands.length - 1;
    const connection = last ? (captureOutput ? createPipe({ purpose: 'captured output', },) : undefined) : createPipe({
      purpose: `${argv[0]} output`,
    },);
    const pid = os.exec(argv, {
      block: false,
      ...(previousRead === undefined ? {} : { stdin: previousRead, }),
      ...(connection === undefined ? {} : { stdout: connection[1], }),
    },);
    if (previousRead !== undefined && previousRead !== stdinFd) {
      os.close(previousRead,);
    }
    if (connection !== undefined) {
      os.close(connection[1],);
    }
    previousRead = connection?.[0];
    if (last) {
      outputRead = connection?.[0];
    }
    return pid;
  },);
  if (inputPipe !== undefined && input !== undefined) {
    writeAll({ fd: inputPipe[1], text: input, },);
    os.close(inputPipe[1],);
  }
  const output = outputRead === undefined ? '' : readAll({ fd: outputRead, },);
  if (outputRead !== undefined) {
    os.close(outputRead,);
  }
  const statuses = pids.map((pid,) => exitStatus({ rawStatus: os.waitpid(pid, 0,)[1], },));
  return { statuses, output, };
}
