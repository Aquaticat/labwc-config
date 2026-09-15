/**
 Describes the machine the installer targets.

 @module
 */

/** Where the installation runs; decides the Secure Boot chain and guest drivers. */
export type Platform = 'physical' | 'hyper-v';

/** Everything the installer needs to know that is not a secret. */
export type Machine = {
  /** Stable `/dev/disk/by-id` link to the whole disk that will be erased. */
  readonly targetDisk: string;
  /** Static hostname written to `/etc/hostname`. */
  readonly hostname: string;
  /** Login name of the only interactive user. */
  readonly username: string;
  /** IANA time zone, such as `America/New_York`. */
  readonly timezone: string;
  /** Installation environment. */
  readonly platform: Platform;
};
