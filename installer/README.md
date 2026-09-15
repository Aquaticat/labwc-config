# Machine installer

Installs CachyOS on Btrfs with LUKS2,
Snapper snapshots bootable from Limine,
Secure Boot,
and the labwc session from the signed `labwc-config` pacman repository.
It runs on Deno from the CachyOS live ISO,
or from an installed CachyOS with the target disk attached.

## Phases

- `src/install.main.ts` runs once as root before the first boot.
  It refuses to start unless the target disk is idle and,
  on the physical desktop,
  the firmware is in Secure Boot setup mode.
  It then erases the disk,
  installs the base system and session,
  configures Snapper,
  and sets up the Secure Boot chain.
- `src/first-boot.main.ts` runs once as root after the first boot,
  when Secure Boot enforces the final keys.
  It adds a recovery key and a TPM2 plus PIN key slot,
  and removes the temporary passphrase after the recovery key is typed back.

## Machine description

The installer reads a JSON file:

```json
{
  "targetDisk": "/dev/disk/by-id/nvme-EXAMPLE",
  "hostname": "desktop",
  "username": "user",
  "timezone": "America/New_York",
  "platform": "physical",
  "repository": {
    "server": "https://github.com/Aquaticat/labwc-config/releases/download/repo",
    "publicKeyFile": "/root/labwc-config-signing.asc",
    "keyFingerprint": "0123456789ABCDEF0123456789ABCDEF01234567"
  }
}
```

`platform` is `physical` or `hyper-v`.
`sshAuthorizedKey` is optional;
with it,
the installer installs and enables a key-only SSH server.
`acknowledgedFirmwareQuirks` is optional:
sbctl reports firmware quirks from the board model and firmware date,
so after applying a quirk's mitigation in the firmware menu,
list its ID,
such as `FQ0001`,
to let the installer continue.
`src/machine.ts` limits every field to the grammar of the file or command it is written into.

## Running

```sh
# installer/README.md
deno run --allow-all installer/src/install.main.ts --machine machine.json
```

The installer asks for the hostname as confirmation,
then for the temporary LUKS passphrase,
the user password,
and the root password,
each twice without echo.
Secrets reach commands only through standard input or the environment.

## Layout

- `src/shell.ts`:
  the `Shell` every step runs commands and writes files through.
- `src/recording-shell.ts`:
  the `Shell` tests pass,
  which records calls instead of changing the system.
- `src/disk.ts`,
  `src/base.ts`,
  `src/configure.ts`,
  `src/snapshots.ts`,
  `src/secure-boot.ts`:
  installation steps.
- `src/install.ts`:
  the order of the steps.
- `src/first-boot.ts`:
  TPM2 plus PIN enrollment.
- `shim/`:
  Hyper-V boot hooks that keep shim loading a signed Limine with a `.sbat` section.

## Testing

```sh
# installer/README.md
deno task test:unit
```

Each step's tests run it against a recording shell.
The guard tests were each shown to fail with their guard removed.
