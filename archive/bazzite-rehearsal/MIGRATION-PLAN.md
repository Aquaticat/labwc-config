# Bazzite: KDE → labwc + UWSM migration plan

Verified 2026-07-20 in a KVM VM running the **exact same image digest as this host**
(`ghcr.io/ublue-os/bazzite:stable @ sha256:5496cc…fb919`, version 44.20260713).
Test VM and all assets live in `~/labwc-vm-test/`.

## Why this helps your stuttering complaint

UWSM turns the compositor session into real systemd units:

- Compositor (`wayland-wm@labwc.service`) and session infrastructure (pipewire,
  portals) live in **`session.slice`**.
- Every app launched via `uwsm app` gets its **own `app-*.scope` under
  `app-graphical.slice`** — individually limitable (`CPUQuota`, `CPUWeight`,
  `MemoryMax`, `IOWeight`) and individually OOM-killable without touching the
  session. `uresourced` already boosts the active session on Bazzite.
- Contrast with your KDE session, where KDE app processes are children of
  the Plasma service tree with much coarser separation.

## Facts discovered in the VM (things the internet won't tell you)

1. **This Bazzite build does not use SDDM.** `display-manager.service` is
   `plasmalogin.service` — KDE's new **Plasma Login Manager** (`plasma-login-manager`
   6.7.2, an SDDM-derived codebase). Configure it in `/etc/plasmalogin.conf.d/`
   with SDDM-style INI syntax (verified working).
   **DECISION 2026-07-20: no display manager at all.** plasmalogin is disabled
   (`systemctl disable display-manager`) and the session starts DM-less via
   getty autologin + `uwsm start` in `~/.bash_profile` (steps 3–4 below,
   verified across VM reboots). Nice side effect: ending the session makes
   getty respawn and auto-relogin, so the session restarts itself.
2. **`uwsm` is not in the Fedora 44 repos.** Use COPR `basilcrow/uwsm`
   (uwsm 0.26.1, F44 builds). It also provides `uwsm-plugin-labwc` and pulls in
   `xdg-desktop-portal-wlr` (screenshots/screencast for wlroots).
3. `labwc` 0.9.6 & friends (`foot`, `fuzzel`, `waybar`, `swaybg`, `wlr-randr`)
   are all in Fedora 44 proper — plain `rpm-ostree install` works.
4. The labwc package ships **no wayland-session entry**; create one in
   `/usr/local/share/wayland-sessions/` (writable on ostree → `/var/usrlocal`)
   and add that dir to plasmalogin's `SessionDir`.
5. **XDG autostart leaks:** Steam, kdeconnectd and geoclue auto-started inside
   the labwc session (observed via screenshot + cgroup tree). Mask what you
   don't want (see step 6).
6. Apps started raw from `~/.config/labwc/autostart` end up inside the
   compositor's unit; always wrap them in `uwsm app --` to get their own scope.

## Host migration recipe (each step verified in the VM)

Step 0 — safety net (do this first):

    sudo ostree admin pin 0          # pin current working deployment
    # rollback later: reboot → pick previous entry, or `rpm-ostree rollback`

Step 1 — uwsm COPR repo:

    sudo tee /etc/yum.repos.d/copr-basilcrow-uwsm.repo <<'EOF'
    [copr:copr.fedorainfracloud.org:basilcrow:uwsm]
    name=Copr repo for uwsm owned by basilcrow
    baseurl=https://download.copr.fedorainfracloud.org/results/basilcrow/uwsm/fedora-$releasever-$basearch/
    type=rpm-md
    skip_if_unavailable=True
    gpgcheck=1
    gpgkey=https://download.copr.fedorainfracloud.org/results/basilcrow/uwsm/pubkey.gpg
    repo_gpgcheck=0
    enabled=1
    EOF

Step 2 — layer packages, reboot:

    sudo rpm-ostree install --idempotent uwsm labwc foot fuzzel sfwbar wlr-randr
    # (sfwbar = the adopted panel; waybar/swaybg dropped — no wallpaper wanted,
    #  waybar replaced by sfwbar per YOUR-SETUP.md "Panel: sfwbar")
    sudo systemctl reboot

