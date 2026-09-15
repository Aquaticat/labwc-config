/**
 Sets up the Secure Boot chain for each platform.

 The desktop enrolls its own sbctl keys together with Microsoft's certificates,
 keeping the RX 7600 option ROM trusted,
 and needs the firmware in setup mode.
 Hyper-V has no setup mode,
 so the guest boots shim,
 which trusts the sbctl signing certificate through a MOK enrollment confirmed at the next boot.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import type { Machine, } from './machine.ts';
import {
  inTarget,
  type Shell,
  TARGET_ROOT,
} from './shell.ts';

/** Contents of the Hyper-V boot hook scripts from `installer/shim/`. */
export type ShimHooks = {
  /** `limine-sbat-build.ts`. */
  readonly sbatBuilder: string;
  /** `shim-limine-copy.ts`. */
  readonly limineCopy: string;
};

/** Fields of `sbctl status --json` the installer reads. */
type SbctlStatus = {
  /** Whether the firmware accepts a new platform key. */
  readonly setup_mode: boolean;
  /** Whether the firmware enforces signatures. */
  readonly secure_boot: boolean;
};

/** Thrown when the firmware is not in the state a Secure Boot step needs. */
export class SecureBootStateError extends Error {
  /**
   @param message - observed state and what the user must change
   */
  constructor(message: string,) {
    super(message,);
    this.name = SecureBootStateError.name;
  }
}

/** pacman hook that rebuilds the SBAT copy whenever Limine changes. */
export const SBAT_PACMAN_HOOK = [
  '[Trigger]',
  'Operation = Install',
  'Operation = Upgrade',
  'Type = Package',
  'Target = limine',
  '',
  '[Action]',
  'Description = Adding SBAT section to Limine for shim...',
  'When = PostTransaction',
  'Exec = /usr/local/bin/limine-sbat-build',
  '',
].join('\n',);

/**
 Reads the firmware's Secure Boot state.

 @param shell - side effects
 @param inside - whether to ask the installed system instead of the live one
 @returns parsed status
 @example
 ```ts
 const status = await readStatus({ shell, inside: false, },);
 ```
 */
export async function readSecureBootStatus({ shell, inside, }: {
  readonly shell: Shell;
  readonly inside: boolean;
},): Promise<SbctlStatus> {
  const argv = ['sbctl', 'status', '--json',];
  return JSON.parse(
    await shell.capture({ description: 'read the Secure Boot state', argv: inside ? inTarget(argv,) : argv, },),
  ) as SbctlStatus;
}

/**
 Refuses to erase the desktop's disk unless its firmware can accept custom keys.

 Putting the firmware into setup mode is a firmware menu action only the user can take,
 so the installer checks it before anything is written.

 @param machine - target description
 @param shell - side effects
 @throws {SecureBootStateError} when a physical machine's firmware is not in setup mode
 @example
 ```ts
 await assertReadyForSecureBoot({ machine, shell, },);
 ```
 */
export async function assertReadyForSecureBoot({ machine, shell, }: {
  readonly machine: Machine;
  readonly shell: Shell;
},): Promise<void> {
  const l = tagged({ tag: assertReadyForSecureBoot.name, },);
  if (machine.platform !== 'physical') {
    l.info('Hyper-V enrolls through shim and MOK; setup mode is not needed',);
    return;
  }
  await shell.run({
    description: 'install sbctl in the live system',
    argv: ['pacman', '--sync', '--noconfirm', '--needed', 'sbctl',],
  },);
  const status = await readSecureBootStatus({ shell, inside: false, },);
  if (!status.setup_mode) {
    throw new SecureBootStateError(
      'The firmware is not in Secure Boot setup mode. Clear the Secure Boot keys in the firmware menu, keep Secure Boot enabled, and restart the installer.',
    );
  }
  l.info('firmware is in setup mode',);
}

/**
 Installs the hooks that keep shim loading a signed Limine with a `.sbat` section.

 @param shell - side effects
 @param hooks - hook script contents
 @example
 ```ts
 await installShimHooks({ shell, hooks, },);
 ```
 */
async function installShimHooks({ shell, hooks, }: { readonly shell: Shell; readonly hooks: ShimHooks; },): Promise<
  void
