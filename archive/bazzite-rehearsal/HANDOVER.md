# HANDOVER — KDE→UWSM+labwc migration test (Bazzite, KVM)

Session context file. Read this first after any context compaction.
Companion docs: `MIGRATION-PLAN.md` (base migration, verified), `YOUR-SETUP.md`
(personalization + gaps), `final-configs/` (host-ready configs), `logs/`
(evidence: screenshots, demo outputs, verify outputs).

## Goal

Replace KDE Plasma with UWSM+labwc on the user's Bazzite host (fixing
KDE-session stutter via systemd/cgroup per-app isolation). Everything is
rehearsed first in a KVM VM that runs the *exact host image digest*
(`ghcr.io/ublue-os/bazzite:stable @ sha256:5496cc…fb919`, 44.20260713).
Status: base migration + personalization + demos DONE and verified.
ONE OPEN ISSUE: viewer cursor rendering (see "OPEN ISSUE" below).

## Host facts (audited, don't re-derive)

- Bazzite 44 (Kinoite/KDE bootc image), rpm-ostree; /var/home home.
  Host layered pkgs incl. ghostty, contour, niri (pending deployment), ROCm, etc.
- **Display manager is `plasmalogin.service`** (Plasma Login Manager 6.7.2,
  SDDM fork) — NOT SDDM. Config: `/etc/plasmalogin.conf.d/*.conf`, SDDM INI
  syntax works (verified: SessionDir list + [Autologin]).
- **No host-native libvirt/QEMU.** The virt-manager **flatpak** is a complete
  session-KVM stack: virsh/virt-install/libvirtd in /app/bin, QEMU +
  virglrenderer 1.11 in /app/lib/extensions. /dev/kvm 0666; /dev/udmabuf has
  user ACL; kvmfr module loaded (Looking Glass).
- `uwsm` is NOT in Fedora 44 — COPR `basilcrow/uwsm` (0.26.1, has
  uwsm-plugin-labwc; pulls xdg-desktop-portal-wlr). labwc 0.9.6, foot,
  fuzzel, waybar 0.15, swaybg, wlr-randr, SwayNotificationCenter, cliphist,
  grim/slurp/swappy, swaylock/swayidle, kanshi, wlogout, nwg-drawer,
  network-manager-applet, pavucontrol, python3-evdev, wayland-utils,
  rsms-inter-vf-fonts, jetbrains-mono-fonts: ALL in Fedora 44.
- `input` group lives in `/usr/lib/group`; plain `usermod -aG input` does NOT
  persist. Fix: `getent group input | sudo tee -a /etc/group` then usermod.
  (`ujust add-user-to-input-group` does this but is interactive/TTY-only.)
- Host user's KDE: pure-black custom scheme (bg 0,0,0; fg #EFF0F1; selection
  #6060C0; focus #346C92), Inter Variable + JetBrains Mono, animations ~off,
  9 virtual desktops 3×3 grid (names "left top".."right bottom"),
  Meta+Ctrl(+Shift)+arrows nav, panel on EVERY monitor (text taskbar; one
  panel has 3×3 pager + tray + 2-line clock), no pinned launchers,
  borderless windows, terminal = **OdyTTY AppImage via GearLever**
  (ghostty retired), autostarts: KeePassXC/Telegram/pCloud/LibreWolf/
  Fastmail/music-player/ydotoold. **Deprecated (do NOT migrate):
  hall-monitor, neovide.** Custom tooling: key-helper (KWin script + D-Bus
  service + ydotool) — needs labwc-side port (gap).
  KDE window rule: RustDesk → "Ignore global shortcuts: Force" (replicated
  as Meta+F12 guard, see below).
- User REJECTED keyd (grab/uinput conflicts with their ydotool history).
  Meta-tap solution = passive evdev watcher (no grab, no uinput).

## VM access

- libvirt domain **`bazzite-labwc-test`** in the FLATPAK's qemu:///session:
  `flatpak run --command=virsh org.virt_manager.virt-manager -c qemu:///session ...`
  (also virt-xml, virt-install, spicy the same way). Flatpak has a user
  override granting read on ~/labwc-vm-test.
- Guest SSH (domain running): `ssh -p 2222 -i ~/labwc-vm-test/id_ed25519 user@127.0.0.1`
  (via qemu:commandline extra NIC, slot 0x12). User `user`, password
  `bazzite`, passwordless sudo. Guest user IS in input group (persisted).
- Alternative headless runner (domain must be OFF — shared disk.qcow2):
  `podman run --rm --name bazzite-labwc --device /dev/kvm --network=host -v ~/labwc-vm-test:/work:Z vmrunner sh /work/run-vm.sh`
  (env SMP=n, DISK=path; VNC :5910, QMP tcp 4444 → qmp.py).
