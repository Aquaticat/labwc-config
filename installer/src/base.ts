/**
 Installs the base system and the labwc session packages into `/mnt`.

 Boot configuration that package hooks read during pacstrap is written first,
 so the kernel and Limine hooks produce a bootable ESP on their first run.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

import { ROOT_MAPPING, } from './disk.ts';
import type {
  Machine,
  Platform,
} from './machine.ts';
import {
  type Shell,
  TARGET_ROOT,
} from './shell.ts';
import { SNAPSHOT_ENTRY_LIMIT, } from './snapshots.ts';

/** pacman configuration pacstrap uses, adapted to the CPU by CachyOS's detection script. */
const TARGET_PACMAN_CONF = '/tmp/pacman.target.conf';

/** Section name of the session repository, which must match the database name. */
const REPOSITORY_NAME = 'labwc-config';

/** Packages every installation gets, following the CachyOS Calamares base selection. */
const BASE_PACKAGES = [
  'base',
  'base-devel',
  'btrfs-progs',
  'cachyos-hooks',
  'cachyos-keyring',
  'cachyos-mirrorlist',
  'cachyos-v4-mirrorlist',
  'cachyos-v3-mirrorlist',
  'cachyos-rate-mirrors',
  'cachyos-settings',
  'cryptsetup',
  'device-mapper',
  'diffutils',
  'dosfstools',
  'e2fsprogs',
  'efibootmgr',
  'inetutils',
  'less',
  'logrotate',
  'lsb-release',
  'man-db',
  'man-pages',
  'mkinitcpio',
  'perl',
  'python',
  'sudo',
  'sysfsutils',
  'texinfo',
  'which',
  'chwd',
  'linux-cachyos',
  'linux-cachyos-lts',
  'cachyos-fish-config',
  'networkmanager',
  'dnsutils',
  'ethtool',
  'nss-mdns',
  'ufw',
  'pacman-contrib',
  'pkgfile',
  'rebuild-detector',
  'reflector',
  'bash-completion',
  'plocate',
  'efitools',
  'smartmontools',
  'unzip',
  'btop',
  'duf',
  'git',
  'hwinfo',
  'fastfetch',
  'rsync',
  'wget',
  'micro',
  'nano',
  'vim',
  'limine',
  'limine-mkinitcpio-hook',
  'limine-snapper-sync',
  'snapper',
  'snap-pac',
  'inotify-tools',
  'sbctl',
  'tpm2-tss',
  'tpm2-tools',
  'openssl',
  'deno',
] as const;

/** The labwc session and what it needs beyond the session package's own dependencies. */
const SESSION_PACKAGES = [
  'labwc-config',
  'pipewire',
  'pipewire-alsa',
  'pipewire-pulse',
  'wireplumber',
  'xdg-desktop-portal-gtk',
  'xdg-desktop-portal-wlr',
  'flatpak',
  'dolphin',
  'noto-fonts',
  'noto-fonts-cjk',
  'noto-fonts-emoji',
] as const;

/** Packages that differ by platform. */
const PLATFORM_PACKAGES: Readonly<Record<Platform, readonly string[]>> = {
  // amdgpu cannot initialize the RX 7600 without linux-firmware.
  physical: ['amd-ucode', 'linux-firmware',],
  // shim loads Limine under Hyper-V, which has no setup mode for custom keys; binutils builds Limine's .sbat section.
  'hyper-v': ['hyperv', 'shim-signed', 'mokutil', 'sbsigntools', 'binutils',],
};

/**
 Lists the packages pacstrap installs.

 @param machine - target description
 @returns package names in installation order
 @example
 ```ts
 const packages = packagesFor(machine,);
 ```
 */
export function packagesFor(machine: Machine,): readonly string[] {
  return [
    ...BASE_PACKAGES,
    ...PLATFORM_PACKAGES[machine.platform],
    ...(machine.sshAuthorizedKey === undefined ? [] : ['openssh',]),
    ...SESSION_PACKAGES,
  ];
}

/**
 Builds the kernel command line that unlocks LUKS in the initramfs.

 @param luksUuid - UUID written into the LUKS header
 @returns command line for `/etc/kernel/cmdline` and Limine's defaults
 @example
 ```ts
 const cmdline = kernelCommandLine(luksUuid,);
 ```
 */
