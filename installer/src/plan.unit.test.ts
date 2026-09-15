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
  ],
},);
