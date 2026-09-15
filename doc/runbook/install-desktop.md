# Install CachyOS on the physical desktop

## Purpose

Replace Bazzite on the Ryzen 7 8700F and RX 7600 desktop
with the installer-built CachyOS system the Hyper-V rehearsal verified
(`doc/troubleshooting/installer-rehearsal.md`).
The installer erases the 2 TB SPCC NVMe only;
the 4 TB SATA data SSD is left untouched and unsnapshotted.

## Before the day

1. Create the signing key and let CI publish the repository,
   as `doc/planning/pacman-repository.md` section "Signing key" describes,
   including committing `packaging/labwc-config-signing.asc`.
   Check that the database is downloadable:

   ```sh
   # doc/runbook/install-desktop.md
   curl --fail --location --head https://github.com/Aquaticat/labwc-config/releases/download/repo/labwc-config.db
   ```

2. Copy anything still needed off the NVMe;
   the Bazzite root and home are gone after the installer confirms.
3. Write the CachyOS live ISO to a USB drive.
4. Note the motherboard model and firmware version.
   sbctl 0.18 flags MSI AMD boards with FQ0001,
   which needs a firmware setting before the install.

## Firmware settings

1. Boot in UEFI mode with CSM disabled.
2. Enable the AMD fTPM.
3. Keep Secure Boot enabled and clear its keys,
   which firmware menus call "Delete all Secure Boot variables",
   "Clear Secure Boot keys",
   or "Reset to Setup Mode".
   Do not restore factory keys afterwards.
   In setup mode the firmware does not enforce signatures,
   so the unsigned live ISO boots.
4. Set a firmware administrator password,
   so Secure Boot cannot be switched off without it.

## On the live ISO

1. Connect to the network;
   use `nmtui` for Wi-Fi.
2. Become root and install the installer's runtime:

   ```sh
   # doc/runbook/install-desktop.md
   sudo --login
   pacman --sync --refresh --needed deno git
   git clone https://github.com/Aquaticat/labwc-config.git /root/labwc-config
   ```

3. Find the NVMe's stable name.
   Pick the `nvme-` entry of the 2 TB SPCC drive,
   not an `ata-` entry,
   which is the data SSD:

   ```sh
   # doc/runbook/install-desktop.md
   lsblk --output NAME,SIZE,MODEL,SERIAL
   ls -l /dev/disk/by-id/ | grep --invert-match -- -part
   ```

4. Read the signing key's fingerprint:

   ```sh
   # doc/runbook/install-desktop.md
   gpg --show-keys --with-colons /root/labwc-config/packaging/labwc-config-signing.asc | grep --max-count=1 '^fpr'
   ```

   The fingerprint is the tenth colon-separated field.

5. Write `/root/machine.json`:

   ```json
   {
     "targetDisk": "/dev/disk/by-id/nvme-THE_SPCC_DRIVE",
     "hostname": "desktop",
     "username": "user",
     "timezone": "America/New_York",
     "platform": "physical",
     "repository": {
       "server": "https://github.com/Aquaticat/labwc-config/releases/download/repo",
       "publicKeyFile": "/root/labwc-config/packaging/labwc-config-signing.asc",
       "keyFingerprint": "THE_40_CHARACTER_FINGERPRINT"
     }
   }
   ```

   Replace the hostname,
   user name,
   and time zone with the real ones.

6. Run the installer:

   ```sh
   # doc/runbook/install-desktop.md
   deno run --allow-all /root/labwc-config/installer/src/install.main.ts --machine /root/machine.json
   ```

   Before erasing anything,
   it refuses a busy target disk,
   a umask other than 022,
   firmware that is not in setup mode,
   and firmware sbctl flags with a quirk such as FQ0001.
   For a quirk,
   apply the mitigation its sbctl wiki page names in the firmware menu;
   for FQ0001 on MSI boards,
   set "Secure Boot Mode" to "Custom",
   then either set "Image Execution Policy" to "Deny Execute" for Option ROM,
   Removable Media,
   and Fixed Media,
   or set "Secure Boot Preset" to "Maximum Security"
   (<https://github.com/Foxboron/sbctl/wiki/FQ0001>, read 2026-09-15).
   The RX 7600 option ROM still runs,
   because the Microsoft certificates it is signed with stay enrolled.
   sbctl keeps reporting the quirk afterwards,
   so add `"acknowledgedFirmwareQuirks": ["FQ0001"]` to `machine.json` and run the installer again.
   It then asks for the hostname as confirmation,
   a temporary LUKS passphrase,
   the user password,
   and the root password.

7. Follow the installer's closing instructions:

   ```sh
   # doc/runbook/install-desktop.md
   umount --recursive /mnt && cryptsetup close labwc-config-target && reboot
   ```

   Remove the USB drive while the machine restarts.
   The enrolled keys end setup mode,
   so from now on the firmware enforces signatures.

## First boot

1. Limine boots `linux-cachyos`,
   and the initramfs asks for the temporary passphrase.
2. The user logs in on tty1 automatically and labwc starts.
   Switch to tty2 with Ctrl+Alt+F2,
   log in,
   and run:

   ```sh
   # doc/runbook/install-desktop.md
   sudo --login deno run --allow-all /root/labwc-config/installer/src/first-boot.main.ts
   ```

   It needs the network,
   because Deno downloads the installer's packages again.
   It refuses to run unless Secure Boot enforces and setup mode is off.
3. Give it the temporary passphrase and a new boot PIN.
   It shows the recovery key once;
   store it in the password manager before typing it back.
   Only after it reads the key back correctly does it remove the passphrase.
4. Reboot and unlock with the PIN.

## Checks

```sh
# doc/runbook/install-desktop.md
sudo sbctl status
sudo systemd-cryptenroll /dev/disk/by-partlabel/cryptroot
snapper list
systemctl --user status labwc-panel.service labwc-launcherd.service swaync.service
busctl --user status org.freedesktop.Notifications
```

- `sbctl status` shows Secure Boot enabled,
  setup mode disabled,
  and the Microsoft certificates enrolled.
- The LUKS header lists a recovery slot and a tpm2 slot and no password slot.
- Snapper lists the "Fresh installation" snapshot,
  and the Limine menu lists it under Snapshots.
- The notification name belongs to swaync,
  not sfwbar.

## When something fails

- **Secure Boot violation at the first boot**:
  enter the firmware,
  reset Secure Boot to setup mode,
  boot the live ISO,
  unlock and mount the target,
  and run `sbctl verify` inside `arch-chroot /mnt` to find the unsigned file.
- **The PIN is refused**:
  a changed firmware setting or Secure Boot database changes PCR 7.
  Unlock with the recovery key,
  then re-enroll with
  `systemd-cryptenroll --wipe-slot=tpm2 --tpm2-device=auto --tpm2-with-pin=yes --tpm2-pcrs=7 /dev/disk/by-partlabel/cryptroot`.
- **A bad update**:
  pick a snapshot in the Limine menu;
  it boots root and home as of that snapshot on a throwaway overlay,
  and `limine-snapper-restore` makes it permanent.

## After the install

- Mount the data SSD;
  the installer does not configure it.
- Measure the hot paths against `doc/planning/hot-path-budget.md`.
- Run the ZFS trigger test from the Monochromatic handover `doc/handover/leave-bazzite-cachyos-btrfs.md`.
