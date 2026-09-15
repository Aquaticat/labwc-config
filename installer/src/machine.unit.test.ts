/**
 Tests for `parseMachine`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  InvalidMachineError,
  parseMachine,
} from './machine.ts';

/** A valid physical desktop description, as the machine file would hold it. */
const DESKTOP_JSON = {
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
} as const;

/**
 Parses the desktop description with one field replaced.

 @param override - fields that replace the valid ones
 @returns parse result, so each test names only the field it varies
 @example
 ```ts
 const parse = () => parseWith({ hostname: 'x', },);
 ```
 */
function parseWith(override: Record<string, unknown>,): ReturnType<typeof parseMachine> {
  return parseMachine({ ...DESKTOP_JSON, ...override, },);
}

await describe({
  name: parseMachine.name,
  children: [
    it({
      name: 'accepts a complete description and omits an absent SSH key',
      fn: async () => {
        const machine = parseMachine(DESKTOP_JSON,);
        expect(machine.username,).toEqual('user',);
        expect('sshAuthorizedKey' in machine,).toEqual(false,);
      },
    },),
    it({
      name: 'refuses a target disk that is not a stable by-id link',
      fn: async () => {
        expect(() => parseWith({ targetDisk: '/dev/nvme0n1', },)).toThrow(InvalidMachineError,);
      },
    },),
    it({
      name: 'refuses usernames that would break out of sudoers, getty, or useradd arguments',
      fn: async () => {
        expect(() => parseWith({ username: 'user\nALL', },)).toThrow(InvalidMachineError,);
        expect(() => parseWith({ username: 'user ALL=(ALL) NOPASSWD: ALL', },)).toThrow(InvalidMachineError,);
        expect(() => parseWith({ username: '--badname', },)).toThrow(InvalidMachineError,);
        expect(() => parseWith({ username: 'root', },)).toThrow(InvalidMachineError,);
      },
    },),
    it({
      name: 'refuses hostnames that would add lines to /etc/hosts',
      fn: async () => {
        expect(() => parseWith({ hostname: 'desktop\n0.0.0.0 example.com', },)).toThrow(InvalidMachineError,);
        expect(() => parseWith({ hostname: '-desktop', },)).toThrow(InvalidMachineError,);
      },
    },),
    it({
      name: 'refuses time zones that escape /usr/share/zoneinfo',
      fn: async () => {
        expect(() => parseWith({ timezone: '../../../etc/shadow', },)).toThrow(InvalidMachineError,);
        expect(() => parseWith({ timezone: '/etc/localtime', },)).toThrow(InvalidMachineError,);
        expect(parseWith({ timezone: 'Etc/GMT+5', },).timezone,).toEqual('Etc/GMT+5',);
      },
    },),
    it({
      name: 'refuses an SSH key spanning lines, which would authorize a second key',
      fn: async () => {
        expect(() => parseWith({ sshAuthorizedKey: 'ssh-ed25519 AAAA one\nssh-ed25519 BBBB two', },)).toThrow(
          InvalidMachineError,
        );
        expect(parseWith({ sshAuthorizedKey: 'ssh-ed25519 AAAA one', },).sshAuthorizedKey,).toEqual(
          'ssh-ed25519 AAAA one',
        );
      },
    },),
    it({
      name: 'refuses an unknown platform and a missing repository',
      fn: async () => {
        expect(() => parseWith({ platform: 'kvm', },)).toThrow(InvalidMachineError,);
        expect(() => parseWith({ repository: undefined, },)).toThrow(InvalidMachineError,);
      },
    },),
  ],
},);
