/**
 Prepares the system the installer runs on,
 before anything touches the target disk.

 The live ISO ships most tools;
 an installed CachyOS used as the installer host does not,
 so every tool is installed or confirmed up front instead of failing halfway through.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import type { Machine, } from './machine.ts';
import type { Shell, } from './shell.ts';

/** Packages providing the commands installation runs on the host. */
export const HOST_TOOL_PACKAGES = [
  // pacstrap, genfstab, arch-chroot
  'arch-install-scripts',
  // sgdisk
  'gptfdisk',
  // partprobe
  'parted',
  'dosfstools',
  'cryptsetup',
  'btrfs-progs',
  // sbctl reads the firmware's Secure Boot state before the desktop's disk is erased.
  'sbctl',
] as const;

/**
 Initializes pacman's keyring,
 installs the host tools,
 and trusts the session repository's signing key.

 @param machine - target description
 @param shell - side effects
 @throws {CommandFailedError} when a command fails
 @example
 ```ts
 await prepareHost({ machine, shell, },);
 ```
 */
export async function prepareHost({ machine, shell, }: { readonly machine: Machine; readonly shell: Shell; },): Promise<
  void
> {
  const l = tagged({ tag: prepareHost.name, },);
  await shell.run({ description: 'initialize the pacman keyring', argv: ['pacman-key', '--init',], },);
  await shell.run({
    description: 'refresh the distribution keyrings',
    argv: ['pacman', '--sync', '--refresh', '--noconfirm', '--needed', 'cachyos-keyring', 'archlinux-keyring',],
  },);
  await shell.run({ description: 'populate the pacman keyring', argv: ['pacman-key', '--populate',], },);
  await shell.run({
    description: 'install the tools installation runs',
    argv: ['pacman', '--sync', '--noconfirm', '--needed', ...HOST_TOOL_PACKAGES,],
  },);
  await shell.run({
    description: 'add the session repository key',
    argv: ['pacman-key', '--add', machine.repository.publicKeyFile,],
  },);
  await shell.run({
    description: 'trust the session repository key',
    argv: ['pacman-key', '--lsign-key', machine.repository.keyFingerprint,],
  },);
  l.info('installer host ready',);
}