- qemu-guest-agent channel exists but is SELinux-confined in guest (cannot
  exec rpm/dmesg) — use SSH instead.
- Snapshots: qcow2 internal `clean-labwc-uwsm-20260720` (pre-personalization)
  + btrfs reflink `disk-clean-labwc-uwsm.qcow2`. Revert only with VM off.
- `virsh screenshot` FAILS ("no surface") whenever GL display is active —
  screenshot from inside instead: ssh + `grim` (needs session env:
  `export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=$(systemctl --user show-environment | sed -n "s/^WAYLAND_DISPLAY=//p")`).

## Verified results (do not re-test)

1. Base migration works: kickstart netinst+ostreecontainer install; COPR +
   `rpm-ostree install uwsm labwc foot fuzzel waybar swaybg wlr-randr`;
   session entry in `/usr/local/share/wayland-sessions/labwc-uwsm.desktop`
   (`uwsm start -- /usr/bin/labwc`); plasmalogin SessionDir + autologin.
   Full uwsm unit tree active; apps via `uwsm app` get own scopes.
2. Contention demos (VM capped 1/2 vCPU, unlimited hogs): flat cgroup mixing
   starves session work 9×; scoped hogs can't (thread count buys nothing);
   session.slice weight 500 vs app.slice 100 → ~83%/1-core, ~100%/2-core
   for session work. Unlimited 7.3G membomb → global OOM killed only its
   scope; labwc PID survived. See MIGRATION-PLAN.md table + logs/demo2-*.
3. Meta-tap watcher + Meta+F12 shortcut guard: verified via QMP injected
   keys (tap→fuzzel; suspend→inert+flag; restore→works). labwc 0.9.6 does
   NOT advertise keyboard-shortcuts-inhibit protocol (wayland-info checked).
4. Personalization live in VM: black theme (host kdeglobals copied), Inter/
   JetBrains fonts, waybar per-output panel with **true 3×3 KDE-style grid
   pager** (see YOUR-SETUP.md "3×3 grid pager": nested waybar groups + raw
   ext-workspace-v1 client `final-configs/wlr-pager`, stdlib Python only;
   daemon flock-guarded, uwsm-scoped autostart, RTMIN+8 refresh; click/
   scroll verified live 2026-07-20 — replaced the old linear ext/workspaces
   strip and killed the sort-by-id issue),
   9 desktops + grid keybinds (±3 = triple GoToDesktop with wrap),
   borderless windowRule, OdyTTY via GearLever CLI
   (`flatpak run it.mijorus.gearlever --integrate ... -y` worked),
   xwaylandvideobridge hidden (skipTaskbar/skipWindowSwitcher windowRule —
   KDE hides it with a shipped rule too; clicking it = black screen, was a
   red herring during display debugging), Left-click desktop menu unbound
   (labwc default has root menu on BOTH buttons).
   NO WALLPAPER — user doesn't want one; swaybg removed from autostart.
5. **Auto-resize SOLVED (VM-only mechanism):** viewer resize →
   `spice-vdagent` monitor config → QEMU updates the virtio-gpu preferred
   mode in the guest kernel → labwc ignores the hotplug → guest helper
   `~/.local/bin/follow-preferred-mode` applies it via
   `wlr-randr --custom-mode`. The native `spice-vdagent.service` must run
   after `xwayland-satellite.service` with `DISPLAY=:12`; deploy
   `final-configs/spice-vdagent-override.conf` to its user-unit drop-in.
   Keep the XDG desktop mask to avoid a duplicate desktop-autostart agent.
   The prior claim that a connected agent swallowed the kernel path was
   wrong: spice-gtk gates monitor-config sending on agent connection, and
   QEMU 11.0.0 `ui/spice-display.c` uses that config to update virtio-gpu.
   Live resize tests changed both the preferred mode and labwc output.
   Clipboard synchronization remains unverified.
   Keep viewer "Auto resize VM with window" ON and "Scale Display: Always"
   OFF (scaling = blur).
   Cursor final state: gl=on scanout + WLR_NO_HARDWARE_CURSORS=1 =
   smooth + single correct cursor (verified by user).
   **2× output scale** set and persisted inside the follower script
   (`wlr-randr ... --scale 2` in ~/.local/bin/follow-preferred-mode);
   Xwayland apps (Steam) upscale soft — inherent, same as KDE at 2×.

## Session end state (pre-compaction)

- User confirmed working: display perf, cursor, resize-follow, 2× scale.
- "Tons of problems" enumeration so far:
  (1) linear pager → FIXED (3×3 grid);
  (2) dead right-clicks + user requirements "grid necessary" + "new
  instance on taskbar right-click necessary" → **PANEL IS NOW SFWBAR**
  (see YOUR-SETUP.md "Panel: sfwbar" — full design, gotchas, verification).
  waybar+wlr-pager-daemon rig retired but kept in final-configs as
  fallback; lxqt-panel evaluated, rejected (no New-instance menu item),
  still installed. Guest autostart now: sfwbar first line, waybar +
  wlr-pager daemon + swayidle lines REMOVED (user: lock is manual only).