> {
  await shell.writeFile({
    description: 'Limine SBAT builder',
    path: `${TARGET_ROOT}/usr/local/bin/limine-sbat-build`,
    content: hooks.sbatBuilder,
    mode: 0o755,
  },);
  await shell.writeFile({
    description: 'rebuild the SBAT copy when Limine changes',
    path: `${TARGET_ROOT}/etc/pacman.d/hooks/79-limine-sbat.hook`,
    content: SBAT_PACMAN_HOOK,
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'copy the signed Limine to where shim loads it',
    path: `${TARGET_ROOT}/etc/boot/hooks/post.d/95-shim-limine-copy`,
    content: hooks.limineCopy,
    mode: 0o755,
  },);
  await shell.run({ description: 'build the SBAT copy of Limine', argv: inTarget(['limine-sbat-build',],), },);
}

/**
 Creates signing keys,
 deploys the signed boot chain,
 and enrolls the keys the platform's firmware will trust.

 @param machine - target description
 @param shell - side effects
 @param hooks - Hyper-V boot hook script contents
 @param mokPassword - one-time password MokManager asks for at the next boot; passed on standard input
 @throws {CommandFailedError} when a command fails
 @example
 ```ts
 await configureSecureBoot({ machine, shell, hooks, mokPassword, },);
 ```
 */
export async function configureSecureBoot({ machine, shell, hooks, mokPassword, }: {
  readonly machine: Machine;
  readonly shell: Shell;
  readonly hooks: ShimHooks;
  readonly mokPassword: string;
},): Promise<void> {
  const l = tagged({ tag: configureSecureBoot.name, },);
  await shell.run({ description: 'create Secure Boot signing keys', argv: inTarget(['sbctl', 'create-keys',],), },);

  if (machine.platform === 'physical') {
    // Microsoft's certificates keep the GPU option ROM and firmware drivers trusted.
    await shell.run({
      description: 'enroll the signing keys with Microsoft certificates',
      argv: inTarget(['sbctl', 'enroll-keys', '--microsoft',],),
    },);
    await shell.run({ description: 'deploy, enroll, and sign Limine', argv: inTarget(['limine-update',],), },);
    await shell.run({ description: 'verify signatures on the ESP', argv: inTarget(['sbctl', 'verify',],), },);
    l.info('custom keys enrolled; the firmware leaves setup mode',);
    return;
  }

  await installShimHooks({ shell, hooks, },);
  await shell.run({
    description: 'convert the signing certificate for MOK',
    argv: inTarget([
      'openssl',
      'x509',
      '-in',
      '/var/lib/sbctl/keys/db/db.pem',
      '-outform',
      'DER',
      '-out',
      '/var/lib/sbctl/keys/db/db.der',
    ],),
  },);
  await shell.run({
    description: 'install shim as the fallback loader',
    argv: inTarget(['install', '-D', '--mode=644', '/usr/share/shim-signed/shimx64.efi', '/boot/EFI/BOOT/BOOTX64.EFI',],),
  },);
  await shell.run({
    description: 'install MokManager next to shim',
    argv: inTarget(['install', '-D', '--mode=644', '/usr/share/shim-signed/mmx64.efi', '/boot/EFI/BOOT/mmx64.efi',],),
  },);
  await shell.run({ description: 'deploy, enroll, sign, and copy Limine for shim', argv: inTarget(['limine-update',],), },);
  const hash = await shell.capture({
    description: 'hash the MOK enrollment password',
    argv: inTarget(['mokutil', '--generate-hash',],),
    stdin: `${mokPassword}\n${mokPassword}\n`,
  },);
  await shell.writeFile({
    description: 'MOK password hash',
    path: `${TARGET_ROOT}/root/mok.hash`,
    content: hash,
    mode: 0o600,
  },);
  await shell.run({
    description: 'request MOK enrollment of the signing certificate',
    argv: inTarget(['mokutil', '--import', '/var/lib/sbctl/keys/db/db.der', '--hash-file', '/root/mok.hash',],),
  },);
  await shell.run({ description: 'remove the MOK password hash', argv: ['rm', `${TARGET_ROOT}/root/mok.hash`,], },);
  l.info('MOK enrollment requested; confirm it in MokManager at the next boot',);
}
