/**
 Tests for `assertTargetDisk`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import { assertTargetDisk, } from './disk-guard.ts';

/** `lsblk --json` output for an unmounted NVMe with two partitions. */
const IDLE_NVME = {
  blockdevices: [{
    path: '/dev/nvme0n1',
    type: 'disk',
    mountpoints: [null,],
    children: [
      { path: '/dev/nvme0n1p1', type: 'part', mountpoints: [null,], },
      { path: '/dev/nvme0n1p2', type: 'part', mountpoints: [null,], },
    ],
  },],
} as const;

await describe({
  name: assertTargetDisk.name,
  children: [
    it({
      name: 'accepts an unmounted disk',
      fn: async () => {
        expect(assertTargetDisk({ lsblk: IDLE_NVME, devicePath: '/dev/nvme0n1', },),).toBe('/dev/nvme0n1',);
      },
    },),
    it({
      name: 'refuses a disk whose partition is mounted',
      fn: async () => {
        const mounted = {
          blockdevices: [{
            ...IDLE_NVME.blockdevices[0],
            children: [
              IDLE_NVME.blockdevices[0].children[0],
              { path: '/dev/nvme0n1p2', type: 'part', mountpoints: ['/run/archiso/bootmnt',], },
            ],
          },],
        };
        expect(() => assertTargetDisk({ lsblk: mounted, devicePath: '/dev/nvme0n1', },)).toThrow(
          '/dev/nvme0n1p2 is mounted at /run/archiso/bootmnt',
        );
      },
    },),
  ],
},);