- E2E verified via QMP clicks: pager renders/highlights/switches; taskbar
  right-click menu → New instance spawned 2nd foot in own uwsm scope;
  volume/clock/tray fine. Menu CSS dark via #winops/#menu_item.
- sfwbar source cloned at scratchpad/sfwbar-src (user asked; confirmed
  style-name→gtk_widget_set_name-on-child, menu naming, css priority).
- Guest layered packages now additionally: sfwbar lxqt-panel (+xscreensaver
  deps) — POST-dates the clean snapshot.
- QMP click/key injection helper: scratchpad qmp-click.sh pattern
  (virsh qemu-monitor-command input-send-event; abs coords ×32767/dim).
- GOTCHA that bit 3×: pkill -f in an ssh one-liner self-matches the remote
  bash cmdline (even bracket-trick fails if the literal appears elsewhere
  in the same script, e.g. inside a sed pattern) → connection dies, exit
  255, no output. Keep kill patterns disjoint from every other literal.
- swaylock GOTCHA: swayidle's 600 s timeout fired mid-session and every
  screenshot showed only the lock surface (uniform #1b1e20) — cost an hour
  of phantom debugging. swayidle now removed permanently (user decision).
- Domain `bazzite-labwc-test` RUNNING; host completely untouched.

## Domain XML state (current)

virtio video `accel3d=on blob=on`; `<memoryBacking><source type='memfd'/>
<access mode='shared'/>`; spice **`gl=on`** `listen=none` (egl-headless
REMOVED again); image compression off; guest-agent channel; qemu:commandline
NIC (hostfwd 2222) pinned slot 0x12. cpu host-passthrough.
Guest session keeps WLR_NO_HARDWARE_CURSORS=1 (software cursor).
PERF LESSON: software cursor + egl-headless readback + compression off =
pathological (every cursor move → full-frame raw readback; QEMU 64% CPU,
minutes of lag, guest idle). Scanout (gl=on) is the only performant local
path once software cursors are in play. If a defined-sprite ever reappears
flipped in the EGL widget, that's the old spice-gtk EGL bug — but with sw
cursors the guest defines no sprite, so nothing to draw wrong.

## OPEN ISSUE — cursor flipped upside-down + offset in viewer

Causal chain established so far:
- gl=on scanout: flipped cursor. blob=on: no change. gl=off/egl-headless:
  STILL flipped → the flip is SERVER-SIDE: labwc renders cursor sprite via
  GL (virgl texture); QEMU's virgl cursor readback is y-flipped (known wart).
  Client path (EGL vs cairo) irrelevant.
- `WLR_NO_HARDWARE_CURSORS=1` in ~/.config/uwsm/env (verified in session
  env) + FRESH console connection → user STILL saw flipped sprite.
  VERIFIED: wlroots 0.19 DOES honor WLR_NO_HARDWARE_CURSORS (string
  "forcing software cursors" present in /usr/lib64/libwlroots-0.19.so).
  → Conclusion: the flipped sprite is defined by something EARLIER in boot
  (prime suspect: plasmalogin's kwin, which runs briefly even with
  autologin) and **QEMU's spice server replays the last-defined cursor to
  every new client** — fresh connections don't clear it.
  RULED OUT since: greeter theory dead (journal shows ZERO kwin this boot —
  plasmalogin-helper execs uwsm/labwc directly under autologin; the
  20-swcursor.conf GreeterEnvironment drop-in is harmless, left in place).
  VERIFIED: WLR_NO_HARDWARE_CURSORS=1 present in labwc's /proc/PID/environ →
  guest genuinely software-cursors; nothing in guest defines a HW cursor.
  → CURRENT THEORY: **virt-manager app caches the spice session (and its
  last cursor sprite) across console-window closes** — it keeps the
  connection for thumbnails, so the user never got a fresh session.
  TEST IN FLIGHT: guest cleanly powered off; user asked to FULLY QUIT
  virt-manager (app, not just console window), relaunch, start domain,
  check cursor. CAUTION: domain QEMU lives inside the flatpak sandbox —
  power off guest before quitting the app or the VM may be hard-killed.
  If flipped sprite STILL appears after cold viewer start → apply
  relative-mouse endgame (below) without further investigation.
- Guaranteed fallback if no sw-cursor knob exists: **relative-mouse mode** —
  remove virtio-tablet + usb-tablet from domain (`virt-xml --remove-device
  --input type=tablet` twice if needed) → spice server-mouse mode → client
  never draws a cursor; single correct in-frame cursor; console grabs
  pointer (Ctrl+Alt releases). ALSO then remove WLR_NO_HARDWARE_CURSORS?
  NO — keep sw cursor in that case (HW cursor sprite would still be flipped
  server-side and composited by spice server into frames in server mode).
  i.e. endgame combo = relative mice + software cursor (if achievable) OR
  accept flipped (cosmetic only).
- Cursor bug is VM/virgl-only — does NOT affect the host migration at all.

## Gotchas (hard-won, don't rediscover)

- XML attrs need `&quot;` not `\"` (a `\"` in rc.xml Execute killed the whole
  config once — labwc silently falls back to ALL defaults on parse error).
- virt-xml graphics listen syntax: `listen=none` (not listen.type=none).
- Raw qemu:commandline devices bypass libvirt PCI planning — pin bus/addr.
- blob=on requires memfd+shared memoryBacking.
- ujust recipes may be interactive (TTY) — replicate their commands manually
  over SSH.
- uwsm app scope naming: app-<desktop>-<binary>-<rand>.scope under
  app-graphical.slice; over SSH desktop prefix is "uwsm".
- systemd-run --user --scope defaults to app.slice; --slice=session.slice
  for session-side placement.
- Fedora qemu flatpak extension ships firmware at /usr/share/edk2 (container)
  paths; OVMF vars per-domain under flatpak data dir.
- Podman runner and libvirt domain share disk.qcow2 — qcow2 locking prevents
  dual-run (2nd start errors); never force.

## 2026-07-20 evening: theming/env, square pager, titlebars (all verified)

Three user-reported problems fixed and screenshot-verified in the VM:

1. **Light-themed Dolphin from "New instance"** — root cause was NOT theming
   config: `uwsm app` defaults to a *scope* (child of caller → inherits
   caller env). sfwbar had been restarted over ssh with a minimal env, so
   its children lacked `QT_QPA_PLATFORMTHEME=kde` (proof: light Dolphin's
   environ had `SSH_CLIENT` + no platformtheme; fuzzel-launched one was
   dark). Fix: `uwsm app -t service` in launch-new (all 3 branches),
   panel-menu "Restart panel", and the autostart sfwbar line — services get
   the session *activation env* regardless of caller. Verified: launch-new
   from a bare ssh env → dark Dolphin, unit
   `app-uwsm-gtk\x2dlaunch@…service` under app-graphical.slice.
2. **Pager cells square** — cell SVGs are now 14×14 (were 24×11), sfwbar
   inline css min-width/height 14px; bar ≈48px tall (user allowed 48–64).
3. **Window titlebars** — removed the blanket
   `<windowRule identifier="*" serverDecoration="no"/>` from rc.xml (it
   dated from over-reading "borderless fullscreen apps" in the KDE audit).
   PureBlack themerc (already deployed) renders black titlebars,
   #346c92 focus border. GOTCHA: labwc applies deco rules at MAP time —
   after `pkill -HUP -x labwc`, only newly opened windows get titlebars;
   pre-existing ones must be reopened.

4. **"Web Apps" (webapp-manager, GTK3) light** — separate path from the Qt
   fix: gsettings had prefer-dark but gtk-theme=Breeze (light); GTK3
   ignores color-scheme. Fixed: gsettings gtk-theme=Breeze-Dark +
   icon-theme=breeze-dark, and wrote ~/.config/gtk-{3,4}.0/settings.ini
   (Xwayland GTK apps need settings.ini — no XSettings daemon in labwc).
   See YOUR-SETUP.md "GTK app dark theme" incl. host note (kde-gtk-config
   output in $HOME may already cover the host).

5. **Vivaldi flatpak light** — portal color-scheme verified prefer-dark
   even INSIDE the sandbox (gdbus test), host dconf visible to it too;
   Vivaldi's own OS-theme detection still said light (its chrome is its
   own theme engine, not GTK — GTK_THEME override had no effect and was
   reverted; overrides reset to clean). User set Vivaldi theme Dark
   manually. Full analysis + deterministic Preferences fallback in
   YOUR-SETUP.md "Flatpak apps / Vivaldi". Open follow-up: check
   websites' prefers-color-scheme inside Vivaldi.

