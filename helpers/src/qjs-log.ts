/**
 Tagged logging for QuickJS-ng helpers.

 `@monochromatic-dev/module-logger` 0.4.0 does not run on QuickJS-ng 0.16.2:
 `console.warn` and `console.error` are undefined there,
 no sink verifies,
 and bundling it added about 2.3 ms to every helper start in the VM.
 This logger keeps the same `tagged({ tag, l, })` shape and line format and writes to standard error,
 which the systemd journal records for UWSM-launched programs.

 @module
 */

/// <reference path="./qjs.d.ts" />

import * as std from 'qjs:std';

/** Severity names in the module-logger line format. */
type Level = 'info' | 'warn' | 'error';

/** A tagged logger. */
export type QjsLogger = {
  /** Logs routine progress. */
  readonly info: (message: string,) => void;
  /** Logs a recoverable problem. */
  readonly warn: (message: string,) => void;
  /** Logs a failure. */
  readonly error: (message: string,) => void;
};

/** Writes one line to standard error. */
function write({ level, tags, message, }: { readonly level: Level; readonly tags: string; readonly message: string; },): void {
  std.err.puts(`[${level}] [${new Date().toISOString()}] ${tags} ${message}\n`,);
  std.err.flush();
}

/**
 Creates a logger that prefixes every line with `[tag]`, after any parent's tags.

 @param tag - usually the calling function's `name`
 @param l - parent logger whose tags come first
 @returns a logger writing to standard error
 */
export function tagged({ tag, l, }: { readonly tag: string; readonly l?: QjsLogger & { readonly tags?: string; }; },): QjsLogger & {
  readonly tags: string;
} {
  const tags = `${l?.tags === undefined ? '' : `${l.tags} `}[${tag}]`;
  return {
    tags,
    info: (message,) => write({ level: 'info', tags, message, },),
    warn: (message,) => write({ level: 'warn', tags, message, },),
    error: (message,) => write({ level: 'error', tags, message, },),
  };
}
