/**
 Machine descriptions shared by installer tests.

 @module
 */

import type {
  InstallSecrets,
  Machine,
} from './machine.ts';

/** The physical desktop from the 2026-09-14 decisions. */
export const DESKTOP: Machine = {
  targetDisk: '/dev/disk/by-id/nvme-SPCC_M.2_PCIe_SSD_EXAMPLE',
  hostname: 'desktop',
  username: 'user',
  timezone: 'America/New_York',
  platform: 'physical',
  repository: {
    server: 'https://github.com/Aquaticat/labwc-config/releases/download/repo',
    publicKeyFile: '/root/labwc-config-signing.asc',
    keyFingerprint: '0123456789ABCDEF0123456789ABCDEF01234567',
  },
};

/** The Hyper-V rehearsal guest, reachable over SSH. */
export const REHEARSAL: Machine = {
  ...DESKTOP,
  targetDisk: '/dev/disk/by-id/scsi-360022480example',
  hostname: 'rehearsal',
  platform: 'hyper-v',
  sshAuthorizedKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample rehearsal',
};

/** Secrets distinct enough that a leak into an argument vector is detectable. */
export const SECRETS: InstallSecrets = {
  luksPassphrase: 'luks-secret-7f3a',
  userPassword: 'user-secret-91bc',
  rootPassword: 'root-secret-c40d',
};
