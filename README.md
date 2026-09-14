# labwc-config

A labwc plus UWSM Wayland session for a CachyOS desktop,
together with the machine installer and the pacman packages that deploy it.

## Status

This repository is being retargeted from a Bazzite rehearsal to CachyOS.
The decisions behind the retarget are recorded in the Monochromatic handover
`doc/handover/leave-bazzite-cachyos-btrfs.md`
(<https://github.com/Aquaticat/Monochromatic/blob/main/doc/handover/leave-bazzite-cachyos-btrfs.md>).

Done:

- The Bazzite and KVM rehearsal lives unchanged in `archive/bazzite-rehearsal/`.
- The session configuration that carries to CachyOS lives in `config/`,
  `system/`,
  and `user-unit/`.

In progress:

- Choosing a TypeScript runtime for the session helpers and the installer.
- Porting the helpers from the archived shell and Python originals.
- A PKGBUILD for the session and a signed pacman repository published through GitHub Releases.
- A TypeScript machine installer,
  rehearsed in a fresh Hyper-V VM before the physical NVMe is erased.

Until the helpers are ported,
the configuration files still reference `/home/user/.local/bin/` helpers that no longer ship from this tree.

## Target machine

- CachyOS on LUKS2-encrypted Btrfs,
  unlocked by TPM2 plus PIN.
- Secure Boot with sbctl custom keys enrolled alongside Microsoft certificates.
- One snapshotted subvolume,
  `@`,
  which contains `/home`,
  `/root`,
  and `/srv`,
  so every Limine snapshot entry boots a matching root and home pair.
- `@cache`,
  `@log`,
  and `@tmp` stay separate and are not snapshotted.
- Hourly Snapper timeline snapshots with bounded retention,
  cleanup at night,
  and Btrfs qgroups disabled.
- UWSM plus labwc started from tty1 autologin without a display manager.

## Session

- **Compositor**:
  labwc under UWSM,
  launched applications run as `uwsm app -t service` units.
- **Panel**:
  sfwbar with a 3×3 pager,
  a taskbar whose right-click menu offers **New instance**,
  tray,
  volume,
  and a clock with a calendar popup.
- **Launcher**:
  fuzzel anchored above the panel's launcher icon,
  toggled by a bare Meta tap,
  dismissed by clicking outside it.
- **X11 applications**:
  xwayland-satellite on `DISPLAY=:12`,
  so X11 windows stay crisp at output scale 2.
- **Look**:
  pure black,
  square corners,
  no shadows,
  no focus highlight,
  Inter and JetBrains Mono.
- **Notifications**:
  swaync with a matching black theme.

## Layout

- `config/`:
  per-application configuration,
  named after the directory each application reads.
- `system/`:
  system unit drop-ins.
- `user-unit/`:
  user unit drop-ins.
- `doc/troubleshooting/`:
  verified labwc,
  UWSM,
  sfwbar,
  and GTK behavior that is easy to rediscover the hard way.
- `archive/bazzite-rehearsal/`:
  the original rehearsal,
  its evidence,
  and the helpers awaiting ports.

## License

MIT,
see `LICENSE`.
`config/font/MaterialSymbolsOutlined.ttf` is Google's Material Symbols under Apache-2.0,
with its license text alongside.
