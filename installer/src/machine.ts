/**
 Describes the machine the installer targets.

 @module
 */

/** Where the installation runs; decides the Secure Boot chain and guest drivers. */
export type Platform = 'physical' | 'hyper-v';

/** Signed pacman repository that provides the labwc session packages. */
export type PackageRepository = {
  /** pacman `Server` URL, used by pacstrap and written into the installed `pacman.conf`. */
  readonly server: string;
  /** Armored public key file on the live system; pacman trusts it by local signature. */
  readonly publicKeyFile: string;
  /** Fingerprint of the primary key in `publicKeyFile`. */
  readonly keyFingerprint: string;
};

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
  /** Source of the session packages. */
  readonly repository: PackageRepository;
  /** OpenSSH public key allowed to log in as the user; absent means no SSH server. */
  readonly sshAuthorizedKey?: string;
};

/** Secrets the installation needs; they reach commands only through standard input or the environment. */
export type InstallSecrets = {
  /** Temporary LUKS passphrase, replaced by TPM2 plus PIN and a recovery key on first boot. */
  readonly luksPassphrase: string;
  /** Login password of the user. */
  readonly userPassword: string;
  /**
   Root password.
   The physical desktop keeps root unlocked so emergency mode stays reachable when TPM unlocking fails.
   */
  readonly rootPassword: string;
};

/** Thrown when a machine description file does not describe a machine. */
export class InvalidMachineError extends Error {
  /**
   @param message - which field is missing or malformed
   */
  constructor(message: string,) {
    super(message,);
    this.name = InvalidMachineError.name;
  }
}

/** Platforms the installer supports, for validating descriptions read from files. */
const PLATFORMS: ReadonlySet<string> = new Set(['physical', 'hyper-v',],);

/** Characters allowed after the first in a username, matching shadow-utils' default `NAME_REGEX` without `$`. */
const USERNAME_CHARACTERS = 'abcdefghijklmnopqrstuvwxyz0123456789_-';

/** Characters allowed in a hostname label. */
const HOSTNAME_CHARACTERS = 'abcdefghijklmnopqrstuvwxyz0123456789-';

/** Characters allowed in an IANA time zone name, which becomes a path under `/usr/share/zoneinfo`. */
const TIMEZONE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/_+-';

/** Characters allowed in a repository URL: unreserved and reserved URL characters, without spaces or quotes. */
const URL_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&()*+,;=%';

/** Characters of an OpenPGP fingerprint as gpg prints it. */
const HEX_CHARACTERS = '0123456789ABCDEF';

/** Length of a version 4 OpenPGP fingerprint in hexadecimal. */
const FINGERPRINT_LENGTH = 40;

/** Longest username useradd accepts. */
const USERNAME_MAXIMUM_LENGTH = 32;

/** Longest hostname label. */
const HOSTNAME_MAXIMUM_LENGTH = 63;

/**
 Checks that every character of `text` is in `allowed`.

 @param text - value under validation
 @param allowed - permitted characters
 @returns whether the value stays inside the grammar of files and commands it is written into
 @example
 ```ts
 onlyCharacters({ text: 'desktop', allowed: HOSTNAME_CHARACTERS, },);
 ```
 */
function onlyCharacters({ text, allowed, }: { readonly text: string; readonly allowed: string; },): boolean {
  return [...text,].every((character,) => allowed.includes(character,));
}

/**
 Reads a required string property.

 @param record - object under validation
 @param key - property name, reported when invalid
 @returns property value, so callers build the typed object from checked values
 @throws {InvalidMachineError} when the property is not a non-empty string
 @example
 ```ts
 const hostname = requiredString({ record: parsed, key: 'hostname', },);
 ```
 */
function requiredString({ record, key, }: { readonly record: Record<string, unknown>; readonly key: string; },): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new InvalidMachineError(`${key} must be a non-empty string`,);
  }
  return value;
}

/**
 Narrows parsed JSON to an object with string keys.

 @param value - parsed JSON value
 @param name - what the value describes, reported when invalid
 @returns same value typed as a record, so its properties can be validated
 @throws {InvalidMachineError} when the value is not a plain object
 @example
 ```ts
 const record = toRecord({ value: parsed, name: 'machine', },);
 ```
 */
