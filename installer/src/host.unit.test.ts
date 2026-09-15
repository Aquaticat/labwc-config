/**
 Tests for `prepareHost`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  HOST_TOOL_PACKAGES,
  HostStateError,
  prepareHost,
} from './host.ts';
import {
  commandsOf,
  createRecordingShell,
} from './recording-shell.ts';
import { DESKTOP, } from './test-machines.ts';

await describe({
  name: prepareHost.name,
  children: [
    it({
      name: 'refuses a restrictive umask before running anything, because pacstrap would create unreadable directories',
      fn: async () => {
        const recording = createRecordingShell({ captures: { 'sh -c umask': '0077\n', }, files: {}, },);
        await expect(prepareHost({ machine: DESKTOP, shell: recording.shell, },),).rejects.toThrow(HostStateError,);
        expect(recording.calls.every((call,) => call.kind === 'capture'),).toEqual(true,);
      },
    },),
    it({
      name: 'installs every host tool installation runs, including the ones an installed CachyOS lacks',
      fn: async () => {
        const recording = createRecordingShell({ captures: { 'sh -c umask': '0022\n', }, files: {}, },);
        await prepareHost({ machine: DESKTOP, shell: recording.shell, },);
        const install = commandsOf(recording.calls,).find((argv,) => argv.includes('gptfdisk',));
        expect(install?.slice(0, 4,),).toEqual(['pacman', '--sync', '--noconfirm', '--needed',],);
        for (const tool of ['arch-install-scripts', 'gptfdisk', 'parted', 'dosfstools', 'cryptsetup', 'btrfs-progs', 'sbctl',]) {
          expect(HOST_TOOL_PACKAGES,).toContain(tool,);
        }
      },
    },),
    it({
      name: 'trusts the session repository key after the keyring is initialized',
      fn: async () => {
        const recording = createRecordingShell({ captures: { 'sh -c umask': '0022\n', }, files: {}, },);
        await prepareHost({ machine: DESKTOP, shell: recording.shell, },);
        const argvs = commandsOf(recording.calls,).map((argv,) => argv.join(' ',));
        const init = argvs.indexOf('pacman-key --init',);
        const trust = argvs.indexOf(`pacman-key --lsign-key ${DESKTOP.repository.keyFingerprint}`,);
        expect(init >= 0 && init < trust,).toEqual(true,);
        expect(argvs,).toContain(`pacman-key --add ${DESKTOP.repository.publicKeyFile}`,);
      },
    },),
  ],
},);
