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

/** Opened LUKS mapping that holds the root Btrfs filesystem. */
const ROOT_MAPPER = '/dev/mapper/root';

/** Mount options shared by every root subvolume. */
const BTRFS_OPTIONS = 'noatime,compress=zstd,discard=async';

/** Where each unsnapshotted subvolume is mounted inside the installed root. */
const DETACHED_MOUNTS: Readonly<Record<Exclude<typeof SUBVOLUMES[number], '@'>, string>> = {
  '@cache': '/var/cache',
  '@log': '/var/log',
  '@tmp': '/var/tmp',
};

/**
 Builds a command step.

 @param description - what the command achieves, shown before it runs
 @param argv - program and arguments, run without a shell
 @returns the step, so plans read as lists of commands
 @example
 ```ts
 run({ description: 'unmount', argv: ['umount', '/mnt',], },);
 ```
 */
function run({ description, argv, }: { readonly description: string; readonly argv: readonly string[]; },): RunStep {
  return { kind: 'run', description, argv, };
}

/**
 Plans subvolume creation on the Btrfs top level and the final mount layout under `/mnt`.

 @returns steps that leave the target root mounted at `/mnt` with every unsnapshotted subvolume in place
 @example
 ```ts
 const steps = planSubvolumes();
 ```
 */
function planSubvolumes(): readonly InstallStep[] {
  const detached = Object.entries(DETACHED_MOUNTS,);
  return [
    ...SUBVOLUMES.map((subvolume,) =>
      run({
        description: `create Btrfs subvolume ${subvolume}`,
        argv: ['btrfs', 'subvolume', 'create', `${TOP_LEVEL_MOUNT}/${subvolume}`,],
      },)
    ),
    run({ description: 'unmount the Btrfs top level', argv: ['umount', TOP_LEVEL_MOUNT,], },),
    run({
      description: 'mount @ as the installed root',
      argv: ['mount', '--options', `${BTRFS_OPTIONS},subvol=/@`, ROOT_MAPPER, TOP_LEVEL_MOUNT,],
    },),
    run({
      description: 'create mount points for the unsnapshotted subvolumes',
      argv: ['mkdir', '--parents', ...detached.map(([, path,],) => `${TOP_LEVEL_MOUNT}${path}`),],
    },),
    ...detached.map(([subvolume, path,],) =>
      run({
        description: `mount ${subvolume} at ${path}`,
        argv: ['mount', '--options', `${BTRFS_OPTIONS},subvol=/${subvolume}`, ROOT_MAPPER, `${TOP_LEVEL_MOUNT}${path}`,],
      },)
    ),
  ];
}

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
  return planSubvolumes();
}
