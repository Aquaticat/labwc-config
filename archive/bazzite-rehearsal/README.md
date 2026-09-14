# labwc-config

labwc + UWSM desktop configuration, built and verified inside a KVM virtual
machine running the same Bazzite image as the host it was meant to replace
KDE Plasma on.

The repo is the working directory of that rehearsal, published as-is.
The prose was written as session handover notes, so it talks to "you" (the
host owner) and refers to the directory as `~/labwc-vm-test/`; that was its
local name before it became this repo.

## Status

- Bazzite rehearsal: done.
  Base migration, personalization, and the cgroup contention demos are
  verified in the VM; see the docs listed under "Read this".
- Next: the host base moves to CachyOS on x86_64 machines and openSUSE on
  ARM machines.
  The docs here stay Bazzite-specific (rpm-ostree, `ujust`, plasmalogin);
  nothing has been tested on the new bases yet.

## Read this

- `MIGRATION-PLAN.md`: the base migration (KDE to labwc + UWSM), step by
  step, with the facts discovered in the VM and the contention benchmark
  results.
- `YOUR-SETUP.md`: the personalization layer (black theme, 3x3 desktop grid,
  sfwbar panel, Meta-tap launcher, shortcut guard) and what still needs a
  labwc-side port.
- `HANDOVER.md`: VM access, host facts, verified results, open issues.
  Written for resuming a working session.
- `final-configs/`: the host-ready config files those docs refer to
  (`rc.xml`, `sfwbar.config`, `fuzzel.ini`, `waybar-*`, helper scripts,
  systemd drop-ins).
  `fonts/MaterialSymbolsOutlined.ttf` is Google's Material Symbols
  (Apache-2.0, license text alongside).
- `guest-*.sh`: scripts that were run inside the guest, in phase order.
- `run-install.sh`, `run-vm.sh`, `Containerfile`, `qmp.py`: the headless
  QEMU runner and its container image.
- `domain*.xml`: libvirt domain definitions at different points of the
  display/GPU debugging.
- `logs/`: serial logs, demo and verify outputs, and screenshots.
  Screenshots are AVIF re-encodes of the originals.
  `host-desktop-redacted.avif` is the host's KDE desktop with every window's
  content, title, and taskbar label pixelated; only the panel and window
  geometry is meant to be read from it.

## What is not in this repo

Everything under 37 GB of VM state was left out.
To rebuild it:

1. Download `Fedora-Everything-netinst-x86_64-44-1.7.iso` from Fedora and
   verify it against `CHECKSUM` (GPG-signed by Fedora).
   Save it as `netinst.iso`.
2. Extract `images/pxeboot/vmlinuz` and `images/pxeboot/initrd.img` from the
   ISO into `boot/`.
3. Build `boot/initrd-ks.img`: wrap `ks.cfg` in a newc cpio archive
   (`ks.cpio`) and append it to `initrd.img`.
   The kernel line in `run-install.sh` then finds `/ks.cfg`.
4. Generate your own SSH keypair as `id_ed25519` / `id_ed25519.pub` and
   replace the `sshkey` line in `ks.cfg` with your public key.
   The committed `id_ed25519.pub` is the key the rehearsal used; its
   private half is not published.
5. Build the runner image: `podman build --tag vmrunner .`
   `run-install.sh` copies `OVMF_VARS.fd` from the image and creates
   `disk.qcow2` on first run.
6. Run the install (see "Using the test VM" in `MIGRATION-PLAN.md` for the
   `podman run` invocations), then the `guest-*.sh` phases over SSH.

The guest user is `user` with password `bazzite` and passwordless sudo,
exactly as `ks.cfg` says.
The VM only listens on loopback; change this before exposing it.

The OdyTTY terminal AppImage referenced by `fuzzel.ini` and the docs is not
included; download it from the OdyTTY project and fix the path.

## License

MIT, see `LICENSE`.
`final-configs/fonts/MaterialSymbolsOutlined.ttf` is Apache-2.0, see the
license file next to it.