export function kernelCommandLine(luksUuid: string,): string {
  return [
    `rd.luks.name=${luksUuid}=${ROOT_MAPPING}`,
    'rd.luks.options=tpm2-device=auto',
    `root=/dev/mapper/${ROOT_MAPPING}`,
    'rootflags=subvol=/@',
    'rw',
    'quiet',
    'nowatchdog',
  ].join(' ',);
}

/**
 Builds `/etc/default/limine`.

 @param platform - installation environment
 @param commandLine - kernel command line
 @returns file content
 @example
 ```ts
 const content = limineDefaults({ platform: 'physical', commandLine, },);
 ```
 */
export function limineDefaults({ platform, commandLine, }: {
  readonly platform: Platform;
  readonly commandLine: string;
},): string {
  return [
    'TARGET_OS_NAME="CachyOS"',
    'ESP_PATH="/boot"',
    `KERNEL_CMDLINE[default]="${commandLine}"`,
    'ENABLE_VERIFICATION=yes',
    'ENABLE_ENROLL_LIMINE_CONFIG=yes',
    // Under Hyper-V shim owns \EFI\BOOT\BOOTX64.EFI; on the desktop Limine itself is the fallback loader.
    `ENABLE_LIMINE_FALLBACK=${platform === 'physical' ? 'yes' : 'no'}`,
    'FIND_BOOTLOADERS=no',
    'BOOT_ORDER="*, *fallback, Snapshots"',
    // Every snapshot Snapper retains stays bootable: the limit equals Snapper's retention bound.
    `MAX_SNAPSHOT_ENTRIES=${SNAPSHOT_ENTRY_LIMIT}`,
    ...(platform === 'hyper-v' ? ['LIMINE_BINARY_PATH=/usr/local/share/limine/BOOTX64.EFI',] : []),
    '',
  ].join('\n',);
}

/**
 Builds the mkinitcpio drop-in that unlocks LUKS with systemd.

 @param platform - installation environment
 @returns file content
 @example
 ```ts
 const content = initramfsConfig('hyper-v',);
 ```
 */
export function initramfsConfig(platform: Platform,): string {
  return [
    '# The LUKS PIN prompt needs storage and keyboard drivers in the initramfs.',
    platform === 'hyper-v' ? 'MODULES=(hv_vmbus hv_storvsc hyperv_keyboard)' : 'MODULES=()',
    'HOOKS=(base systemd autodetect microcode modconf kms keyboard sd-vconsole block sd-encrypt filesystems fsck)',
    '',
  ].join('\n',);
}

/**
 Builds the pacman.conf section for the signed session repository.

 @param machine - target description
 @returns section text appended to pacman.conf
 @example
 ```ts
 const section = repositorySection(machine,);
 ```
 */
export function repositorySection(machine: Machine,): string {
  return `\n[${REPOSITORY_NAME}]\nSigLevel = Required\nServer = ${machine.repository.server}\n`;
}

/**
 Initializes pacman's keyring on the live system and trusts the session repository's key.

 @param machine - target description
 @param shell - side effects
 @example
 ```ts
 await prepareKeyring({ machine, shell, },);
 ```
 */
async function prepareKeyring({ machine, shell, }: { readonly machine: Machine; readonly shell: Shell; },): Promise<void> {
  await shell.run({ description: 'initialize the pacman keyring', argv: ['pacman-key', '--init',], },);
  await shell.run({
    description: 'refresh the distribution keyrings',
    argv: ['pacman', '--sync', '--refresh', '--noconfirm', '--needed', 'cachyos-keyring', 'archlinux-keyring',],
  },);
  await shell.run({ description: 'populate the pacman keyring', argv: ['pacman-key', '--populate',], },);
  await shell.run({
    description: 'add the session repository key',
    argv: ['pacman-key', '--add', machine.repository.publicKeyFile,],
  },);
  await shell.run({
    description: 'trust the session repository key',
    argv: ['pacman-key', '--lsign-key', machine.repository.keyFingerprint,],
  },);
}