sfwbar now runs as `app-uwsm-sfwbar@….service` (not scope) with clean env.
Old undecorated/light test windows were closed; VM left with one foot +
one dark decorated Dolphin + Steam sign-in, desktop "left top".

## 2026-07-20 night: tiling binds, launcher toggle+icon, IntelliJ-safe keymap, DM-less boot, Xwayland HiDPI (satellite adopted)

1. **Meta+Alt+Up/Down = top/bottom half** (`SnapToEdge` up/down) — added to
   rc.xml, virsh-send-key verified with screenshots.
2. **Meta tap now TOGGLES fuzzel** — new `final-configs/fuzzel-toggle`
   (zombie-proof /proc state check), wired into meta-tap-launcher CMD
   (which now also sets SIGCHLD=SIG_IGN; it used to leak a zombie per
   launch), the F13 bind, and the new **panel launcher icon** (sfwbar
   `image "launcher"`, breeze-dark start-here-kde.svg by absolute path —
   the colored-dots+chevron design IS that icon). All verified both ways
   by injected input (virsh send-key + qemu-monitor-command clicks;
   headless qmp.py port 4444 is NOT available while the user's
   virt-manager runs the domain — use `flatpak run --command=virsh
   org.virt_manager.virt-manager -c qemu:///session ...`).
