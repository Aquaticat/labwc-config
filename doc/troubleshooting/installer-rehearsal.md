# Installer rehearsal on a fresh Hyper-V VM

## Metadata

- **Status**:
  Fixed and unit-tested.
  The shim copy hook,
  the environment generator,
  the uwsm env file,
  and `BOOT_ORDER` were applied by hand on the rehearsal VM after the installation that found them;
  a clean reinstallation from the fixed installer and packages is pending.
- **Observed**:
  2026-09-15,
  installing the `CachyOS-Rehearsal` Hyper-V guest from the existing `CachyOS` VM.
- **Evidence**:
  installer logs and console screenshots from the rehearsal,
  and the commits named in each section.

## How the rehearsal ran

The CachyOS live ISO is not signed for Secure Boot,
and the rehearsal kept Secure Boot on.
The rehearsal VM's disk was attached to the existing CachyOS VM,
the installer ran there against it,
and the disk was then moved back to the rehearsal VM.
At the first boot,
shim rejected the not yet trusted Limine and opened MokManager,
which enrolled `\EFI\BOOT\labwc-config-mok.der` from the ESP.

Installing from an installed CachyOS instead of the live ISO exposed host assumptions,
which the installer now checks or handles itself.

## Defects found

### Every command crashed after it succeeded

`createSystemShell().run` decoded standard output it had not captured,
which Deno refuses.
The recording shell used by unit tests could not show it.
The system shell now has tests that run real child processes.

### Host tools and a restrictive umask

- `sgdisk` was missing on the installer host.
  The installer now installs `gptfdisk`,
  `parted`,
  `dosfstools`,
  `cryptsetup`,
  `btrfs-progs`,
  `arch-install-scripts`,
  and `sbctl` before touching the disk.
- The host already had a LUKS mapping named `root`.
  The installer opens the target as `labwc-config-target`;
  the installed system still names its mapping `root` through the kernel command line.
- Under umask 077,
  pacstrap created `/var/cache/pacman` readable only by root,
  and pacman's download user could not fetch packages inside the chroot.
  The installer refuses any umask other than 022 before changing anything.
- The host's `pacman.conf` already listed the znver4 repositories and a `labwc-config` section.
  Detection now runs only when no optimized section exists,
  and the session section is replaced instead of duplicated.

### MOK enrollment

`mokutil --generate-hash` prints its password prompts on standard output,
so the hash file held the prompts and `mokutil --import` rejected it.
The installer keeps only the crypt hash line.

### The shim copy hook died in limine-snapper-sync's sandbox

`limine-snapper-sync.service` runs post hooks under `SystemCallFilter=@system-service @mount`.
The Deno port of `95-shim-limine-copy` died with SIGSYS after a snapshot,
leaving `grubx64.efi` with a Limine whose enrolled configuration hash no longer matched `limine.conf`.
The hook is a shell script again.
Reinstalling `limine` confirmed that the Deno SBAT builder works from its pacman hook,
and that snap-pac's post-transaction snapshot re-runs the sync,
which re-signs Limine and runs the copy hook.

### sfwbar loaded its stock configuration

flatpak's user environment generator rebuilds `XDG_DATA_DIRS` after `environment.d`,
and flatpak's fish hook sets `XDG_DATA_DIRS` in the login shell that uwsm exports.
Both dropped the `/usr/share/labwc-config/data` prefix,
so sfwbar loaded `/usr/share/sfwbar/sfwbar.config`,
whose notification module took `org.freedesktop.Notifications` from swaync.
The package now ships a user environment generator ordered after flatpak's,
and uwsm's env file prepends the prefixes again when they are missing.
The dev VM had no flatpak,
so only a fresh installation showed this.

### The LTS kernel booted by default

With `BOOT_ORDER="*, *fallback, Snapshots"`,
Limine listed `linux-cachyos-lts` first.
The order now names `linux-cachyos` first.

## Verified on the rehearsal VM

- shim,
  the MOK-enrolled Limine with a `.sbat` section,
  and signed kernels boot with Secure Boot enforcing.
- First-boot enrollment added a tested recovery key and a TPM2 plus PIN slot on PCRs 7+14,
  then removed the passphrase;
  the next boot unlocked with the PIN.
- The user logged in automatically,
  and the fish login hook started labwc through uwsm with every session unit running.
- Snapper keeps hourly snapshots,
  cleans up at 03:00 with catch-up,
  and each snapshot appears in Limine's menu,
  which reports the 50-snapshot bound.
- Booting snapshot 4 from the Limine menu mounted it under an overlay root,
  and home matched the snapshot:
  a file written after the snapshot was absent,
  and a file written before it was present.
  `systemd-remount-fs.service` fails in a snapshot boot,
  as expected on an overlay root.

## Operating notes

- Limine's menu waits 3 seconds.
  Stopping it with a key sent from the host is a race;
  raising `timeout` in `/boot/limine.conf`,
  running `limine-enroll-config` and the copy hook,
  and restoring it afterwards made the snapshot boot deterministic.
- A key sent while the PIN prompt was already showing typed characters into it.
  Clearing them with Backspace before typing the PIN avoided a failed attempt,
  which matters because the Hyper-V vTPM locks out after 3 failures.