Step 3 — DM-less autologin on tty1 (NO display manager — hard requirement):

    sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
    sudo cp final-configs/getty-tty1-autologin.conf \
        /etc/systemd/system/getty@tty1.service.d/autologin.conf   # edit username!
    cat final-configs/bash_profile-snippet.sh >> ~/.bash_profile
    sudo systemctl daemon-reload

Step 4 — disable the display manager (reversible):

    sudo systemctl disable display-manager
    # rollback: sudo systemctl enable display-manager (plasmalogin comes back,
    # and with it the KDE session at the greeter). While DM-less, a KDE session
    # is still reachable from another VT: log in on tty2 and run
    # `uwsm start -- startplasma-wayland` (untested — VM rehearsal used labwc only).

`uwsm check may-start` in the profile snippet guards against ssh logins and
nested shells triggering the session (verified: ssh logins unaffected).
CachyOS defaults to Fish rather than this Bazzite VM's Bash shell;
use an equivalent Fish `conf.d` bridge there instead of changing shells.

Step 5 — launch discipline inside labwc:

    # ~/.config/labwc/autostart  — wrap everything in `uwsm app --`
    # (use `-t service` for anything that itself launches apps, e.g. the
    #  panel — services get the clean session activation env; scopes
    #  inherit the caller's env. See YOUR-SETUP.md env-inheritance gotcha.)
    uwsm app -t service -- sfwbar &
    # fuzzel launcher: final-configs/fuzzel.ini uses launch-feedback.
    # launch-feedback starts each app with `uwsm app -t service --` so
    # xwayland-satellite's DISPLAY=:12 activation environment is retained.
    # `uuctl` (ships with uwsm) = menu for stopping/restarting session units

Step 6 — mask unwanted KDE/XDG autostarts (per-user, reversible):

    mkdir -p ~/.config/autostart
    for f in steam kdeconnectd geoclue-demo-agent; do
      printf '[Desktop Entry]\nHidden=true\n' > ~/.config/autostart/$f.desktop
    done
    # NB Steam's autostart entry is USER-level (~/.config/autostart/steam.desktop,
    # Steam installs it itself for "Run Steam when my computer starts") — there is
    # no /etc/xdg/autostart/steam.desktop on this image; the generator runs it as
    # app-steam@autostart.service. Masking verified across reboot 2026-07-20
    # (user decision: Steam autostart disabled).

Step 6b — crisp X11-only apps on scaled outputs (RustDesk, Steam, …):

    # Stock Xwayland cannot scale rootless surfaces -> X11 apps get blurry
    # 2x-upscaled at output scale 2/3 (your KDE hid this via kwinrc
    # "[Xwayland] Scale=3" = apps-scale-themselves; labwc/wlroots incl. 0.20
    # has no equivalent).
    # ADOPTED (your call, 2026-07-20): **xwayland-satellite** — stock Xwayland,
    # Fedora-maintained package, nothing to patch or rebuild. Crisp verified
    # in-VM (pixel-level crops); X11 windows appear as native toplevels with
    # labwc titlebars.
    sudo rpm-ostree install --idempotent xwayland-satellite && sudo systemctl reboot
    # Pin the display (the shipped user unit has no display argument):
    #   ~/.config/systemd/user/xwayland-satellite.service.d/override.conf
    #     [Service]
    #     ExecStart=
    #     ExecStart=/usr/bin/xwayland-satellite :12
    systemctl --user enable --now xwayland-satellite
    # ~/.config/uwsm/env:
    #   export DISPLAY=:12                     # all apps (incl. flatpaks) use satellite
    #   export _JAVA_AWT_WM_NONREPARENTING=1   # Java/IntelliJ blank-window fix (README)
    # Notes:
    # - Type=notify unit on graphical-session.target: starts right after the
    #   compositor, normally before any X11 app connects. If an XDG-autostart
    #   X11 app ever races it, order that app After=xwayland-satellite.service.
    # - satellite does its own XSettings scaling (GTK/Qt automatic); misc apps
    #   (Wine etc.) may need per-app DPI config. Mixed-DPI monitors: satellite
    #   picks ONE factor — the smallest monitor's DPI (KDE-style limitation).
    # - labwc's built-in :0 Xwayland stays dormant; nothing connects to it.
    #
    # Evaluated alternatives (2026-07-20 in-VM comparison, same app + crops):
    # - HiDPI-patched Xwayland (KWin model): EQUALLY CRISP, fully transparent
    #   on :0 — but requires rebuilding the patch on Xwayland releases.
    #   Demoted to fallback; recipe preserved and verified:
    #   final-configs/build-xwayland-hidpi.sh + WLR_XWAYLAND=/usr/local/bin/Xwayland
    #   in uwsm env + final-configs/xinitrc + final-configs/xsettingsd.conf.
    # - gamescope: stretches app windows to its output (game-scaler semantics)
    #   -> wrong geometry for desktop apps; FSR/NIS ("Lossless Scaling" style)
    #   inherits the same problem. Rejected.
    # - nearest-neighbor ("pixelize") filter on Xwayland buffers: needs a labwc
    #   source patch (no upstream option); moot given two fully crisp options.

