/**
 Turns a machine description into the ordered steps that install it.

 Planning is pure:
 it runs no commands and reads no secrets,
 so every decision about the installed system can be tested before a disk is touched.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import type { Machine, } from './machine.ts';

/** A command run in the live environment. */
export type RunStep = {
  /** Discriminant. */
  readonly kind: 'run';
  /** What the step achieves, shown before it runs. */
  readonly description: string;
  /** Program and arguments, run without a shell. */
  readonly argv: readonly string[];
};

/** One unit of installation work. */
export type InstallStep = RunStep;

/** Mount point of the Btrfs top level while subvolumes are created. */
const TOP_LEVEL_MOUNT = '/mnt';

/**
 Subvolumes created on the root filesystem.

 Only `@` is snapshotted.
 `/home`,
 `/root`,
 and `/srv` are plain directories inside it,
 so every snapshot of `/` is a coupled root and home pair.
 The others hold regenerable data or logs that must survive a rollback.
 */
export const SUBVOLUMES = ['@', '@cache', '@log', '@tmp',] as const;

/**
 Plans a complete installation.

 @param machine - target description; secrets are supplied when the plan is executed
 @returns steps in execution order
 @example
 ```ts
 const steps = planInstall({ machine, },);
 ```
 */
export function planInstall({ machine, }: { readonly machine: Machine; },): readonly InstallStep[] {
  const l = tagged({ tag: planInstall.name, },);
  l.info(`planning ${machine.platform} install for ${machine.hostname}`,);
  return SUBVOLUMES.map((subvolume,): InstallStep => ({
    kind: 'run',
    description: `create Btrfs subvolume ${subvolume}`,
    argv: ['btrfs', 'subvolume', 'create', `${TOP_LEVEL_MOUNT}/${subvolume}`,],
  }));
}
