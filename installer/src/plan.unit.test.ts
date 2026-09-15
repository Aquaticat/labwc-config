/**
 Tests for `planInstall`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import type { Machine, } from './machine.ts';
import {
  type InstallStep,
  planInstall,
} from './plan.ts';

/** A physical desktop matching the 2026-09-14 decisions. */
const DESKTOP: Machine = {
  targetDisk: '/dev/disk/by-id/nvme-SPCC_M.2_PCIe_SSD_EXAMPLE',
  hostname: 'desktop',
  username: 'user',
  timezone: 'America/New_York',
  platform: 'physical',
};

/**
 Collects the argument vectors of every command step.

 @param steps - plan under inspection
 @returns argv arrays in plan order, so tests can match commands without depending on descriptions
 */
function commands(steps: readonly InstallStep[],): readonly (readonly string[])[] {
  return steps.flatMap((step,) => step.kind === 'run' ? [step.argv,] : []);
}

await describe({
  name: planInstall.name,
  children: [
    it({
      name: 'creates only @, @cache, @log, and @tmp so home rolls back with root',
      fn: async () => {
        const created = commands(planInstall({ machine: DESKTOP, },),)
          .filter((argv,) => argv[0] === 'btrfs' && argv[1] === 'subvolume' && argv[2] === 'create')
          .map((argv,) => argv[3]);
        expect(created,).toEqual(['/mnt/@', '/mnt/@cache', '/mnt/@log', '/mnt/@tmp',],);
      },
    },),
    it({
      name: 'mounts @ as the root and the unsnapshotted subvolumes under /var, never on /home',
      fn: async () => {
        const subvolumeMounts = commands(planInstall({ machine: DESKTOP, },),)
          .filter((argv,) => argv[0] === 'mount' && argv.some((argument,) => argument.includes('subvol=',)))
          .map((argv,) => [argv.find((argument,) => argument.includes('subvol=',)), argv.at(-1,),]);
        expect(subvolumeMounts,).toEqual([
          ['noatime,compress=zstd,discard=async,subvol=/@', '/mnt',],
          ['noatime,compress=zstd,discard=async,subvol=/@cache', '/mnt/var/cache',],
          ['noatime,compress=zstd,discard=async,subvol=/@log', '/mnt/var/log',],
          ['noatime,compress=zstd,discard=async,subvol=/@tmp', '/mnt/var/tmp',],
        ],);
      },
    },),
  ],
},);