Step 7 — anti-stutter resource policy (the actual point):

    # Give the compositor + audio priority over apps under contention:
    mkdir -p ~/.config/systemd/user/app-graphical.slice.d
    tee ~/.config/systemd/user/app-graphical.slice.d/limits.conf <<'EOF'
    [Slice]
    CPUWeight=80
    MemoryHigh=80%
    EOF
    systemctl --user daemon-reload
    # Per-app clamps any time, e.g.:
    #   systemctl --user set-property app-wlroots-<name>-*.scope CPUQuota=400% MemoryMax=8G

## Rollback / bail-out

- Session level: `sudo systemctl enable display-manager` + reboot brings back
  plasmalogin and the KDE session. Zero risk.
- Xwayland level: remove `WLR_XWAYLAND=` from `~/.config/uwsm/env` → stock
  `/usr/bin/Xwayland` is used again (the patched copy in /usr/local is inert).
- Package level: `sudo rpm-ostree uninstall uwsm labwc ...` (or `rpm-ostree rollback`).
- Deployment level: pinned deployment from step 0 is always in the boot menu.
- Config level: delete `/etc/plasmalogin.conf.d/10-labwc.conf` and the
  `/usr/local/share/wayland-sessions/` entry.

## If you later want KDE actually *removed*

`rpm-ostree override remove` on Plasma packages fights the image and breaks on
updates; the sane path is a **custom bootc image** (BlueBuild or a plain
Containerfile `FROM ghcr.io/ublue-os/bazzite:stable` that removes Plasma and
bakes in labwc/uwsm + your session file). The VM in `~/labwc-vm-test/` is the
right place to boot-test such an image before rebasing the host to it.
Keep plasmalogin either way, or swap to `greetd` + `tuigreet` (both in Fedora
repos) if you want the login path KDE-free too.

## Using the test VM

