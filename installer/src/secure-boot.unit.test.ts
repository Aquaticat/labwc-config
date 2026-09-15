/**
 Tests for the Secure Boot chain.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import type { Machine, } from './machine.ts';
import {
  commandsOf,
  createRecordingShell,
  type RecordedCall,
  writtenFile,
} from './recording-shell.ts';
import {
  assertReadyForSecureBoot,
  configureSecureBoot,
  mokHashFrom,
  SecureBootStateError,
} from './secure-boot.ts';
import {
  DESKTOP,
  REHEARSAL,
} from './test-machines.ts';

/** One-time MOK password that must stay out of argument vectors and the final file system. */
const MOK_PASSWORD = 'mok-secret-5e21';

/** Hook contents standing in for the real scripts. */
const HOOKS = { sbatBuilder: '#!sbat\n', limineCopy: '#!copy\n', } as const;

/**
 Runs `configureSecureBoot` against a recording shell.

 @param machine - target description
 @returns recorded calls
 @example
 ```ts
 const calls = await configure(REHEARSAL,);
 ```
 */
async function configure(machine: Machine,): Promise<readonly RecordedCall[]> {
  const recording = createRecordingShell({
    captures: { 'arch-chroot /mnt mokutil --generate-hash': '$6$salt$hash\n', },
    files: {},
  },);
  await configureSecureBoot({ machine, shell: recording.shell, hooks: HOOKS, mokPassword: MOK_PASSWORD, },);
  return recording.calls;
}

/**
 Checks `assertReadyForSecureBoot` with a given setup mode answer.

 @param machine - target description
 @param setupMode - what sbctl reports
 @returns recorded calls, after the check passes
 @example
 ```ts
 await readiness({ machine: DESKTOP, setupMode: true, },);
 ```
 */
async function readiness({ machine, setupMode, }: { readonly machine: Machine; readonly setupMode: boolean; },) {
  const recording = createRecordingShell({
    captures: { 'sbctl status --json': JSON.stringify({ setup_mode: setupMode, secure_boot: false, },), },
    files: {},
  },);
  await assertReadyForSecureBoot({ machine, shell: recording.shell, },);
  return recording.calls;
}

await describe({
  name: 'secure boot',
  children: [
    it({
      name: 'refuses the desktop unless its firmware is in setup mode, and never asks Hyper-V',
      fn: async () => {
        await expect(readiness({ machine: DESKTOP, setupMode: false, },),).rejects.toThrow(SecureBootStateError,);
        expect((await readiness({ machine: DESKTOP, setupMode: true, },)).length > 0,).toEqual(true,);
        expect(await readiness({ machine: REHEARSAL, setupMode: false, },),).toEqual([],);
      },
    },),
    it({
      name: 'enrolls custom keys with Microsoft certificates on the desktop without shim or MOK',
      fn: async () => {
        const argvs = commandsOf(await configure(DESKTOP,),);
        expect(argvs,).toContainEqual(['arch-chroot', '/mnt', 'sbctl', 'enroll-keys', '--microsoft',],);
        expect(argvs.some((argv,) => argv.includes('mokutil',) || argv.some((argument,) => argument.includes('shim',))),)
          .toEqual(false,);
      },
    },),
    it({
      name: 'boots the guest through shim with an SBAT-carrying Limine installed before Limine is deployed',
      fn: async () => {
        const calls = await configure(REHEARSAL,);
        const argvs = commandsOf(calls,);
        expect(argvs.some((argv,) => argv.includes('enroll-keys',)),).toEqual(false,);
        expect(argvs,).toContainEqual([
          'arch-chroot',
          '/mnt',
          'install',
          '-D',
          '--mode=644',
          '/usr/share/shim-signed/shimx64.efi',
          '/boot/EFI/BOOT/BOOTX64.EFI',
        ],);
        const copyHook = calls.findIndex((call,) =>
          call.kind === 'writeFile' && call.file.path === '/mnt/etc/boot/hooks/post.d/95-shim-limine-copy'
        );
        const deploy = calls.findIndex((call,) => call.kind === 'run' && call.command.argv.includes('limine-update',));
        expect(copyHook >= 0 && copyHook < deploy,).toEqual(true,);
        expect(writtenFile({ calls, path: '/mnt/etc/boot/hooks/post.d/95-shim-limine-copy', },)?.mode,).toEqual(0o755,);
        expect(writtenFile({ calls, path: '/mnt/usr/local/bin/limine-sbat-build', },)?.content,).toEqual(HOOKS.sbatBuilder,);
      },
    },),
    it({
      name: 'keeps only the crypt hash from mokutil output, which also prints its prompts on standard output',
      fn: async () => {
        const hash = '$6$AQcoA/jteAlw$eMS5pTJesotVdToQcdL1X6DlNQeT2Q3V6fbX38pc2pfD7vj9jyD9tgePXc2eco7Xpmj3I2yY5h8ZGVJ5Cdhj1.';
        expect(mokHashFrom(`input password: \ninput password again: \n${hash}\n`,),).toEqual(`${hash}\n`,);
        expect(() => mokHashFrom('input password: \n',)).toThrow(SecureBootStateError,);
      },
    },),
    it({
      name: 'passes the MOK password only on standard input and deletes its hash after the import request',
      fn: async () => {
        const calls = await configure(REHEARSAL,);
        expect(commandsOf(calls,).flat().some((argument,) => argument.includes(MOK_PASSWORD,)),).toEqual(false,);
        const hash = calls.find((call,) => call.kind === 'capture' && call.command.argv.includes('--generate-hash',));
        expect(hash?.kind === 'capture' ? hash.command.stdin : undefined,).toEqual(`${MOK_PASSWORD}\n${MOK_PASSWORD}\n`,);
        const argvs = commandsOf(calls,);
        const importIndex = argvs.findIndex((argv,) => argv.includes('--import',));
        const removeIndex = argvs.findIndex((argv,) => argv[0] === 'rm' && argv[1] === '/mnt/root/mok.hash');
        expect(importIndex >= 0 && importIndex < removeIndex,).toEqual(true,);
      },
    },),
  ],
},);