3. **IntelliJ Windows keymap safety**: removed Ctrl+F1–F4 and Alt+F1 binds,
   moved client menu Alt+F3→Alt+Space. Rule + rationale in YOUR-SETUP.md.
   labwc default binds audited — all safe, and they load even without
   `<default/>`.
4. **DM-less boot (user hard requirement, no SDDM/any DM)**: plasmalogin
   disabled; getty@tty1 autologin drop-in + `uwsm check may-start &&
   exec uwsm start -- labwc` in ~/.bash_profile. Survives reboots;
   session exit auto-relogs (this is now the standard way to restart the
   session: `systemctl --user stop wayland-wm@labwc.service`, getty
   brings it back in ~10 s). NB `systemctl --user restart` of the WM unit
   gets CANCELED by uwsm's teardown — stop, don't restart.
5. **X11 blur at scale 2 (RustDesk problem) — comparison done, satellite
   adopted (user's decision after seeing it)**:
   - baseline: stock Xwayland+labwc = blurry (2x linear upscale).
   - HiDPI-patched Xwayland (AUR hidpi.patch on xwayland 24.1.13, built
     in fedora:44 container): CRISP, verified (Steam QR pixel-sharp).
     Gotchas hit: wlroots bakes the Xwayland path (use WLR_XWAYLAND env,
     PATH is ignored); meson xkb dirs must match Fedora or the server
     aborts ("XKB: Failed to compile keymap"); binary parked inert at
     /usr/local/bin/Xwayland; recipe = final-configs/build-xwayland-hidpi.sh
     + xinitrc + xsettingsd.conf. DEMOTED to fallback (patch upkeep).
   - **xwayland-satellite 0.8.1: CRISP, adopted.** Layered via rpm-ostree;
     shipped user unit enabled with drop-in
     (final-configs/xwayland-satellite-override.conf): pins `:12` and,
     crucially, `ExecStartPost=systemctl --user set-environment
     DISPLAY=:12` — uwsm finalize re-exports labwc's DISPLAY=:0 into the
     activation env AFTER our env file, and the satellite unit (ordered
     after graphical-session.target = after finalize) is the only
     deterministic place to win that fight. labwc's own Xwayland is
     disabled via `WLR_XWAYLAND=/nonexistent-…` in uwsm env (spawn fails
     at startup, wlroots still sets DISPLAY=:0 in labwc's env — hence
     the ExecStartPost). uwsm env also gained
     `_JAVA_AWT_WM_NONREPARENTING=1` (Java/IntelliJ blank-window fix
     under satellite, per upstream README). The native
     `spice-vdagent.service` is also ordered after satellite and pinned to
     `DISPLAY=:12` by `final-configs/spice-vdagent-override.conf`; without
     this drop-in it races satellite at login, exits against stale `:0`,
     and breaks viewer-driven resizing.
   - gamescope: stretches desktop app windows (game-scaler) — rejected;
     FSR/NIS "Lossless Scaling" style inherits the problem. labwc
     nearest-filter patch: not built, moot.
   - End-to-end verified after reboot: `uwsm app -t service -- gtk-launch
     com.rustdesk.RustDesk` → satellite window, correct size, crisp.
   - Mixed-DPI caveat for host (2x + 3x monitors): satellite picks ONE
     factor (smallest monitor DPI) — same class of limitation as KDE's
     global [Xwayland] Scale=3 (found in host kwinrc).
6. VM state: DM-less autologin, satellite session-primary (DISPLAY=:12,
   survives cold boot), sfwbar with launcher icon, one RustDesk window
   open. rustdesk flatpak still installed (user plans AppImage later).
   ~/xwl-build in guest holds sources, logs, both Xwayland builds, and
   the extracted satellite RPM tree.
7. **Steam autostart DISABLED (user request, verified across reboot)**:
   Steam's entry was user-level (~/.config/autostart/steam.desktop, Steam
   self-installs it; NOT /etc/xdg/autostart) → generator unit
   app-steam@autostart.service. Masked with Hidden=true in place of that
   file. If Steam is ever wanted at login again: delete the mask and
   re-enable inside Steam's settings (it rewrites the entry).