- **virt-manager (GUI):** domain `bazzite-labwc-test` (imported into your
  flatpak virt-manager, qemu:///session). Run it, the console opens; autologin
  lands in labwc. User: `user`, password: `bazzite` (passwordless sudo).
  The flatpak got a user-level override (`flatpak override --user
  --filesystem=~/labwc-vm-test`) so it can read the disk; revert with
  `flatpak override --user --reset org.virt_manager.virt-manager`.
- **Headless (what I used):**
  `podman run --rm --name bazzite-labwc --device /dev/kvm --network=host -v ~/labwc-vm-test:/work:Z vmrunner sh /work/run-vm.sh`
  then `ssh -p 2222 -i ~/labwc-vm-test/id_ed25519 user@127.0.0.1`;
  VNC viewer on `127.0.0.1:5910`; QMP on `127.0.0.1:4444` (`qmp.py`).
  Don't run both at once — they share `disk.qcow2`.
- **VM display config (final, hard-won):** virtio video `accel3d=on` +
  `blob=on` (needs `<memoryBacking><source type="memfd"/><access mode="shared"/>`),
  spice **`gl=off`** plus a second **`egl-headless`** graphics element.
  Guest gets full virgl GPU rendering (`+virgl +resource_blob`, labwc on
  GLES); QEMU reads frames back into normal 2D surfaces for the viewer.
  Why not spice `gl=on` (zero-copy scanout): the flatpak's spice-gtk EGL
  widget path has a cursor y-flip/hotspot bug — with hardware cursors the
  pointer renders upside-down and offset; with `WLR_NO_HARDWARE_CURSORS=1`
  you get TWO cursors (labwc's correct in-frame one + the client's broken
  one, which always draws in client-mouse mode). The cairo path (`gl=off`)
  composites the cursor correctly, so hardware cursors stay on and there is
  exactly one, correct cursor. Cost: one frame readback copy (~14 MB @
  2560×1440) — negligible locally.
  Console auto-resize: virt-manager View → Scale Display →
  "Auto resize VM with window" (spice-vdagent is in the image and runs).
- **Rules that DO carry to the host:** hide `xwaylandvideobridge` from
  taskbar/window switcher via labwc windowRule (KDE ships an equivalent rule,
  which is why you never saw it there); Root-context mousebinds — Left click
  runs `pkill -x fuzzel` instead of the default root menu (labwc defaults to
  menu on BOTH desktop clicks), Middle/Right also kill fuzzel then re-state
  their default menus (desktop clicks dismiss the launcher, 2026-07-20).
  Both in `final-configs/rc.xml`.
- **Snapshots:** clean post-migration state saved as qcow2 internal snapshot
  `clean-labwc-uwsm-20260720` (revert while VM is off:
  `podman run --rm -v ~/labwc-vm-test:/work:Z vmrunner qemu-img snapshot -a clean-labwc-uwsm-20260720 /work/disk.qcow2`)
  plus a btrfs reflink copy `disk-clean-labwc-uwsm.qcow2` (restore by copying it
  back over `disk.qcow2`). Note: virt-manager's snapshot UI can't do internal
  snapshots on UEFI domains — use the commands above instead.

## Contention demo results (VM capped to 1 / 2 vCPUs, hogs UNLIMITED inside)

Probe = single-threaded "renderer" benchmark (iterations in 8 s) representing
session-side work, competing against 8 unlimited CPU spinners. Placement is
everything (`logs/demo2-1core.txt`, `logs/demo2-2core.txt`):

| renderer placement vs hogs                        | 1 vCPU | 2 vCPU |
|---------------------------------------------------|--------|--------|
| alone, no hogs (baseline)                         | 100%   | 100%   |
| hogs + renderer mixed in ONE cgroup (unmanaged)   | 11.5%  | 21.6%  |
| hogs uwsm-scoped; renderer in a sibling app scope | 50.5%  | 90.9%  |
| hogs uwsm-scoped; renderer in session.slice       | 83.6%  | ~100%  |

- Unmanaged mixing starves session work ~9× (exactly 1/(1+8) fair-share).
  With uwsm scoping, a scope's thread count buys it nothing (8 threads vs 1 =
  50/50), and session.slice's default **cpu.weight 500 vs app.slice 100** on
  this image gives compositor-side work ~83% even on a single saturated core —
  matching the 5/6 the weights predict. No quotas were set in any of this.
- Compositor Wayland round-trip latency stayed 2–16 ms in every condition.
- **Unlimited memory bomb** (2-core run): global OOM at 7.3 GB rss — the kernel
  killed the bomb inside its `app-uwsm-python3-….scope`, labwc kept its PID,
  session stayed active, round-trip back to 3 ms right after.
- Additionally verified earlier (`logs/demo-output.txt`): any running scope can
  be clamped live, e.g. `systemctl --user set-property app-…scope CPUQuota=100%`
  (kernel throttling confirmed) or `MemoryMax=2G` (cgroup-scoped OOM kill).

Honesty note: Plasma also runs its services as systemd user units, so "one
cgroup" models unmanaged process pile-ups (terminal-spawned trees, non-.desktop
launches), not all of KDE. What the numbers prove is the mechanism uwsm makes
universal: every launch gets a scope, so the scheduler can protect the session.
