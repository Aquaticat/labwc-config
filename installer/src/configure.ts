/**
 Configures the installed system from inside a chroot:
 time,
 locale,
 users,
 automatic login into the labwc session,
 SSH,
 and services.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import type {
  InstallSecrets,
  Machine,
} from './machine.ts';
import {
  inTarget,
  type Shell,
  TARGET_ROOT,
} from './shell.ts';

/** Groups the user joins: `wheel` for sudo, `input` so the launcher daemon reads the Meta key from evdev. */
export const USER_GROUPS = ['wheel', 'input',] as const;

/** Services every installation enables. */
const COMMON_SERVICES = ['NetworkManager', 'systemd-timesyncd', 'fstrim.timer',] as const;

/** Hyper-V guest daemons for IP reporting and production checkpoints. */
const HYPER_V_SERVICES = ['hv_kvp_daemon', 'hv_vss_daemon',] as const;

/** SSH server settings that allow only public key logins by regular users. */
const SSHD_HARDENING = [
  'PermitRootLogin no',
  'PasswordAuthentication no',
  'KbdInteractiveAuthentication no',
  'AuthenticationMethods publickey',
  '',
].join('\n',);

/**
 Builds the getty drop-in that logs the user in on the first virtual terminal.

 The labwc-config package's login hook then starts the session.

 @param username - validated login name
 @returns drop-in content
 @example
 ```ts
 const content = autologinDropIn('user',);
 ```
 */
export function autologinDropIn(username: string,): string {
  return `[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin ${username} --noclear %I $TERM\n`;
}

/**
 Builds a `gtk.css` that imports the session's packaged decoration overrides.

 GTK reads `gtk.css` only from the user's configuration directory,
 and an import keeps the rules updated with the package.

 @param version - GTK major version
 @returns file content
 @example
 ```ts
 const content = gtkImport(3,);
 ```
 */
export function gtkImport(version: 3 | 4,): string {
  return `@import url("file:///usr/share/labwc-config/gtk/gtk-${version}.0.css");\n`;
}

/**
 Sets the time zone,
 locale,
 hostname,
 and hosts file.

 @param machine - target description
 @param shell - side effects
 @example
 ```ts
 await configureIdentity({ machine, shell, },);
 ```
 */
async function configureIdentity({ machine, shell, }: { readonly machine: Machine; readonly shell: Shell; },): Promise<
  void
> {
  await shell.run({
    description: 'set the time zone',
    argv: inTarget(['ln', '--symbolic', '--force', `/usr/share/zoneinfo/${machine.timezone}`, '/etc/localtime',],),
  },);
  await shell.run({ description: 'set the hardware clock', argv: inTarget(['hwclock', '--systohc',],), },);
  await shell.writeFile({
    description: 'locales to generate',
    path: `${TARGET_ROOT}/etc/locale.gen`,
    content: 'en_US.UTF-8 UTF-8\n',
    mode: 0o644,
  },);
  await shell.run({ description: 'generate locales', argv: inTarget(['locale-gen',],), },);
  await shell.writeFile({
    description: 'system locale',
    path: `${TARGET_ROOT}/etc/locale.conf`,
    content: 'LANG=en_US.UTF-8\n',
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'hostname',
    path: `${TARGET_ROOT}/etc/hostname`,
    content: `${machine.hostname}\n`,
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'hosts',
    path: `${TARGET_ROOT}/etc/hosts`,
    content: `127.0.0.1 localhost\n::1 localhost\n127.0.1.1 ${machine.hostname}\n`,
    mode: 0o644,
  },);
}

/**
 Creates the user,
 sets passwords,
 grants sudo,
 and logs the user in automatically.

 @param machine - target description
 @param shell - side effects
 @param secrets - user and root passwords, passed on standard input
 @example
 ```ts
 await configureUsers({ machine, shell, secrets, },);
 ```
 */
async function configureUsers({ machine, shell, secrets, }: {
  readonly machine: Machine;
  readonly shell: Shell;
  readonly secrets: InstallSecrets;
},): Promise<void> {
  const home = `/home/${machine.username}`;
  await shell.run({
    description: 'create the user',
    argv: inTarget([
      'useradd',
      '--create-home',
      '--groups',
      USER_GROUPS.join(',',),
      '--shell',
      '/bin/fish',
      machine.username,
    ],),
  },);
  // Root keeps a password so emergency mode stays reachable when TPM unlocking fails.
  await shell.run({
    description: 'set the user and root passwords',
    argv: inTarget(['chpasswd',],),
    stdin: `${machine.username}:${secrets.userPassword}\nroot:${secrets.rootPassword}\n`,
  },);
  await shell.writeFile({
    description: 'sudo for wheel',
    path: `${TARGET_ROOT}/etc/sudoers.d/10-wheel`,
    content: '%wheel ALL=(ALL:ALL) ALL\n',
    mode: 0o440,
  },);
  await shell.writeFile({
    description: 'automatic login on the first virtual terminal',
    path: `${TARGET_ROOT}/etc/systemd/system/getty@tty1.service.d/autologin.conf`,
    content: autologinDropIn(machine.username,),
    mode: 0o644,
  },);
  for (const version of [3, 4,] as const) {
    await shell.writeFile({
      description: `GTK ${version} decoration overrides`,
      path: `${TARGET_ROOT}${home}/.config/gtk-${version}.0/gtk.css`,
      content: gtkImport(version,),
      mode: 0o644,
    },);
  }
  if (machine.sshAuthorizedKey !== undefined) {
    await shell.writeFile({
      description: 'SSH key allowed to log in',
      path: `${TARGET_ROOT}${home}/.ssh/authorized_keys`,
      content: `${machine.sshAuthorizedKey}\n`,
      mode: 0o600,
    },);
    await shell.run({ description: 'restrict the SSH directory', argv: inTarget(['chmod', '700', `${home}/.ssh`,],), },);
    await shell.writeFile({
      description: 'SSH server hardening',
      path: `${TARGET_ROOT}/etc/ssh/sshd_config.d/10-hardening.conf`,
      content: SSHD_HARDENING,
      mode: 0o644,
    },);
  }
  await shell.run({
    description: 'give the user their configuration',
    argv: inTarget(['chown', '--recursive', `${machine.username}:${machine.username}`, home,],),
  },);
}

/**
 Configures the installed system.

 @param machine - target description
 @param shell - side effects
 @param secrets - passwords, passed on standard input
 @throws {CommandFailedError} when a command fails
 @example
 ```ts
 await configureSystem({ machine, shell, secrets, },);
 ```
 */
export async function configureSystem({ machine, shell, secrets, }: {
  readonly machine: Machine;
  readonly shell: Shell;
  readonly secrets: InstallSecrets;
},): Promise<void> {
  const l = tagged({ tag: configureSystem.name, },);
  await configureIdentity({ machine, shell, },);
  await configureUsers({ machine, shell, secrets, },);
  if (machine.platform === 'physical') {
    // Calamares runs the same hardware detection to install GPU drivers and firmware profiles.
    await shell.run({ description: 'install hardware profiles', argv: inTarget(['chwd', '--autoconfigure',],), },);
  }
  const services = [
    ...COMMON_SERVICES,
    ...(machine.platform === 'hyper-v' ? HYPER_V_SERVICES : []),
    ...(machine.sshAuthorizedKey === undefined ? [] : ['sshd',]),
  ];
  await shell.run({ description: 'enable services', argv: inTarget(['systemctl', 'enable', ...services,],), },);
  l.info(`enabled ${services.join(', ',)}`,);
}
