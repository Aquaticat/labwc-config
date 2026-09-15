/**
 Tests for `configureSystem`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  autologinDropIn,
  configureSystem,
} from './configure.ts';
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
  SECRETS,
} from './test-machines.ts';

/**
 Runs `configureSystem` against a recording shell.

 @param machine - target description
 @returns recorded calls
 @example
 ```ts
 const calls = await configure(DESKTOP,);
 ```
 */
async function configure(machine: Machine,): Promise<readonly RecordedCall[]> {
  const recording = createRecordingShell({ captures: {}, files: {}, },);
  await configureSystem({ machine, shell: recording.shell, secrets: SECRETS, },);
  return recording.calls;
}

/**
 Finds the `systemctl enable` arguments.

 @param calls - recorded calls
 @returns enabled unit names
 @example
 ```ts
 const units = enabledUnits(calls,);
 ```
 */
function enabledUnits(calls: readonly RecordedCall[],): readonly string[] {
  return commandsOf(calls,).find((argv,) => argv[2] === 'systemctl' && argv[3] === 'enable')?.slice(4,) ?? [];
}

await describe({
  name: configureSystem.name,
  children: [
    it({
      name: 'passes passwords only on standard input, never as arguments or file content',
      fn: async () => {
        const calls = await configure(REHEARSAL,);
        const secrets = Object.values(SECRETS,);
        const inArguments = commandsOf(calls,).flat().some((argument,) => secrets.some((secret,) => argument.includes(secret,)));
        const inFiles = calls.some((call,) =>
          call.kind === 'writeFile' && secrets.some((secret,) => call.file.content.includes(secret,))
        );
        expect(inArguments,).toEqual(false,);
        expect(inFiles,).toEqual(false,);
        const chpasswd = calls.find((call,) => call.kind === 'run' && call.command.argv[2] === 'chpasswd');
        expect(chpasswd?.kind === 'run' ? chpasswd.command.stdin : undefined,).toEqual(
          `user:${SECRETS.userPassword}\nroot:${SECRETS.rootPassword}\n`,
        );
      },
    },),
    it({
      name: 'adds the user to input so the launcher daemon can read the Meta key',
      fn: async () => {
        const useradd = commandsOf(await configure(DESKTOP,),).find((argv,) => argv[2] === 'useradd');
        expect(useradd,).toEqual([
          'arch-chroot',
          '/mnt',
          'useradd',
          '--create-home',
          '--groups',
          'wheel,input',
          '--shell',
          '/bin/fish',
          'user',
        ],);
      },
    },),
    it({
      name: 'logs the user in on tty1 so the packaged login hook starts the session',
      fn: async () => {
        const dropIn = writtenFile({
          calls: await configure(DESKTOP,),
          path: '/mnt/etc/systemd/system/getty@tty1.service.d/autologin.conf',
        },);
        expect(dropIn?.content,).toEqual(autologinDropIn('user',),);
        expect(dropIn?.content,).toContain('ExecStart=\nExecStart=-/sbin/agetty --autologin user --noclear %I $TERM\n',);
      },
    },),
    it({
      name: 'imports the packaged GTK overrides from the user configuration',
      fn: async () => {
        const calls = await configure(DESKTOP,);
        expect(writtenFile({ calls, path: '/mnt/home/user/.config/gtk-3.0/gtk.css', },)?.content,).toEqual(
          '@import url("file:///usr/share/labwc-config/gtk/gtk-3.0.css");\n',
        );
        expect(writtenFile({ calls, path: '/mnt/home/user/.config/gtk-4.0/gtk.css', },)?.content,).toContain('gtk-4.0.css',);
      },
    },),
    it({
      name: 'enables SSH and guest daemons only in the rehearsal guest and hardware profiles only on the desktop',
      fn: async () => {
        const desktop = await configure(DESKTOP,);
        const rehearsal = await configure(REHEARSAL,);
        expect(enabledUnits(desktop,),).toEqual(['NetworkManager', 'systemd-timesyncd', 'fstrim.timer',],);
        expect(enabledUnits(rehearsal,),).toEqual([
          'NetworkManager',
          'systemd-timesyncd',
          'fstrim.timer',
          'hv_kvp_daemon',
          'hv_vss_daemon',
          'sshd',
        ],);
        expect(commandsOf(desktop,),).toContainEqual(['arch-chroot', '/mnt', 'chwd', '--autoconfigure',],);
        expect(commandsOf(rehearsal,).some((argv,) => argv[2] === 'chwd'),).toEqual(false,);
        expect(writtenFile({ calls: desktop, path: '/mnt/etc/ssh/sshd_config.d/10-hardening.conf', },),).toEqual(undefined,);
        expect(
          writtenFile({ calls: rehearsal, path: '/mnt/home/user/.ssh/authorized_keys', },)?.content,
        ).toEqual(`${REHEARSAL.sshAuthorizedKey}\n`,);
      },
    },),
  ],
},);
