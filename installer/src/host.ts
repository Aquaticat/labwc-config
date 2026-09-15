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

/** umask pacstrap and arch-chroot expect; stricter masks leave installed directories unreadable to other users. */
const EXPECTED_UMASK = '0022';

/** Thrown when the installer host is in a state that would produce a broken installation. */
export class HostStateError extends Error {
  /**
   @param message - observed state and how to correct it
   */
  constructor(message: string,) {
    super(message,);
    this.name = HostStateError.name;
  }
}

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
  // A rehearsal run under umask 077 created /var/cache/pacman as root-only, so pacman's download user could not write to it.
  const umask = (await shell.capture({ description: 'read the umask', argv: ['sh', '-c', 'umask',], },)).trim();
  if (umask !== EXPECTED_UMASK) {
    throw new HostStateError(`the installer needs umask ${EXPECTED_UMASK}, not ${umask}; run umask ${EXPECTED_UMASK} first`,);
  }
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
