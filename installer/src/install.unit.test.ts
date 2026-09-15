/**
 Tests for the installation order.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import { install, } from './install.ts';
import type { Machine, } from './machine.ts';
import {
  commandsOf,
  createRecordingShell,
} from './recording-shell.ts';
import { SecureBootStateError, } from './secure-boot.ts';
import {
  DESKTOP,
  REHEARSAL,
  SECRETS,
} from './test-machines.ts';

/**
 Runs `install` against a recording shell with an idle target disk.

 @param machine - target description
 @param setupMode - what sbctl reports on the live system
 @returns recording shell after the run or failure
 @example
 ```ts
 const recording = await run({ machine: REHEARSAL, setupMode: false, },);
 ```
 */
async function run({ machine, setupMode, }: { readonly machine: Machine; readonly setupMode: boolean; },) {
  const recording = createRecordingShell({
    captures: {
      'sh -c umask': '0022\n',
      'sbctl status --json': JSON.stringify({ setup_mode: setupMode, secure_boot: false, },),
      [`readlink --canonicalize-existing ${machine.targetDisk}`]: '/dev/sda\n',
      'lsblk --json --output PATH,TYPE,MOUNTPOINTS': JSON.stringify({
        blockdevices: [{ path: '/dev/sda', type: 'disk', mountpoints: [null,], },],
      },),
    },
    files: {},
  },);
  const outcome = install({
    machine,
    shell: recording.shell,
    secrets: SECRETS,
    luksUuid: '5c2a603a-ef77-4208-b676-4ed044a00e04',
    hooks: { sbatBuilder: '', limineCopy: '', },
    checkout: '/root/labwc-config',
    machineJson: '{}',
  },);
  return { recording, outcome, };
}

await describe({
  name: install.name,
  children: [
    it({
      name: 'stops before erasing the desktop disk when the firmware is not in setup mode',
      fn: async () => {
        const { recording, outcome, } = await run({ machine: DESKTOP, setupMode: false, },);
        await expect(outcome,).rejects.toThrow(SecureBootStateError,);
        expect(commandsOf(recording.calls,).some((argv,) => argv[0] === 'wipefs' || argv[0] === 'sgdisk'),).toEqual(false,);
      },
    },),
    it({
      name: 'erases, installs, configures snapshots before signing the boot chain, and snapshots last',
      fn: async () => {
        const { recording, outcome, } = await run({ machine: REHEARSAL, setupMode: false, },);
        await outcome;
        const argvs = commandsOf(recording.calls,);
        const position = (matches: (argv: readonly string[],) => boolean,): number => argvs.findIndex(matches,);
        const wipe = position((argv,) => argv[0] === 'wipefs');
        const tools = position((argv,) => argv.includes('gptfdisk',));
        const trust = position((argv,) => argv[1] === '--lsign-key');
        expect(tools >= 0 && tools < wipe && trust >= 0 && trust < wipe,).toEqual(true,);
        const pacstrap = position((argv,) => argv[0] === 'pacstrap');
        const snapperSupport = position((argv,) => argv.includes('cachyos-snapper-support',));
        const signing = position((argv,) => argv.includes('limine-update',));
        const snapshot = position((argv,) => argv.includes('Fresh installation',));
        expect([wipe, pacstrap, snapperSupport, signing, snapshot,].every((index,) => index >= 0),).toEqual(true,);
        expect(wipe < pacstrap && pacstrap < snapperSupport && snapperSupport < signing && signing < snapshot,).toEqual(
          true,
        );
        expect(snapshot,).toEqual(argvs.length - 1,);
      },
    },),
  ],
},);
