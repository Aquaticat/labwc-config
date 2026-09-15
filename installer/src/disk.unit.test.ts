/**
 Tests for `prepareDisk`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import { UnsafeTargetDiskError, } from './disk-guard.ts';
import { prepareDisk, } from './disk.ts';
import {
  commandsOf,
  createRecordingShell,
} from './recording-shell.ts';
import { DESKTOP, } from './test-machines.ts';

/** Kernel node the desktop's by-id link resolves to. */
const KERNEL_DISK = '/dev/nvme0n1';

/** LUKS UUID the caller generated. */
const LUKS_UUID = '5c2a603a-ef77-4208-b676-4ed044a00e04';

/** Temporary passphrase that must never appear in an argument vector. */
const PASSPHRASE = 'correct horse battery staple';

/**
 Builds the `lsblk` answer for the desktop disk.

 @param mountpoint - where the second partition is mounted, or null for an idle disk
 @returns captures for a recording shell
 @example
 ```ts
 const captures = diskCaptures({ mountpoint: null, },);
 ```
 */
function diskCaptures({ mountpoint, }: { readonly mountpoint: string | null; },): Record<string, string> {
  return {
    [`readlink --canonicalize-existing ${DESKTOP.targetDisk}`]: `${KERNEL_DISK}\n`,
    [`lsblk --json --output PATH,TYPE,MOUNTPOINTS`]: JSON.stringify({
      blockdevices: [{
        path: KERNEL_DISK,
        type: 'disk',
        mountpoints: [null,],
        children: [
          { path: `${KERNEL_DISK}p1`, type: 'part', mountpoints: [null,], },
          { path: `${KERNEL_DISK}p2`, type: 'part', mountpoints: [mountpoint,], },
        ],
      },],
    },),
  };
}

/**
 Runs `prepareDisk` against a recording shell.

 @param mountpoint - mount state of the target's second partition
 @returns recorded calls
 @example
 ```ts
 const calls = await prepare({ mountpoint: null, },);
 ```
 */
async function prepare({ mountpoint, }: { readonly mountpoint: string | null; },) {
  const recording = createRecordingShell({ captures: diskCaptures({ mountpoint, },), files: {}, },);
  await prepareDisk({ machine: DESKTOP, shell: recording.shell, luksPassphrase: PASSPHRASE, luksUuid: LUKS_UUID, },);
  return recording.calls;
}

await describe({
  name: prepareDisk.name,
  children: [
    it({
      name: 'refuses a disk in use before running any command that writes to it',
      fn: async () => {
        const recording = createRecordingShell({
          captures: diskCaptures({ mountpoint: '/run/archiso/bootmnt', },),
          files: {},
        },);
        await expect(prepareDisk({
          machine: DESKTOP,
          shell: recording.shell,
          luksPassphrase: PASSPHRASE,
          luksUuid: LUKS_UUID,
        },),).rejects.toThrow(UnsafeTargetDiskError,);
        expect(recording.calls.every((call,) => call.kind === 'capture'),).toEqual(true,);
      },
    },),
    it({
      name: 'partitions a 4 GiB ESP and a LUKS partition on the by-id link',
      fn: async () => {
        const argvs = commandsOf(await prepare({ mountpoint: null, },),);
        expect(argvs,).toContainEqual([
          'sgdisk',
          '--new=1:0:+4G',
          '--typecode=1:ef00',
          '--change-name=1:ESP',
          '--new=2:0:0',
          '--typecode=2:8309',
          '--change-name=2:cryptroot',
          DESKTOP.targetDisk,
        ],);
        expect(argvs,).toContainEqual(['mkfs.fat', '-F', '32', '-n', 'ESP', `${DESKTOP.targetDisk}-part1`,],);
      },
    },),
    it({
      name: 'formats LUKS2 with the given UUID and passes the passphrase only on standard input',
      fn: async () => {
        const calls = await prepare({ mountpoint: null, },);
        const luks = calls.flatMap((call,) =>
          call.kind !== 'writeFile' && call.command.argv[0] === 'cryptsetup' ? [call.command,] : []
        );
        expect(luks.map((command,) => command.argv),).toEqual([
          [
            'cryptsetup',
            'luksFormat',
            '--type',
            'luks2',
            '--batch-mode',
            '--label',
            'cryptroot',
            `--uuid=${LUKS_UUID}`,
            '--key-file=-',
            `${DESKTOP.targetDisk}-part2`,
          ],
          [
            'cryptsetup',
            'open',
            '--allow-discards',
            '--persistent',
            '--key-file=-',
            `${DESKTOP.targetDisk}-part2`,
            'labwc-config-target',
          ],
        ],);
        expect(luks.map((command,) => command.stdin),).toEqual([PASSPHRASE, PASSPHRASE,],);
        expect(commandsOf(calls,).flat().some((argument,) => argument.includes(PASSPHRASE,)),).toEqual(false,);
      },
    },),
    it({
      name: 'creates only @, @cache, @log, and @tmp so home rolls back with root',
      fn: async () => {
        const created = commandsOf(await prepare({ mountpoint: null, },),)
          .filter((argv,) => argv[0] === 'btrfs' && argv[1] === 'subvolume' && argv[2] === 'create')
          .map((argv,) => argv[3]);
        expect(created,).toEqual(['/mnt/@', '/mnt/@cache', '/mnt/@log', '/mnt/@tmp',],);
      },
    },),
    it({
      name: 'mounts @ as the root, the other subvolumes under /var, and the ESP at /boot readable only by root',
      fn: async () => {
        const mounts = commandsOf(await prepare({ mountpoint: null, },),)
          .filter((argv,) => argv[0] === 'mount' && argv.length === 5)
          .map((argv,) => [argv[2], argv[4],]);
        expect(mounts,).toEqual([
          ['noatime,compress=zstd,discard=async,subvol=/@', '/mnt',],
          ['noatime,compress=zstd,discard=async,subvol=/@cache', '/mnt/var/cache',],
          ['noatime,compress=zstd,discard=async,subvol=/@log', '/mnt/var/log',],
          ['noatime,compress=zstd,discard=async,subvol=/@tmp', '/mnt/var/tmp',],
          ['umask=0077', '/mnt/boot',],
        ],);
      },
    },),
  ],
},);