## 2026-07-20 late: launcher anchored to icon, square corners, click-outside dismiss

1. **fuzzel.ini promoted to final-configs/** — it previously existed only as
   a heredoc in guest-yourfeel.sh. New canonical file deployed to guest
   ~/.config/fuzzel/fuzzel.ini. Changes: `anchor=bottom-left` (fuzzel
   respects sfwbar's exclusive zone → zero margins land it flush above the
   panel, right over the launcher icon, Kickoff-style), `[border] radius=0`
   (square corners), `keyboard-focus=on-demand`.
2. **Click-outside closes the launcher** via two complementary mechanisms:
   (a) on-demand keyboard focus + fuzzel's default exit-on-keyboard-focus-loss
   → any click that focuses a window (incl. taskbar buttons, new windows
   mapping) closes it; (b) bare-desktop clicks don't move keyboard focus in
   labwc, so rc.xml Root-context mousebinds run `pkill -x fuzzel` on
   Left/Middle/Right press. The old `Left → None` unbind (which existed to
   suppress labwc's default left-click root menu) became `Left → Execute
   pkill`; Middle/Right re-state their default menus in the same bind
   because a user bind on the same button REPLACES the default.
3. **Verified by injected input** (virsh send-key / qemu input-send-event;
   QMP abs coords are 0–32767 across 2160×3570 physical): typing still
   filters under on-demand focus ("do" → Dolphin); new window mapping
   closes it; click on window closes it; left-click desktop closes it;
   right-click desktop closes it AND opens root menu; click INSIDE fuzzel
   keeps it open; anchored position + square corners screenshot-confirmed.
4. Known dead spot (documented in YOUR-SETUP.md): clicks on empty panel
   strip/clock close nothing — sfwbar takes no keyboard focus and isn't
   Root context. Acceptable per KDE parity (panel clicks there don't
   dismiss Kickoff either... actually KDE does dismiss; revisit only if it
   ever bothers the user — would need an sfwbar background action).
5. Doc updates: YOUR-SETUP.md launcher section + host application order
   step 4 (fuzzel.ini now copied from final-configs, fix `terminal=` path);
   MIGRATION-PLAN.md "rules that carry" bullet rewritten for the new Root
   mousebinds.

## 2026-07-20 later: panel tray-end alignment, volume icon, clock calendar

1. **Tray-end misalignment** (user screenshot: tray icon / "100%" / clock
   at three different heights): fixed with `-GtkWidget-valign: center` on
   grid#tray, #volume, grid#clock. Verified by zoomed panel screenshot.
2. **Volume icon, 3 states (user request: Material Symbols)**: label value
   is the ligature name — volume_off (muted) / volume_down (<50) /
   volume_up (>=50); pango renders ligatures, no PUA codepoints needed.
   Tooltip keeps the numeric %. Font not packaged in Fedora — variable TTF
   downloaded from google/material-design-icons `variablefont/` into
   final-configs/fonts/ AND guest ~/.local/share/fonts (+fc-cache). All
   three states screenshot-verified via wpctl set-volume/set-mute.
3. **Clock click actions (user request)**: both buttons → Function
   "XCalPopUp" from cal.widget (see YOUR-SETUP.md for the patch list:
   AutoClose, cal_cell_today highlight, black/#346c92 theme). Set on the
   clock grid AND the time/date child labels (children swallow clicks).
   Verified: left-click opens (today highlighted, correct weekday),
   next-month arrow navigates to August, desktop click AutoCloses
   (pixel-mean check), right-click reopens reset to current month.
4. **Failed first approach — document to avoid repeating**: fed
   `cal --color=always` (ANSI→pango via a cal-pango script) through
   scanner Exec+Grab into popup labels. Three strikes: Grab() is
   line-based (keeps last line only; aggregators First/Last/Sum/Product,
   nothing concatenates), `&#10;` in label text does not line-break, and
   U+2028 renders as a literal ↵ glyph in GTK labels. cal-pango deleted
   from final-configs and guest; the shipped
   /usr/share/sfwbar/cal.widget grid approach replaced it entirely.
5. sfwbar restart procedure used throughout: `pkill -x sfwbar`, then with
   session env (`XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0`)
   run `uwsm app -t service -- sfwbar </dev/null >/dev/null 2>&1`.

## 2026-07-20 night: swaync theme, Win+E, busy-cursor launch feedback

User batch: notifications #000/no rounded borders; Win+E → Dolphin;
cursor should become a rotator with the app's icon while launching;
Gear Lever "broken" from launcher.

1. **swaync** (the running daemon on the image; stock config, no user
   files existed): `final-configs/swaync-style.css` → guest
   `~/.config/swaync/style.css`. Full stock sheet + override block at the
   end (user file REPLACES /etc/xdg/swaync/style.css, and everything is
   `:root` CSS custom properties — later block wins). Verified with a
   replica of the user's Vivaldi download notification. Gotchas:
   `notify-send -A` blocks until the notification closes (background it);
   `pkill -f <pattern>` over ssh kills the remote shell itself if the
   pattern appears in its own cmdline — use `[b]racket` patterns.
2. **Win+E → Dolphin** keybind added to rc.xml; verified via injected
   KEY_LEFTMETA+KEY_E (dolphin count 1→2, window screenshot).
3. **Launch feedback**: `final-configs/launch-feedback` (python, deployed
   to ~/.local/bin, wired into fuzzel launch-prefix + W-Return + W-e).
   Key discoveries (all VM-verified): labwc SIGHUP re-reads XCURSOR_THEME
   from ~/.config/labwc/environment; wlroots ANIMATES multi-frame
   xcursors (3 captures of breeze `wait` differed); XCursor format is
   premultiplied ARGB, breeze nominal-24 = 32px canvas hotspot (4,4);
   Bazzite lacks xcursorgen/rsvg-convert/lswt but has ImageMagick+PIL —
   xcursor written from scratch in python, SVG icons via magick.
   Verified end-to-end: 4-shot cursor timeline (spinner+Dolphin icon over
   desktop at 0.35 s/0.7 s with ring rotation, breeze arrow restored by
   1.2 s), env file restored, fuzzel→Gear Lever flatpak path generated
   it.mijorus.gearlever.xcur and reverted cleanly.
   LIMIT (documented, inherent): compositor cursor shows only over
   desktop + SSD decorations; app windows set their own cursor.
   ~/.config/labwc/environment now exists pinning
   XCURSOR_THEME=breeze_cursors on both guest and final-configs docs.
4. **Gear Lever flakiness — WONTFIX per user** ("not worth diagnosing").
   Observed once: fuzzel Enter → no scope, no process, fuzzel closed.
   Every retest (exact Exec line, fuzzel UI Enter) launched fine.
5. Docs: YOUR-SETUP.md new section "Notifications, Win+E, launch
   feedback" + host application order updated (swaync-style.css,
   launch-feedback, environment file). VM left on desktop 1, one Dolphin
   window, Vivaldi + foot running, no stray test windows/notifications.

## 2026-07-20 latest: window decorations — no shadows, no rounding, no focus highlight

User batch: (a) kill window shadows ("Web Apps" had them), (b) no rounded
window corners anywhere ("Bazzite Portal" had them on top), (c) no
highlighted border on the focused window (Bazzite Portal + Dolphin showed
light-blue). All three fixed and pixel-verified.

1. **Decoration matrix established** (before/after screenshots): Qt →
   labwc SSD; GTK4 → ALSO labwc SSD (GTK4 dropped xdg-decoration, no
   preference stated, labwc default `decoration=server` decorates it;
   Bazzite Portal = yafti_gtk.py, GTK4/libadwaita); GTK3 → CSD with own
   shadow + rounding (Web Apps = webapp-manager, GTK3); Vivaldi → own
   square frame. So "Bazzite Portal's rounded tops" were labwc's SSD
   cornerRadius (default 8, invisible black-on-black, visible overlapping
   another window), and its cyan border was the themerc, same as Dolphin.
2. **Fixes**: themerc `window.active.border.color` #346c92 → #1a1a1a
   (= inactive; themerc now saved as `final-configs/themerc` — it was
   guest-only before, and host order step 3 now copies it;
   guest-yourfeel.sh heredoc updated too). rc.xml `<theme>` gained
   `<cornerRadius>0</cornerRadius>`. New `final-configs/gtk3.css` /
   `gtk4.css` appended to guest `~/.config/gtk-{3,4}.0/gtk.css`
   (decoration/window.csd: border-radius 0, box-shadow none) + global
   `flatpak override --user --filesystem=xdg-config/gtk-3.0:ro
   --filesystem=xdg-config/gtk-4.0:ro`. GTK reads user CSS at app start
   only; labwc reloaded via SIGHUP.
3. **Verified**: Web Apps square + zero shadow; Bazzite Portal square SSD
   top corners; focused Portal and focused Dolphin border sampled =
   exactly #1a1a1a (histogram check), no #346c92 anywhere.
4. **Gotchas hit**: yafti_gtk.py REQUIRES the config arg
   (`yafti_gtk.py /usr/share/yafti/yafti.yml` — bare launch prints usage
   and exits; the "working" earlier window was the user's own instance).
   pkill bracket trick ONLY protects the pkill's own argument — another
   literal `yafti_gtk.py` later in the same ssh command line still
   matched and killed the remote shell (exit 255): keep kill and relaunch
   in SEPARATE ssh invocations. Guest gtk-4.0/gtk.css had KDE-generated
   `@import` lines (one target missing) — appended after them, works.
5. Docs: YOUR-SETUP.md new "Window decorations" section, titlebar table
   row updated, host order steps 3/3a updated. VM resting state: Vivaldi +
   foot running (user had closed Dolphin themselves), test windows closed,
   guest /tmp cleaned.

## 2026-08-01: Auto-resize boot regression fixed

The first cold boot after adopting xwayland-satellite exposed an ordering
race. At boot monotonic time 19.734, systemd started `spice-vdagent.service`;
at 19.770 it exited because `DISPLAY=:0` had no X server. Systemd did not
mark satellite started on `:12` until 20.036. With no connected SPICE guest
agent,
spice-gtk queued no monitor configuration, so QEMU left the virtio-gpu
preferred mode at 1280x800 and the follower correctly had nothing to apply.

Fix: `~/.config/systemd/user/spice-vdagent.service.d/override.conf` now
requires and starts after `xwayland-satellite.service`, with explicit
`DISPLAY=:12`. The canonical file is
`final-configs/spice-vdagent-override.conf`. After restarting the agent, the
SPICE virtio channel became connected. A cold reboot then proved the fix is
durable: satellite started at boot monotonic time 14.156 and the agent only
started at 14.419, after satellite was ready. The agent stayed active, the
channel was connected, and its boot journal contained no X-server connection
failure. Host console frames 900x1000 and 700x1500 produced guest preferred
and current modes 1800x1810 and 1400x2810 respectively, preserving output
scale 2. Explicitly restarting satellite also restarted the agent through the
`Requires` dependency; the channel reconnected and another resize succeeded.
The VM is running with the console at 900x1000 and guest mode 1800x1810.

## 2026-08-29: CachyOS ZFS no-desktop validation

The retained CachyOS VM reused the final configs from this directory on UWSM 0.26.2,
labwc 0.20.2,
sfwbar beta17,
and xwayland-satellite 0.8.2.
The black desktop,
3×3 pager,
fuzzel toggle and outside-click dismissal,
taskbar **New instance** menu,
calendar popup,
dark pavucontrol,
and separate UWSM app services all passed through VM framebuffer input.

Two portability corrections landed:

- CachyOS defaults new users to Fish.
  Keep Fish and use a `~/.config/fish/conf.d/` bridge with Fish syntax instead of forcing Bash for tty1 autologin.
  Cold boot and compositor-stop respawn both returned to labwc automatically.
- `launch-feedback` now starts apps through `uwsm app -t service --`.
  Scope mode inherited labwc's stale `DISPLAY=:0` after UWSM finalization.
  Service mode received xwayland-satellite's activation environment at `DISPLAY=:12` and produced an independent
  `app-labwc-foot@….service`.

CachyOS Hello and pavucontrol initially used a light GTK theme.
Installing `breeze-gtk` and selecting Breeze-Dark through GSettings made a fresh pavucontrol instance dark.
The CachyOS validation evidence and rollback results live in
`/var/home/user/Monochromatic/doc/handover/cachyos-zfs-vm-validation.md`.

## Historical VM state at end of 2026-07-20

Powered off cleanly (virsh shutdown → ACPI → logind graceful poweroff) at
the user's request; domstate confirmed "shut off". Before shutdown, every
deployed guest config was diffed against its `final-configs/` canonical
copy — rc.xml, PureBlack themerc, gtk3.css, gtk4.css (appended tail),
flatpak global override: all identical.

The VM is libvirt-managed inside the virt-manager flatpak (NOT run-vm.sh,
which is a leftover from the initial standalone-QEMU install phase; its QMP
port 4444 does not exist on the libvirt instance). To boot again:
  flatpak run --command=virsh org.virt_manager.virt-manager \
    -c qemu:///session start bazzite-labwc-test
then ssh -p 2222 -i id_ed25519 user@127.0.0.1 once it's up. For monitor
commands use `virsh qemu-monitor-command`, not qmp.py.
`disk-clean-labwc-uwsm.qcow2` remains the clean baseline snapshot.

## If continuing after compaction

1. Read this file + MIGRATION-PLAN.md + YOUR-SETUP.md.
2. Cursor/display/resize issues: ALL RESOLVED (see sections above) — don't
   reopen. 3×3 grid pager: DONE 2026-07-20 (YOUR-SETUP.md has the design).
3. Remaining nice-to-haves (unclaimed): persist resolution via kanshi config;
   themed root menu (menu.xml); per-window auto shortcut-guard via
   wlr-foreign-toplevel watcher — the raw-wire `Client` class in
   `final-configs/wlr-pager` is the natural base for it (no pywayland
   needed); key-helper labwc port (user's Monochromatic repo).
4. Host migration itself: MIGRATION-PLAN.md steps 0–7 + YOUR-SETUP.md
   "Host application order". Not yet executed on host — user decides when.
