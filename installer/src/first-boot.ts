/**
 Replaces the temporary LUKS passphrase with TPM2 plus PIN unlocking and a recovery key.

 Runs on the installed system after the first boot with Secure Boot enforcing the final keys,
 because PCR 7 measures the Secure Boot state that TPM2 unlocking is bound to.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import type { Platform, } from './machine.ts';
import { readSecureBootStatus, SecureBootStateError, } from './secure-boot.ts';
import type { Shell, } from './shell.ts';

/**
 PCRs the TPM2 key slot is bound to.

 PCR 7 holds the Secure Boot state.
 Under shim,
 PCR 14 holds the MOK list shim measured,
 so a changed MOK list also blocks unlocking.
 */
export const TPM2_PCRS: Readonly<Record<Platform, string>> = {
  physical: '7',
  'hyper-v': '7+14',
};

/** Thrown when the LUKS header is not in the state an enrollment step expects. */
export class EnrollmentStateError extends Error {
  /**
   @param message - observed state
   */
  constructor(message: string,) {
    super(message,);
    this.name = EnrollmentStateError.name;
  }
}

/**
 Finds the LUKS partition from the kernel command line.

 @param commandLine - content of `/etc/kernel/cmdline`
 @returns stable path of the LUKS partition
 @throws {EnrollmentStateError} when the command line names no LUKS UUID
 @example
 ```ts
 const device = luksDevice(await shell.readFile('/etc/kernel/cmdline',),);
 ```
 */
export function luksDevice(commandLine: string,): string {
  const option = commandLine.trim().split(' ',).find((part,) => part.startsWith('rd.luks.name=',));
  const uuid = option?.slice('rd.luks.name='.length,).split('=',)[0];
  if (uuid === undefined || uuid === '') {
    throw new EnrollmentStateError('/etc/kernel/cmdline has no rd.luks.name option',);
  }
  return `/dev/disk/by-uuid/${uuid}`;
}

/**
 Lists the key slot types systemd-cryptenroll reports.

 @param listing - output of `systemd-cryptenroll DEVICE`
 @returns slot types such as `password`, `recovery`, and `tpm2`
 @example
 ```ts
 const types = slotTypes('SLOT TYPE\n   0 password\n',);
 ```
 */
export function slotTypes(listing: string,): readonly string[] {
  return listing
    .split('\n',)
    .slice(1,)
    .map((line,) => line.trim().split(' ',).filter((part,) => part !== '').at(-1,))
    .filter((type,): type is string => type !== undefined);
}

/**
 Reads the device's key slot types.

 @param shell - side effects
 @param device - LUKS partition
 @returns slot types
 @example
 ```ts
 const types = await readSlotTypes({ shell, device, },);
 ```
 */
async function readSlotTypes({ shell, device, }: { readonly shell: Shell; readonly device: string; },): Promise<
  readonly string[]
> {
  return slotTypes(await shell.capture({ description: 'list LUKS key slots', argv: ['systemd-cryptenroll', device,], },),);
}

/**
 Adds a recovery key and a TPM2 plus PIN key slot,
 keeping the temporary passphrase until the user confirms the recovery key.

 @param platform - decides the bound PCRs
 @param shell - side effects
 @param passphrase - temporary passphrase from installation, passed in the environment
 @param pin - PIN typed at every boot, passed in the environment
 @returns LUKS device and the recovery key the user must record
 @throws {SecureBootStateError} when Secure Boot is not enforcing the final keys
 @throws {EnrollmentStateError} when the device already has a recovery or TPM2 slot
 @example
 ```ts
 const { device, recoveryKey, } = await enrollUnlocking({ platform, shell, passphrase, pin, },);
 ```
 */
export async function enrollUnlocking({ platform, shell, passphrase, pin, }: {
  readonly platform: Platform;
  readonly shell: Shell;
  readonly passphrase: string;
  readonly pin: string;
},): Promise<{ readonly device: string; readonly recoveryKey: string; }> {
  const l = tagged({ tag: enrollUnlocking.name, },);
  const status = await readSecureBootStatus({ shell, inside: false, },);
  if (!status.secure_boot || status.setup_mode) {
    throw new SecureBootStateError(
      'Secure Boot must be enforcing the final keys before TPM2 enrollment, because PCR 7 records that state.',
    );
  }
  const device = luksDevice(await shell.readFile('/etc/kernel/cmdline',),);
  const before = await readSlotTypes({ shell, device, },);
  if (before.includes('recovery',) || before.includes('tpm2',)) {
    throw new EnrollmentStateError(`${device} already has ${before.join(', ',)} slots; refusing to add more`,);
  }
  const recoveryKey = (await shell.capture({
    description: 'add a recovery key',
    argv: ['systemd-cryptenroll', '--recovery-key', device,],
    environment: { PASSWORD: passphrase, },
  },)).trim();
  await shell.run({
    description: 'confirm the recovery key unlocks the device',
    argv: ['cryptsetup', 'open', '--test-passphrase', '--key-file=-', device,],
    stdin: recoveryKey,
  },);
  await shell.run({
    description: 'add a TPM2 plus PIN key slot',
    argv: [
      'systemd-cryptenroll',
      '--tpm2-device=auto',
      '--tpm2-with-pin=yes',
      `--tpm2-pcrs=${TPM2_PCRS[platform]}`,
      device,
    ],
    environment: { PASSWORD: passphrase, NEWPIN: pin, },
  },);
  l.info(`recovery and TPM2 slots added to ${device}`,);
  return { device, recoveryKey, };
}

/**
 Removes the temporary passphrase once recovery and TPM2 slots exist.

 @param shell - side effects
 @param device - LUKS partition
 @param recoveryKey - key the user typed back, used to authorize the removal
 @throws {EnrollmentStateError} when the recovery or TPM2 slot is missing, before or after removal
 @example
 ```ts
 await removePassphrase({ shell, device, recoveryKey, },);
 ```
 */
export async function removePassphrase({ shell, device, recoveryKey, }: {
  readonly shell: Shell;
  readonly device: string;
  readonly recoveryKey: string;
},): Promise<void> {
  const l = tagged({ tag: removePassphrase.name, },);
  const before = await readSlotTypes({ shell, device, },);
  if (!before.includes('recovery',) || !before.includes('tpm2',)) {
    throw new EnrollmentStateError(`${device} lacks a recovery or TPM2 slot (${before.join(', ',)}); keeping the passphrase`,);
  }
  await shell.run({
    description: 'remove the temporary passphrase',
    argv: ['systemd-cryptenroll', '--wipe-slot=password', device,],
    environment: { PASSWORD: recoveryKey, },
  },);
  const after = await readSlotTypes({ shell, device, },);
  if (after.includes('password',) || !after.includes('recovery',) || !after.includes('tpm2',)) {
    throw new EnrollmentStateError(`${device} has unexpected slots after removal: ${after.join(', ',)}`,);
  }
  l.info(`${device} unlocks with TPM2 plus PIN or the recovery key`,);
}
