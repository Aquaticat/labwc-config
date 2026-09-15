/**
 Runs a complete installation in order.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import { installBase, } from './base.ts';
import { configureSystem, } from './configure.ts';
import { prepareDisk, } from './disk.ts';
import { prepareHost, } from './host.ts';
import type {
  InstallSecrets,
  Machine,
} from './machine.ts';
import {
  assertReadyForSecureBoot,
  configureSecureBoot,
  type ShimHooks,
} from './secure-boot.ts';
import {
  inTarget,
  type Shell,
  TARGET_ROOT,
} from './shell.ts';
import {
  configureSnapshots,
  createInstallSnapshot,
} from './snapshots.ts';

/** Where the installed system keeps this checkout, so first-boot enrollment runs without a download. */
export const INSTALLED_CHECKOUT = '/root/labwc-config';

/**
 Installs the machine.

 @param machine - target description
 @param shell - side effects
 @param secrets - passphrase and passwords
 @param luksUuid - UUID for the LUKS header
 @param hooks - Hyper-V boot hook script contents
 @param checkout - path of this checkout on the live system, copied into the installed system
 @param machineJson - machine description as read, copied next to the checkout for first boot
 @throws {UnsafeTargetDiskError} before any write when the target disk is in use
 @throws {SecureBootStateError} before any write when the desktop firmware is not in setup mode
 @throws {CommandFailedError} when a command fails
 @example
 ```ts
 await install({ machine, shell, secrets, luksUuid: crypto.randomUUID(), hooks, checkout, machineJson, },);
 ```
 */
export async function install({ machine, shell, secrets, luksUuid, hooks, checkout, machineJson, }: {
  readonly machine: Machine;
  readonly shell: Shell;
  readonly secrets: InstallSecrets;
  readonly luksUuid: string;
  readonly hooks: ShimHooks;
  readonly checkout: string;
  readonly machineJson: string;
},): Promise<void> {
  const l = tagged({ tag: install.name, },);
  l.info(`installing ${machine.hostname} on ${machine.targetDisk} (${machine.platform})`,);
  await prepareHost({ machine, shell, },);
  await assertReadyForSecureBoot({ machine, shell, },);
  await prepareDisk({ machine, shell, luksPassphrase: secrets.luksPassphrase, luksUuid, },);
  await installBase({ machine, shell, luksUuid, },);
  await configureSystem({ machine, shell, secrets, },);
  // Snapper's initramfs hook must exist before Secure Boot setup rebuilds and signs the boot files.
  await configureSnapshots({ shell, },);
  // The MOK password is typed once in MokManager at the next boot, where the LUKS passphrase is also needed.
  await configureSecureBoot({ machine, shell, hooks, mokPassword: secrets.luksPassphrase, },);
  await shell.run({
    description: 'copy the installer for first-boot enrollment',
    argv: ['cp', '--recursive', '--no-target-directory', checkout, `${TARGET_ROOT}${INSTALLED_CHECKOUT}`,],
  },);
  await shell.writeFile({
    description: 'machine description for first-boot enrollment',
    path: `${TARGET_ROOT}${INSTALLED_CHECKOUT}/machine.json`,
    content: machineJson,
    mode: 0o600,
  },);
  await shell.run({
    description: 'restrict the installer copy to root',
    argv: inTarget(['chmod', '--recursive', 'go-rwx', INSTALLED_CHECKOUT,],),
  },);
  await createInstallSnapshot({ shell, },);
  l.info('installation finished',);
}