/**
 Writes the configuration package hooks read while pacstrap runs.

 @param machine - target description
 @param shell - side effects
 @param luksUuid - UUID written into the LUKS header
 @example
 ```ts
 await preseedBootConfiguration({ machine, shell, luksUuid, },);
 ```
 */
async function preseedBootConfiguration({ machine, shell, luksUuid, }: {
  readonly machine: Machine;
  readonly shell: Shell;
  readonly luksUuid: string;
},): Promise<void> {
  const commandLine = kernelCommandLine(luksUuid,);
  await shell.writeFile({
    description: 'kernel command line',
    path: `${TARGET_ROOT}/etc/kernel/cmdline`,
    content: `${commandLine}\n`,
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'Limine defaults',
    path: `${TARGET_ROOT}/etc/default/limine`,
    content: limineDefaults({ platform: machine.platform, commandLine, },),
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'initramfs hooks for LUKS unlocking',
    path: `${TARGET_ROOT}/etc/mkinitcpio.conf.d/00-luks.conf`,
    content: initramfsConfig(machine.platform,),
    mode: 0o644,
  },);
  await shell.writeFile({
    description: 'console keymap',
    path: `${TARGET_ROOT}/etc/vconsole.conf`,
    content: 'KEYMAP=us\n',
    mode: 0o644,
  },);
}

/**
 Installs the base system and session into the mounted target.

 @param machine - target description
 @param shell - side effects
 @param luksUuid - UUID written into the LUKS header
 @throws {CommandFailedError} when a command fails
 @example
 ```ts
 await installBase({ machine, shell, luksUuid, },);
 ```
 */
export async function installBase({ machine, shell, luksUuid, }: {
  readonly machine: Machine;
  readonly shell: Shell;
  readonly luksUuid: string;
},): Promise<void> {
  const l = tagged({ tag: installBase.name, },);
  await prepareKeyring({ machine, shell, },);

  await shell.run({ description: 'copy the live pacman.conf', argv: ['cp', '/etc/pacman.conf', TARGET_PACMAN_CONF,], },);
  await shell.run({
    description: 'enable the CPU-optimized CachyOS repositories',
    argv: ['bash', '/etc/calamares/scripts/detect-architecture', TARGET_PACMAN_CONF,],
  },);
  const pacmanConf = await shell.readFile(TARGET_PACMAN_CONF,);
  await shell.writeFile({
    description: 'target pacman.conf with the session repository',
    path: `${TARGET_ROOT}/etc/pacman.conf`,
    content: `${pacmanConf}${repositorySection(machine,)}`,
    mode: 0o644,
  },);
  await shell.run({ description: 'create pacman.d', argv: ['mkdir', '--parents', `${TARGET_ROOT}/etc/pacman.d`,], },);
  await shell.run({
    description: 'copy the mirror lists',
    argv: [
      'cp',
      '/etc/pacman.d/mirrorlist',
      '/etc/pacman.d/cachyos-mirrorlist',
      '/etc/pacman.d/cachyos-v3-mirrorlist',
      '/etc/pacman.d/cachyos-v4-mirrorlist',
      `${TARGET_ROOT}/etc/pacman.d/`,
    ],
  },);
  await shell.run({
    description: 'copy the keyring, including the session repository trust',
    argv: ['cp', '--archive', '/etc/pacman.d/gnupg', `${TARGET_ROOT}/etc/pacman.d/`,],
  },);
  await preseedBootConfiguration({ machine, shell, luksUuid, },);

  l.info(`installing ${packagesFor(machine,).length} packages`,);
  await shell.run({
    description: 'install the base system and session',
    argv: ['pacstrap', '-C', `${TARGET_ROOT}/etc/pacman.conf`, TARGET_ROOT, ...packagesFor(machine,),],
  },);

  const fstab = await shell.capture({ description: 'generate fstab', argv: ['genfstab', '-U', TARGET_ROOT,], },);
  await shell.writeFile({
    description: 'fstab with a RAM-backed /tmp',
    path: `${TARGET_ROOT}/etc/fstab`,
    content: `${fstab.trimEnd()}\ntmpfs /tmp tmpfs defaults,noatime,mode=1777 0 0\n`,
    mode: 0o644,
  },);
  l.info('base system installed',);
}
