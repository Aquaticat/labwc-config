/**
 Tests for `installBase`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  installBase,
  kernelCommandLine,
  packagesFor,
} from './base.ts';
import type { Machine, } from './machine.ts';
import {
  commandsOf,
  createRecordingShell,
  type RecordedCall,
  writtenFile,
} from './recording-shell.ts';
import {
  DESKTOP,
  REHEARSAL,
} from './test-machines.ts';

/** LUKS UUID the caller generated. */
const LUKS_UUID = '5c2a603a-ef77-4208-b676-4ed044a00e04';

/**
 Runs `installBase` against a recording shell.

 @param machine - target description
 @returns recorded calls
 @example
 ```ts
 const calls = await install(DESKTOP,);
 ```
 */
async function install(machine: Machine,): Promise<readonly RecordedCall[]> {
  const recording = createRecordingShell({
    captures: { 'genfstab -U /mnt': 'UUID=abc / btrfs rw 0 0\n\n', },
    files: { '/tmp/pacman.target.conf': '[options]\nArchitecture = auto\n', },
  },);
  await installBase({ machine, shell: recording.shell, luksUuid: LUKS_UUID, },);
  return recording.calls;
}

/**
 Finds the position of the first call matching a predicate.

 @param calls - recorded calls
 @param matches - predicate over a call
 @returns index, or -1 when absent
 @example
 ```ts
 const index = indexOf({ calls, matches: (call,) => call.kind === 'writeFile', },);
 ```
 */
function indexOf({ calls, matches, }: {
  readonly calls: readonly RecordedCall[];
  readonly matches: (call: RecordedCall,) => boolean;
},): number {
  return calls.findIndex(matches,);
}

await describe({
  name: installBase.name,
  children: [
    it({
      name: 'requires signatures from the session repository in the target pacman.conf',
      fn: async () => {
        const calls = await install(DESKTOP,);
        expect(writtenFile({ calls, path: '/mnt/etc/pacman.conf', },)?.content,).toEqual(
          `[options]\nArchitecture = auto\n\n[labwc-config]\nSigLevel = Required\nServer = ${DESKTOP.repository.server}\n`,
        );
      },
    },),
    it({
      name: 'installs from a system whose pacman.conf already has optimized repositories and a session repository',
      fn: async () => {
        const recording = createRecordingShell({
          captures: { 'genfstab -U /mnt': '', },
          files: {
            '/tmp/pacman.target.conf':
              '[options]\n\n[cachyos-znver4]\nInclude = /etc/pacman.d/cachyos-v4-mirrorlist\n\n[labwc-config]\nSigLevel = Required\nServer = file:///old\n\n[core]\nInclude = /etc/pacman.d/mirrorlist\n',
          },
        },);
        await installBase({ machine: DESKTOP, shell: recording.shell, luksUuid: LUKS_UUID, },);
        expect(commandsOf(recording.calls,).some((argv,) => argv.includes('/etc/calamares/scripts/detect-architecture',)),)
          .toEqual(false,);
        expect(writtenFile({ calls: recording.calls, path: '/mnt/etc/pacman.conf', },)?.content,).toEqual(
          `[options]\n\n[cachyos-znver4]\nInclude = /etc/pacman.d/cachyos-v4-mirrorlist\n\n[core]\nInclude = /etc/pacman.d/mirrorlist\n\n[labwc-config]\nSigLevel = Required\nServer = ${DESKTOP.repository.server}\n`,
        );
      },
    },),
    it({
      name: 'enables CPU-optimized repositories on a live system that has none',
      fn: async () => {
        expect(commandsOf(await install(DESKTOP,),),).toContainEqual([
          'bash',
          '/etc/calamares/scripts/detect-architecture',
          '/tmp/pacman.target.conf',
        ],);
      },
    },),
    it({
      name: 'writes the kernel command line with the LUKS UUID before pacstrap runs the boot hooks',
      fn: async () => {
        const calls = await install(DESKTOP,);
        const cmdline = indexOf({
          calls,
          matches: (call,) => call.kind === 'writeFile' && call.file.path === '/mnt/etc/kernel/cmdline',
        },);
        const pacstrap = indexOf({ calls, matches: (call,) => call.kind === 'run' && call.command.argv[0] === 'pacstrap', },);
        expect(cmdline >= 0 && cmdline < pacstrap,).toEqual(true,);
        expect(kernelCommandLine(LUKS_UUID,),).toEqual(
          `rd.luks.name=${LUKS_UUID}=root rd.luks.options=tpm2-device=auto root=/dev/mapper/root rootflags=subvol=/@ rw quiet nowatchdog`,
        );
      },
    },),
    it({
      name: 'installs firmware on the desktop, guest drivers and shim only in Hyper-V, and SSH only with a key',
      fn: async () => {
        const desktop = packagesFor(DESKTOP,);
        const rehearsal = packagesFor(REHEARSAL,);
        expect(desktop,).toContain('linux-firmware',);
        expect(desktop,).not.toContain('hyperv',);
        expect(desktop,).not.toContain('shim-signed',);
        expect(desktop,).not.toContain('openssh',);
        expect(rehearsal,).toContain('hyperv',);
        expect(rehearsal,).toContain('shim-signed',);
        expect(rehearsal,).toContain('openssh',);
        expect(desktop,).toContain('labwc-config',);
      },
    },),
    it({
      name: 'loads Hyper-V storage and keyboard drivers into the initramfs only for the guest',
      fn: async () => {
        const desktop = writtenFile({ calls: await install(DESKTOP,), path: '/mnt/etc/mkinitcpio.conf.d/00-luks.conf', },);
        const rehearsal = writtenFile({
          calls: await install(REHEARSAL,),
          path: '/mnt/etc/mkinitcpio.conf.d/00-luks.conf',
        },);
        expect(desktop?.content,).toContain('MODULES=()\n',);
        expect(rehearsal?.content,).toContain('MODULES=(hv_vmbus hv_storvsc hyperv_keyboard)\n',);
        expect(desktop?.content,).toContain(' sd-encrypt ',);
      },
    },),
    it({
      name: 'appends a RAM-backed /tmp to the generated fstab',
      fn: async () => {
        const calls = await install(DESKTOP,);
        expect(commandsOf(calls,),).toContainEqual(['genfstab', '-U', '/mnt',],);
        expect(writtenFile({ calls, path: '/mnt/etc/fstab', },)?.content,).toEqual(
          'UUID=abc / btrfs rw 0 0\ntmpfs /tmp tmpfs defaults,noatime,mode=1777 0 0\n',
        );
      },
    },),
  ],
},);
