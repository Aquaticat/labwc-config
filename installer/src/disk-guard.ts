/**
 Refuses to hand the installer a disk that is in use.

 The installer erases the disk it is given,
 so the only safe target is a whole disk with nothing on it mounted.
 Input is the parsed output of `lsblk --json --output PATH,TYPE,MOUNTPOINTS`.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

/** One block device as reported by `lsblk --json --output PATH,TYPE,MOUNTPOINTS`. */
export type LsblkDevice = {
  /** Kernel device node, such as `/dev/nvme0n1p2`. */
  readonly path: string;
  /** `lsblk` device type, such as `disk`, `part`, or `crypt`. */
  readonly type: string;
  /** Mount points of this device; `lsblk` reports `[null]` for an unmounted device. */
  readonly mountpoints: readonly (string | null)[];
  /** Devices stacked on this one, such as partitions or opened LUKS mappings. */
  readonly children?: readonly LsblkDevice[];
};

/** Top-level `lsblk --json` document. */
export type LsblkReport = {
  /** Every whole block device on the machine. */
  readonly blockdevices: readonly LsblkDevice[];
};

/** `lsblk` types that can exist on an idle disk; every other type is a live mapping holding it open. */
const PASSIVE_DEVICE_TYPES: ReadonlySet<string> = new Set(['disk', 'part',],);

/** Thrown when the requested installation target is unsafe to erase. */
export class UnsafeTargetDiskError extends Error {
  /**
   @param message - which device made the target unsafe and why
   */
  constructor(message: string,) {
    super(message,);
    this.name = UnsafeTargetDiskError.name;
  }
}

/**
 Lists a device and everything stacked on it, parents before children.

 @param device - root of the device tree to flatten
 @returns every device in the tree, so mount checks cover partitions and mappings
 @example
 ```ts
 flattenDevice(disk,).map((device,) => device.path,);
 ```
 */
export function flattenDevice(device: LsblkDevice,): readonly LsblkDevice[] {
  const pending: LsblkDevice[] = [device,];
  const flattened: LsblkDevice[] = [];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      break;
    }
    flattened.push(current,);
    pending.push(...(current.children ?? []),);
  }
  return flattened;
}

/**
 Confirms that `devicePath` names a whole disk with nothing mounted on it or on anything stacked on it.

 @param lsblk - parsed `lsblk --json --output PATH,TYPE,MOUNTPOINTS` report taken just before erasing
 @param devicePath - kernel node the user confirmed, resolved from its `/dev/disk/by-id` link
 @returns `devicePath`, so callers can chain the checked value
 @throws {UnsafeTargetDiskError} when the device is missing, is not a whole disk, or has a mounted descendant
 @example
 ```ts
 const target = assertTargetDisk({ lsblk: report, devicePath: '/dev/nvme0n1', },);
 ```
 */
export function assertTargetDisk({ lsblk, devicePath, }: {
  readonly lsblk: LsblkReport;
  readonly devicePath: string;
},): string {
  const l = tagged({ tag: assertTargetDisk.name, },);
  l.info(`checking ${devicePath}`,);
  const disk = lsblk.blockdevices.find((device,) => device.path === devicePath);
  if (disk === undefined) {
    throw new UnsafeTargetDiskError(`${devicePath} is not a whole block device reported by lsblk`,);
  }
  const devices = flattenDevice(disk,);
  const mounted = devices.flatMap((device,) =>
    device.mountpoints
      .filter((mountpoint,): mountpoint is string => mountpoint !== null)
      .map((mountpoint,) => `${device.path} is mounted at ${mountpoint}`)
  );
  // Anything stacked above a partition (LUKS, LVM, RAID) holds the disk open even when unmounted.
  const mapped = devices
    .filter((device,) => !PASSIVE_DEVICE_TYPES.has(device.type,))
    .map((device,) => `${device.path} is an active ${device.type} mapping`);
  const problems = [...mounted, ...mapped,];
  if (problems.length > 0) {
    l.error(problems.join('; ',),);
    throw new UnsafeTargetDiskError(problems.join('; ',),);
  }
  l.info(`${devicePath} has no mounted descendants and no active mappings`,);
  return devicePath;
}