function toRecord({ value, name, }: { readonly value: unknown; readonly name: string; },): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value,)) {
    throw new InvalidMachineError(`${name} must be an object`,);
  }
  return value as Record<string, unknown>;
}

/**
 Validates a parsed machine description.

 @param parsed - JSON from the machine description file
 @returns typed description with only the known fields
 @throws {InvalidMachineError} when a field is missing or malformed
 @example
 ```ts
 const machine = parseMachine(JSON.parse(await Deno.readTextFile('machine.json',),),);
 ```
 */
export function parseMachine(parsed: unknown,): Machine {
  const value = toRecord({ value: parsed, name: 'machine', },);
  const platform = requiredString({ record: value, key: 'platform', },);
  if (!PLATFORMS.has(platform,)) {
    throw new InvalidMachineError(`platform must be physical or hyper-v, not ${platform}`,);
  }
  const targetDisk = requiredString({ record: value, key: 'targetDisk', },);
  if (!targetDisk.startsWith('/dev/disk/by-id/',)) {
    throw new InvalidMachineError('targetDisk must be a /dev/disk/by-id link, so a renumbered disk is never erased',);
  }
  const username = requiredString({ record: value, key: 'username', },);
  if (
    username === 'root' || username.length > USERNAME_MAXIMUM_LENGTH || username.startsWith('-',)
    || !onlyCharacters({ text: username, allowed: USERNAME_CHARACTERS, },)
  ) {
    throw new InvalidMachineError('username must be a regular lowercase login name such as user',);
  }
  const hostname = requiredString({ record: value, key: 'hostname', },);
  if (
    hostname.length > HOSTNAME_MAXIMUM_LENGTH || hostname.startsWith('-',) || hostname.endsWith('-',)
    || !onlyCharacters({ text: hostname, allowed: HOSTNAME_CHARACTERS, },)
  ) {
    throw new InvalidMachineError('hostname must be one lowercase label such as desktop',);
  }
  const timezone = requiredString({ record: value, key: 'timezone', },);
  if (
    timezone.startsWith('/',) || timezone.split('/',).some((part,) => part === '' || part === '.' || part === '..')
    || !onlyCharacters({ text: timezone, allowed: TIMEZONE_CHARACTERS, },)
  ) {
    throw new InvalidMachineError('timezone must be an IANA name such as America/New_York',);
  }
  const repository = toRecord({ value: value['repository'], name: 'repository', },);
  const server = requiredString({ record: repository, key: 'server', },);
  // The server line is written into pacman.conf, so it must stay one line of a URL scheme pacman fetches.
  if (!(server.startsWith('https://',) || server.startsWith('file:///',)) || !onlyCharacters({ text: server, allowed: URL_CHARACTERS, },)) {
    throw new InvalidMachineError('repository.server must be an https:// or file:/// URL without spaces or line breaks',);
  }
  const keyFingerprint = requiredString({ record: repository, key: 'keyFingerprint', },);
  if (keyFingerprint.length !== FINGERPRINT_LENGTH || !onlyCharacters({ text: keyFingerprint, allowed: HEX_CHARACTERS, },)) {
    throw new InvalidMachineError('repository.keyFingerprint must be a 40-character uppercase hexadecimal fingerprint',);
  }
  const publicKeyFile = requiredString({ record: repository, key: 'publicKeyFile', },);
  if (!publicKeyFile.startsWith('/',)) {
    throw new InvalidMachineError('repository.publicKeyFile must be an absolute path',);
  }
  const sshAuthorizedKey = value['sshAuthorizedKey'];
  if (
    sshAuthorizedKey !== undefined
    && (typeof sshAuthorizedKey !== 'string' || sshAuthorizedKey.includes('\n',) || sshAuthorizedKey.includes('\r',))
  ) {
    throw new InvalidMachineError('sshAuthorizedKey must be one line when present',);
  }
  return {
    targetDisk,
    hostname,
    username,
    timezone,
    platform: platform as Platform,
    repository: {
      server,
      publicKeyFile,
      keyFingerprint,
    },
    ...(sshAuthorizedKey === undefined ? {} : { sshAuthorizedKey, }),
  };
}
