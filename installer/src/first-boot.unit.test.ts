/**
 Tests for TPM2 plus PIN enrollment.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  enrollUnlocking,
  EnrollmentStateError,
  luksDevice,
  removePassphrase,
  slotTypes,
} from './first-boot.ts';
import {
  commandsOf,
  createRecordingShell,
} from './recording-shell.ts';
import { SecureBootStateError, } from './secure-boot.ts';

/** LUKS UUID on the kernel command line. */
const UUID = '5c2a603a-ef77-4208-b676-4ed044a00e04';

/** Device path derived from the UUID. */
const DEVICE = `/dev/disk/by-uuid/${UUID}`;

/** Recovery key systemd-cryptenroll prints. */
const RECOVERY_KEY = 'fjdkslar-hbnvcuei-owpqmzxa-lskdjfhg-tyrueiwo-qpalzmxn-cbvnmasd-fghjklqw';

/**
 Builds captures for a device with the given slot listings in order.

 @param secureBoot - sbctl status answer
 @param listing - systemd-cryptenroll slot listing
 @returns recording shell
 @example
 ```ts
 const recording = shellWith({ secureBoot: { secure_boot: true, setup_mode: false, }, listing: 'SLOT TYPE\n 0 password\n', },);
 ```
 */
function shellWith({ secureBoot, listing, }: {
  readonly secureBoot: { readonly secure_boot: boolean; readonly setup_mode: boolean; };
  readonly listing: string;
},) {
  return createRecordingShell({
    captures: {
      'sbctl status --json': JSON.stringify(secureBoot,),
      [`systemd-cryptenroll ${DEVICE}`]: listing,
      [`systemd-cryptenroll --recovery-key ${DEVICE}`]: `${RECOVERY_KEY}\n`,
    },
    files: { '/etc/kernel/cmdline': `rd.luks.name=${UUID}=root rd.luks.options=tpm2-device=auto root=/dev/mapper/root rw\n`, },
  },);
}

/** Secure Boot enforcing the final keys. */
const ENFORCING = { secure_boot: true, setup_mode: false, } as const;

await describe({
  name: 'first boot',
  children: [
    it({
      name: 'reads the LUKS device and slot types from the formats systemd tools print',
      fn: async () => {
        expect(luksDevice(`quiet rd.luks.name=${UUID}=root rw\n`,),).toEqual(DEVICE,);
        expect(() => luksDevice('quiet rw',)).toThrow(EnrollmentStateError,);
        expect(slotTypes('SLOT TYPE    \n   0 password\n   1 recovery\n   2 tpm2\n',),).toEqual([
          'password',
          'recovery',
          'tpm2',
        ],);
      },
    },),
    it({
      name: 'refuses to bind to PCR 7 before Secure Boot enforces the final keys',
      fn: async () => {
        for (const secureBoot of [{ secure_boot: false, setup_mode: false, }, { secure_boot: true, setup_mode: true, },]) {
          const recording = shellWith({ secureBoot, listing: 'SLOT TYPE\n 0 password\n', },);
          await expect(enrollUnlocking({ platform: 'physical', shell: recording.shell, passphrase: 'p', pin: 'n', },),)
            .rejects.toThrow(SecureBootStateError,);
          expect(commandsOf(recording.calls,).some((argv,) => argv.includes('--tpm2-device=auto',)),).toEqual(false,);
        }
      },
    },),
    it({
      name: 'adds a tested recovery key and a PIN-protected TPM2 slot bound to the platform PCRs, secrets outside argv',
      fn: async () => {
        const recording = shellWith({ secureBoot: ENFORCING, listing: 'SLOT TYPE\n 0 password\n', },);
        const result = await enrollUnlocking({
          platform: 'hyper-v',
          shell: recording.shell,
          passphrase: 'temporary-8812',
          pin: 'pin-3390',
        },);
        expect(result,).toEqual({ device: DEVICE, recoveryKey: RECOVERY_KEY, },);
        const argvs = commandsOf(recording.calls,);
        expect(argvs,).toContainEqual([
          'systemd-cryptenroll',
          '--tpm2-device=auto',
          '--tpm2-with-pin=yes',
          '--tpm2-pcrs=7+14',
          DEVICE,
        ],);
        expect(argvs.flat().some((argument,) => ['temporary-8812', 'pin-3390', RECOVERY_KEY,].includes(argument,)),)
          .toEqual(false,);
        expect(argvs.some((argv,) => argv.some((argument,) => argument.startsWith('--wipe-slot',))),).toEqual(false,);
      },
    },),
    it({
      name: 'refuses to enroll twice on a device that already has recovery or TPM2 slots',
      fn: async () => {
        const recording = shellWith({ secureBoot: ENFORCING, listing: 'SLOT TYPE\n 0 password\n 1 tpm2\n', },);
        await expect(enrollUnlocking({ platform: 'physical', shell: recording.shell, passphrase: 'p', pin: 'n', },),)
          .rejects.toThrow(EnrollmentStateError,);
      },
    },),
    it({
      name: 'keeps the passphrase unless both a recovery and a TPM2 slot exist',
      fn: async () => {
        const recording = shellWith({ secureBoot: ENFORCING, listing: 'SLOT TYPE\n 0 password\n 1 recovery\n', },);
        await expect(removePassphrase({ shell: recording.shell, device: DEVICE, recoveryKey: RECOVERY_KEY, },),).rejects
          .toThrow(EnrollmentStateError,);
        expect(commandsOf(recording.calls,).some((argv,) => argv.includes('--wipe-slot=password',)),).toEqual(false,);
      },
    },),
  ],
},);
