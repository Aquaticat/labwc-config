# Making labwc feel like *your* Plasma (not stock Plasma)

Based on an audit of the real host config (kdeglobals, kwinrc, appletsrc,
kglobalshortcutsrc, autostarts) and a full-desktop spectacle screenshot —
then built and key-injection-tested in the Bazzite VM. Final configs ready
for host reuse live in `final-configs/`.

## What your setup actually is

- Pure-black custom color scheme (all backgrounds `#000000`, fg `#EFF0F1`,
  selection `#6060C0`, focus accent `#346C92`), Inter Variable + JetBrains
  Mono, animations ~disabled, most KWin effects off.
- Every monitor: thin black bottom panel, text-label taskbar, no pinned
  launchers; one panel additionally carries a 3×3 pager, tray, two-line clock.
- 9 virtual desktops in a 3×3 grid ("left top" … "right bottom"),
  keyboard-driven: Meta+Ctrl+arrows navigate, Meta+Ctrl+Shift+arrows move
  windows, Meta+F1–F4 direct (Ctrl+F1–F4 variants dropped 2026-07-20 —
  IntelliJ keymap safety, see below), borderless fullscreen apps.
- Terminal: OdyTTY AppImage via GearLever (ghostty retired). Autostarts:
  KeePassXC, Telegram, pCloud, LibreWolf, Fastmail, music-player, ydotoold.
  Deprecated (excluded): hall-monitor, neovide.
- Custom tooling: key-helper (KWin script + D-Bus service + ydotool) — needs
  a labwc-side port, see gaps.

## What was replicated in the VM (all verified)

| Yours (KDE) | labwc equivalent | Status |
|---|---|---|
| Black scheme + fonts | host kdeglobals copied; panel/fuzzel/labwc themed to match; Inter VF + JetBrains Mono layered | ✓ screenshot-verified |
| Panel | **sfwbar** (replaced waybar 2026-07-20 — see "Panel: sfwbar" below): black, 3×3 pager, text taskbar with real right-click window menu incl. **New instance**, tray, volume %, 2-line clock | ✓ all QMP-click-verified |
| 3×3 pager | 9 explicit `loc(col,row)` image cells in the sfwbar grid, fed by `wlr-pager watch` (raw ext-workspace-v1 client, stdlib Python); click = switch, scroll = cycle, active cell purple | ✓ true 3×3 mini-grid, verified |
| 9-desktop grid nav | labwc 9 desktops, your names; Meta+Ctrl+Left/Right = ±1; Up/Down = triple-hop ±3 with wraparound; Meta+F1–F4 direct | ✓ injected-key verified |
| Window titlebars (black) | labwc server-side deco + PureBlack themerc (black titlebar, Inter font; border #1a1a1a focused AND unfocused — focus highlight removed 2026-07-20 late, was #346c92). The earlier blanket `serverDecoration="no"` rule hid ALL titlebars — removed 2026-07-20. NB labwc applies deco rules at map time: reconfigure affects only newly opened windows | ✓ |
| Quick tile / maximize / minimize / move-to-screen | SnapToEdge, ToggleMaximize, Iconify, MoveToOutput on your exact binds; **Meta+Alt+Up/Down = top/bottom half** (added 2026-07-20) | ✓ injected-key verified |
| Meta tap → launcher | **meta-tap-launcher** (see below) → `fuzzel-toggle`: tap opens fuzzel, tap again **closes** it (2026-07-20); same toggle on F13 and the panel launcher icon | ✓ injected-tap verified both ways |
| "Ignore global shortcuts" for RustDesk | **Meta+F12 shortcut guard** (see below) | ✓ suspend/restore verified |
| Klipper (Meta+V) | cliphist + fuzzel picker | ✓ |
| Terminal | OdyTTY AppImage integrated via GearLever CLI (`flatpak run it.mijorus.gearlever --integrate ... -y`) | ✓ |
| Wallpaper | none — you don't want one; swaybg dropped from autostart entirely | ✓ |

## meta-tap-launcher (bare-Meta tap, your keyd concerns respected)

`final-configs/meta-tap-launcher` — ~90-line Python daemon, passive evdev
*observer*: no exclusive grab, no uinput re-emission, so it cannot conflict
with ydotoold or any other input tooling (the failure mode you hit with keyd).
Tap = Meta down→up with no other key/button between, ≤400 ms — KDE semantics.
Runs as a uwsm-scoped autostart. Requires `input` group; note Bazzite keeps
the `input` group in `/usr/lib/group`, so membership needs the group copied
into `/etc/group` first — `ujust add-user-to-input-group` does exactly this
(it's interactive; the non-interactive equivalent is
`getent group input | sudo tee -a /etc/group` + `sudo usermod -aG input $USER`).
Log out/in afterwards.

## Shortcut guard (your RustDesk window rule, generalized)

Verified fact: labwc 0.9.6 does **not** implement the
`keyboard-shortcuts-inhibit-v1` protocol (checked via `wayland-info`), so
KWin-style automatic per-window "ignore global shortcuts" has no native path.
The working equivalent:

- **Meta+F12** → labwc `ToggleKeybinds` (all compositor binds off/on; the
  toggling bind itself stays alive) — covers every app including X11 ones
  like RustDesk.
- The watcher detects the same chord on evdev and toggles its own
  `~/.cache/shortcuts-suspended` flag (with a notification), so Meta-tap goes
  quiet too. Decoupled on purpose: works even while labwc binds are disabled.
- Future automation (per-window-class like your KWin rule): a small
  `wlr-foreign-toplevel` watcher flipping the same flag when RustDesk
  focuses — python3-pywayland is packaged; natural Monochromatic addition.

## Panel: sfwbar (adopted 2026-07-20, replaced waybar)

Your two hard requirements — a true 3×3 grid pager AND "new instance of app"
on taskbar right-click — ruled out both waybar (fixed-action clicks only, no
per-window menus possible) and lxqt-panel 2.4.1 (real per-window menu, but
fixed: no way to add a New-instance item). **sfwbar 1.0~beta16** delivers
both: taskbar right-click menus are user-defined config, and its actions run
in the context of the clicked window (`WindowInfo("appid")` resolves the app).

Files: `final-configs/{sfwbar.config,launch-new,wlr-pager,panel-menu,
cell-normal.svg,cell-focused.svg}` → `~/.config/sfwbar/` (config + svgs),
`~/.local/bin/` (scripts). Autostart: `uwsm app -t service -- sfwbar &`
(bar itself spawns `wlr-pager watch` via ExecClient — no separate daemon
anymore). `-t service` matters: see the env-inheritance gotcha below.

What each part does (all verified live via QMP-injected clicks):

- **Taskbar right-click menu** (`menu("winops")`): New instance /
  (Un)minimize / (Un)maximize / Close. "New instance" = `launch-new
  $(WindowInfo("appid"))` → resolves the .desktop (exact, then
  case-insensitive), launches via `uwsm app -t service -- gtk-launch`
  (own unit, clean session env — cgroup- and theme-verified with Dolphin).
  Left = focus, middle: add `action[2] = Close` if wanted.
- **3×3 pager**: nine image widgets at explicit `loc(col,row)` in a grid —
  immune to sfwbar's item-ordering quirks (see gotchas). Cells are SQUARE
  14×14 SVGs (`cell-normal.svg`/`cell-focused.svg`, per explicit user
  requirement — sets bar height ~48px), state from `wlr-pager watch`
  (raw ext-workspace client) via ExecClient scanner var `$PagerActive`;
  click = `wlr-pager activate N`, scroll = prev/next, tooltip = name.
  Grid table lives in `wlr-pager` and **must match rc.xml `<names>`**.
- **Empty bar area**: spacer label, right-click → `panel-menu` (fuzzel:
  audio / lock / services / restart panel / logout).
- **Volume**: pulsectl module label `NN%`/`muted`; left = pavucontrol,
  right = wpctl mute toggle, scroll = ±2%.
- **Clock**: two-line (HH:MM / date). Calendar popup: sfwbar ships
  `cal.widget` — candidate polish, not wired yet.
- **Tray**: SNI, flattened dark (nm-applet, xwaylandvideobridge shown).

sfwbar gotchas learned (evidence in HANDOVER.md):

- Style-name → CSS (`#stylename`) works for plain labels (clock) but did NOT
  apply to label cells with actions in beta16 — hence SVG image cells, whose
  `value` (a file path expression) needs no CSS at all. Inline `css =`
  property always works.
- Menus/items CSS: menu gets its config name (`#winops`), items `#menu_item`.
- Native `pager` widget lays items out in reverse arrival order; `pins`
  don't reorder existing workspaces and `-GtkWidget-direction` didn't fix
  it — that's why the pager is hand-built from `loc()` cells.
- Launched outside the session, sfwbar needs `XDG_CURRENT_DESKTOP` and
  `WAYLAND_DISPLAY` exported (in-session autostart has them).
- `Exec` spawns without a shell: no `>>`/pipes in action strings — use
  helper scripts.
- **Env inheritance (light-Dolphin bug, 2026-07-20)**: `uwsm app` defaults
  to a *scope* unit = child of the caller, inheriting the caller's env. A
  panel restarted from ssh had no `QT_QPA_PLATFORMTHEME=kde`, so its "New
  instance" children came up light-themed. Fix: `uwsm app -t service` in
  launch-new / panel-menu / autostart — systemd spawns services from the
  session *activation env* (which `uwsm start` finalizes), immune to the
  caller. Qt/KDE apps need `QT_QPA_PLATFORMTHEME=kde` (set in
  `~/.config/uwsm/env`) to read the kdeglobals black scheme.

### GTK app dark theme (fixed 2026-07-20, "Web Apps" was light)

Qt apps get the black scheme via `QT_QPA_PLATFORMTHEME=kde`; GTK apps
(webapp-manager, etc.) are a separate path that nothing in a labwc session
sets up. The VM had `color-scheme=prefer-dark` but `gtk-theme=Breeze`
(light) — GTK3 apps ignore color-scheme and just render the named theme.
Fix (verified dark on webapp-manager):

- `gsettings set org.gnome.desktop.interface gtk-theme Breeze-Dark` and
  `icon-theme breeze-dark` (Wayland GTK apps read GSettings directly).
- `~/.config/gtk-3.0/settings.ini` + `~/.config/gtk-4.0/settings.ini`
  (theme/icons/font/prefer-dark/cursor) — needed by **Xwayland** GTK apps,
  which fall back to settings.ini since labwc has no XSettings daemon.

HOST NOTE: your KDE's kde-gtk-config already generates
`~/.config/gtk-{3,4}.0` css mapping your black scheme onto Breeze — those
files live in $HOME and persist into a labwc session, so host GTK apps may
already be right. Check first; apply the VM fix only if something is light.
GTK3 apps draw CSD headerbars (no labwc titlebar) — same as under KDE;
GTK4 apps get a labwc titlebar instead (see "Window decorations" below).

### Flatpak apps / Vivaldi (2026-07-20, unresolved upstream — worked around)

Verified facts, so nobody re-debugs this:

- The **settings portal works under labwc**, including from inside sandboxes:
  `org.freedesktop.portal.Settings ReadOne org.freedesktop.appearance
  color-scheme` returns `1` (prefer-dark) both on the host bus and via
  `flatpak run --command=gdbus com.vivaldi.Vivaldi …`. The existing
  `~/.config/xdg-desktop-portal/wlroots-portals.conf` routes this correctly.
  Well-behaved flatpaks (libadwaita, portal-aware) WILL follow dark.
- The Vivaldi flatpak additionally reads host dconf directly
  (`GSETTINGS_BACKEND=dconf`, `~/.config/dconf:ro`) and sees
  gtk-theme=Breeze-Dark + prefer-dark. No Breeze theme is mounted inside
  its sandbox (flathub has no org.gtk.Gtk3theme.Breeze-Dark), but that
  doesn't matter: **Vivaldi's chrome uses its own theme engine, not GTK**
  (`GTK_THEME=Adwaita:dark` override tested → no effect → removed).
- Vivaldi defaults to Theme Schedule = "Operating System"
  (prefs: `vivaldi.theme.schedule.enabled="system"`, o_s mapping
  light→Vivaldi1, dark→Vivaldi2) yet detected "light" despite the portal
  saying dark — a Vivaldi-side detection bug/quirk under wlroots.
  RESOLUTION: user set Vivaldi's theme to Dark manually in
  vivaldi://settings/themes. Deterministic config-file equivalent if ever
  needed: quit Vivaldi, then in
  `~/.var/app/com.vivaldi.Vivaldi/config/vivaldi/Default/Preferences` set
  `vivaldi.theme.schedule.enabled="off"` + `vivaldi.themes.current="Vivaldi2"`.
- Follow-up worth checking in Vivaldi: whether *websites*'
  `prefers-color-scheme` sees dark (same broken detection would make sites
  render light; Vivaldi Settings → Webpages has a preferred color scheme
  override).

Status of the alternatives (both still installed in the VM):

- waybar rig kept as fallback in `final-configs/{waybar-config.jsonc,
  waybar-style.css}` + `wlr-pager daemon` mode (48px bar, 3×3 grid via
  nested groups, wired right-clicks — but taskbar menus impossible).
- lxqt-panel 2.4.1: full per-window menu (To Desktop/Move/Resize/…/Close
  verified), 3-row switcher (`rows=3`), calendar popup, GUI panel config —
  rejected only for the missing New-instance item.

## Keymap safety vs IntelliJ IDEA Windows keymap (2026-07-20)

Rule: labwc grabs ONLY Super-based combos plus the Alt combos that are
OS-owned on Windows (Alt+Tab, Alt+F4, Alt+Space — IntelliJ deliberately
leaves those alone). Removed as conflicts: **Ctrl+F1–F4** (error
description / stop / find word / close tab) and **Alt+F1** (Select In).
Client menu moved **Alt+F3 → Alt+Space** (the Windows system-menu key;
labwc's own default too). F13, Print, and all W-* binds can't collide —
the Windows keymap never uses Super. labwc's built-in defaults (checked
against the keymap one by one) are all safe; they load regardless of
`<default/>`, so future labwc updates deserve a re-check of `man
labwc-config` "default keybinds".

## Launcher: toggle + panel icon (2026-07-20)

- `final-configs/fuzzel-toggle` (`~/.local/bin/`): kills a live fuzzel or
  starts one (`uwsm app -- fuzzel`). Zombie-proof: checks /proc state, a
  defunct fuzzel doesn't count as "open" (meta-tap-launcher previously
  leaked zombies; it now sets SIGCHLD=SIG_IGN — fixed the same day).
- Wired into: meta-tap-launcher CMD, the F13 keybind, and a new sfwbar
  `image "launcher"` widget (leftmost, breeze-dark `start-here-kde.svg` via
  absolute path — the colored-dots-plus-chevron design IS that icon).
  Click-verified open AND close via injected input.
- **Kickoff-style placement + dismissal (2026-07-20 later):**
  `final-configs/fuzzel.ini` is now the canonical config (previously only
  generated inline by guest-yourfeel.sh). `anchor=bottom-left` pops it up
  directly above the panel's launcher icon (fuzzel respects sfwbar's
  exclusive zone, so zero margins land it flush on the panel top);
  `[border] radius=0` squares the corners.
- **Click-outside closes it**, two mechanisms:
  - `keyboard-focus=on-demand` in fuzzel.ini: clicking any window (or a
    taskbar button, or a new window opening) moves keyboard focus away and
    fuzzel's `exit-on-keyboard-focus-loss` (default yes) closes it.
    Typing/filtering still works — on-demand surfaces get focus on map.
  - Bare desktop clicks never move keyboard focus in labwc, so rc.xml
    Root-context mousebinds run `pkill -x fuzzel` on Left/Middle/Right
    press. Left stays menu-free (the old `None` unbind); Middle/Right
    re-state their default menus (client-list-combined-menu / root-menu)
    because a same-button user bind replaces the default.
  - Verified: outside-click on desktop closes; click on window closes;
    right-click desktop closes AND opens root menu; click inside fuzzel
    does NOT close; Esc and Meta-tap still close.
  - Known dead spot: clicking empty panel strip (e.g. the clock) closes
    nothing — sfwbar takes no keyboard focus and isn't Root context.

## Panel tray-end polish: alignment, volume icon, clock calendar (2026-07-20)

- **Alignment**: tray, volume and clock were visibly misaligned (baseline
  drift between different font sizes). Fixed with `-GtkWidget-valign:
  center` on `grid#tray`, `#volume` and `grid#clock` in sfwbar CSS.
- **Volume icon** (replaces the "100%" text): Material Symbols ligatures —
  the label value is literally `volume_off` / `volume_down` / `volume_up`
  (mute / <50% / ≥50%) and the font renders them as icons. Hover tooltip
  still shows the numeric percentage. Font: variable-font Material Symbols
  Outlined TTF at `final-configs/fonts/MaterialSymbolsOutlined.ttf`,
  installed to `~/.local/share/fonts` + `fc-cache -f` (not packaged in
  Fedora; re-download via google/material-design-icons GitHub repo,
  `variablefont/` directory). CSS: `#volume { font-family: "Material
  Symbols Outlined"; font-size: 18px; }`.
- **Clock calendar popup** (left- OR right-click the clock): sfwbar ships
  an interactive calendar example at `/usr/share/sfwbar/cal.widget` — big
  clock + date header, month grid, prev/next month and year arrows. Our
  patched copy lives at `final-configs/cal.widget`, deployed to
  `~/.config/sfwbar/cal.widget`, pulled in with a top-level
  `include("cal.widget")` (user config dir wins over /usr/share). Patches
  vs upstream: `AutoClose = true` (click anywhere outside closes it), a
  `cal_cell_today` style highlighting today in #6060c0 (upstream doesn't
  mark today; the style expression compares the cell to XCalDay and checks
  the viewed month/year == current), and pure-black/#346c92 theming with
  square corners replacing the @theme_* GTK colors.
- **Dead ends worth remembering** (cost an hour): sfwbar's scanner is
  line-based — `Grab()` keeps only the last line of multi-line command
  output (aggregators are First/Last/Sum/Product, no concatenation), so
  a `cal`-output popup label can't be fed from an Exec source; pango
  `&#10;` entities and U+2028 LINE SEPARATOR do NOT produce line breaks
  in GTK labels (U+2028 renders as a visible ↵ glyph). The shipped
  cal.widget sidesteps all of that by building the grid from per-day
  labels — and is better anyway (navigation, live clock).

## Crisp X11-only apps on scaled outputs (2026-07-20, the RustDesk blur)

Stock Xwayland renders rootless surfaces at scale 1; labwc upscales →
blur at your scales (host kwinrc runs **[Xwayland] Scale=3**, i.e. KDE's
"apps scale themselves" — your crispness baseline). labwc/wlroots (incl.
labwc 0.20) has no equivalent.

**ADOPTED (your call): xwayland-satellite** — stock Xwayland presented to
the compositor as native toplevels via wp_viewporter; Fedora-maintained
package, nothing to patch or rebuild. Pixel-crisp (verified by 1:1 crops:
RustDesk sharp, Steam QR sharp) and windows DO get labwc titlebars (you
confirmed on-screen). Setup (rehearsed in VM):

- `sudo rpm-ostree install xwayland-satellite` + reboot.
- Shipped user unit (`Type=notify`, `WantedBy=graphical-session.target`)
  + display pinned via drop-in
  (`~/.config/systemd/user/xwayland-satellite.service.d/override.conf`:
  `ExecStart=/usr/bin/xwayland-satellite :12`);
  `systemctl --user enable xwayland-satellite`.
- `~/.config/uwsm/env`: `export DISPLAY=:12` and
  `export _JAVA_AWT_WM_NONREPARENTING=1` (Java apps — **IntelliJ** —
  render a blank window under satellite without it; per upstream README).
- VM-only resize fix: deploy `final-configs/spice-vdagent-override.conf` to
  `~/.config/systemd/user/spice-vdagent.service.d/override.conf`. It orders
  the native SPICE session agent after satellite and gives it `DISPLAY=:12`.
  Without it, both services race after `graphical-session.target`; the agent
  starts against stale `:0`, exits, and prevents virt-manager from sending
  monitor configurations. Keep the XDG desktop mask to avoid a duplicate
  autostart agent. Do not deploy this VM-only drop-in on the physical host.
- satellite is its own XSettings manager (GTK/Qt scale automatically;
  Wine-ish apps may need per-app DPI config). Mixed-DPI monitors: ONE
  factor, the smallest monitor's DPI — KDE-style limitation.
- labwc's built-in :0 Xwayland stays dormant.

Verified fallback (equally crisp, demoted because the patch must be
rebuilt on Xwayland releases): HiDPI-patched Xwayland, KWin model —
`final-configs/build-xwayland-hidpi.sh` (container build; the xkb meson
paths in it are load-bearing, wrong ones abort the server with "XKB:
Failed to compile keymap") + `WLR_XWAYLAND=/usr/local/bin/Xwayland` in
uwsm env (wlroots bakes the binary path at build — PATH shadowing does
NOT work) + `final-configs/xinitrc` (scale xprop, Xft.dpi, xsettingsd)
+ `final-configs/xsettingsd.conf` (XSettings reach only X11 apps; never
set GDK_SCALE globally — it double-scales Wayland GTK apps). The patched
binary is still parked at `/usr/local/bin/Xwayland` in the VM, inert.

Rejected: **gamescope** stretches app windows (game-scaler semantics),
FSR/NIS ("Lossless Scaling" style) inherit that; labwc nearest-neighbor
("pixelize") filter patch — moot with two fully crisp options.

## DM-less boot (2026-07-20, hard requirement: no display manager)

plasmalogin disabled; getty@tty1 autologin + `uwsm check may-start` →
`exec uwsm start -- labwc` in `~/.bash_profile`
(`final-configs/getty-tty1-autologin.conf`, `final-configs/bash_profile-snippet.sh`).
Session end → getty respawns → auto-relogin → session restarts itself
(verified: this is now also the recovery path after compositor exit).
ssh logins are untouched by the profile guard.

The CachyOS no-desktop installer selects Fish by default.
The retained CachyOS ZFS VM kept Fish and used
`~/.config/fish/conf.d/cachyos-zfs-labwc.fish` with Fish syntax instead of changing the login shell.
A cold boot and deliberate compositor stop both returned to the UWSM plus labwc session automatically.

## Honest gaps (labwc can't do these)

- No Overview / Present Windows / Grid View (Meta+W, Ctrl+F9/F10, Meta+G).
  Alt-Tab + pager only. niri (already layered on your host) covers this
  class of workflow if it ever matters more than stacking.
- KWin custom tiling (Meta+T editor, your [Tiling] layouts) → edge snapping only.
- Show Desktop (Meta+D), per-window KWin rules GUI, kwin translucency effect.
- key-helper-kwin: the KWin-script half needs a rewrite against labwc
  keybinds/D-Bus; ydotoold itself works unchanged under labwc.

## Notifications, Win+E, launch feedback (2026-07-20 night)

**Notifications (swaync)**: pure-black square theme via
`final-configs/swaync-style.css` → `~/.config/swaync/style.css`. swaync
loads the user file INSTEAD of `/etc/xdg/swaync/style.css`, so the file
is the full stock sheet with an override block appended at the end (all
knobs are CSS custom properties: `--noti-bg: 0,0,0`, `--border-radius:
0px`, border #346C92, accents #6060C0, Inter, square close button,
un-rounded primary image). Apply with `swaync-client --reload-css`.
Testing gotcha: `notify-send -A ...` (action button) BLOCKS until the
notification is acted on/closed — background it or it hangs the shell.

**Win+E → Dolphin**: rc.xml keybind (wrapped in launch-feedback, below).
Each press opens a new Dolphin window.

**Launch feedback (busy cursor)**: KDE-style "cursor becomes app icon +
spinner while the app starts". labwc has no launch-feedback support, but
two verified facts make a faithful hack possible: (1) labwc re-reads
`XCURSOR_THEME` from `~/.config/labwc/environment` on SIGHUP; (2)
labwc/wlroots animates multi-frame XCursors. `final-configs/launch-feedback`
(python, → `~/.local/bin/`) therefore: connects a
zwlr-foreign-toplevel watcher, spawns the app via `uwsm app -t service --`,
generates an animated XCursor (breeze arrow + app icon inside a rotating
#6060C0 ring; 12 frames × 50 ms; nominal sizes 24+48 for the 2× display;
written in pure python — premultiplied ARGB, no xcursorgen on Bazzite),
caches it per app in `~/.cache/launch-feedback/`, flips the cursor theme
to `launch-feedback` (Inherits=breeze_cursors so all other shapes stay
breeze) + SIGHUP, and reverts when the app's first window maps (or after
5 s, KDE's default), with a refcount for overlapping launches.
Icon resolution: flatpak app-id from the Exec line, otherwise desktop-file
Exec match → Icon=, SVGs rasterized with ImageMagick.
Service mode is load-bearing with xwayland-satellite.
CachyOS validation proved scope mode inherited labwc's stale `DISPLAY=:0`,
while service mode used the systemd activation environment at `DISPLAY=:12` and created an independent app service.
Wired into: fuzzel `launch-prefix`, W-Return (OdyTTY), W-e (Dolphin).
`~/.config/labwc/environment` now pins `XCURSOR_THEME=breeze_cursors`
(the script rewrites only that line; NORMAL_THEME constant in the script
if the cursor theme ever changes).
**Inherent limit**: the compositor cursor only shows over the desktop and
server-side decorations — app windows set their own cursor (Wayland
protocol boundary), so no feedback while hovering inside e.g. Vivaldi.
KDE composites its bouncing icon inside KWin; nothing external can do
that under labwc.

**Gear Lever via launcher — known flaky (user: not worth diagnosing)**:
one occurrence of fuzzel Enter → nothing spawned (no systemd scope at
all); immediate retest launched fine, direct Exec-line exec fine, repeated
fuzzel launches fine. If it recurs, just relaunch.

## Window decorations: no shadows, no rounding, no focus highlight (2026-07-20 late)

Who decorates what under labwc (all verified in the VM):

- **Qt apps** (Dolphin…) request server-side deco → labwc titlebar + border.
- **GTK4 apps** (Bazzite Portal…) ALSO get labwc SSD: GTK4 dropped
  xdg-decoration support, states no preference, and labwc's default
  `<core><decoration>server</decoration>` decorates such clients.
- **GTK3 apps** (Web Apps/webapp-manager…) explicitly request CSD → they
  draw their own headerbar, shadow and rounded corners; labwc adds nothing.
- Vivaldi/Chromium draws its own square, shadowless frame — fine as-is.

Three knobs make everything square, shadowless, and calm when focused:

1. **No focus highlight**: PureBlack themerc now sets
   `window.active.border.color: #1a1a1a` — identical to inactive (was
   #346c92, which read as a light-blue glow on Dolphin/Bazzite Portal).
   Canonical copy: `final-configs/themerc` (guest-yourfeel.sh's heredoc
   updated to match).
2. **No SSD rounding**: `<cornerRadius>0</cornerRadius>` in rc.xml's
   `<theme>` — labwc rounds SSD titlebar top corners 8px by default
   (invisible black-on-black, but obvious when a window overlaps another,
   e.g. Bazzite Portal).
3. **No CSD shadows/rounding**: `final-configs/gtk3.css` appended to
   `~/.config/gtk-3.0/gtk.css` (`decoration { border-radius: 0;
   box-shadow: none; }`) kills the GTK3 drop shadow + rounded corners
   (Web Apps was the offender); `final-configs/gtk4.css` appended to
   `~/.config/gtk-4.0/gtk.css` (`window.csd { … }`) covers any GTK4 app
   that stays CSD. Plus `flatpak override --user
   --filesystem=xdg-config/gtk-3.0:ro --filesystem=xdg-config/gtk-4.0:ro`
   so sandboxed GTK apps read the same files. GTK reads user CSS at app
   startup only — restart the app, not the compositor.

Labwc's own SSD drop shadows stay off (rc.xml `<dropShadows>` defaults to
no). Interior widget rounding (search fields, cards) is app design and
stays.

## Host application order (after the base MIGRATION-PLAN.md steps)

1. `rpm-ostree install sfwbar rsms-inter-vf-fonts jetbrains-mono-fonts
   python3-evdev` (fonts already local on host — layer for completeness/skip).
2. Input group: see meta-tap-launcher section above; log out/in.
3. Copy `final-configs/rc.xml` → `~/.config/labwc/rc.xml` (review the
   Execute paths), `final-configs/themerc` →
   `~/.local/share/themes/PureBlack/openbox-3/themerc` (mkdir -p first),
   `final-configs/{meta-tap-launcher,wlr-pager,launch-new,
   panel-menu,fuzzel-toggle,launch-feedback}` → `~/.local/bin/` (all +x).
   `echo XCURSOR_THEME=breeze_cursors > ~/.config/labwc/environment`
   (launch-feedback flips/restores this line around app launches).
3a. Decorations: append `final-configs/gtk3.css` to
   `~/.config/gtk-3.0/gtk.css` and `final-configs/gtk4.css` to
   `~/.config/gtk-4.0/gtk.css` (your KDE-generated gtk.css files exist on
   the host — append, don't overwrite), then `flatpak override --user
   --filesystem=xdg-config/gtk-3.0:ro --filesystem=xdg-config/gtk-4.0:ro`.
3b. Crisp X11 apps + DM-less boot: MIGRATION-PLAN.md steps 3–4 and 6b
   (xwayland-satellite package + unit drop-in, `DISPLAY=:12` +
   `_JAVA_AWT_WM_NONREPARENTING=1` in uwsm env, getty autologin,
   Bash profile snippet on Bazzite or Fish `conf.d` bridge on CachyOS).
4. Panel: `final-configs/sfwbar.config` → `~/.config/sfwbar/sfwbar.config`,
   `final-configs/cal.widget` → `~/.config/sfwbar/`,
   `final-configs/cell-{normal,focused}.svg` → `~/.config/sfwbar/`
   (fix the `/home/user/` paths inside sfwbar.config to your host $HOME);
   `final-configs/fonts/MaterialSymbolsOutlined.ttf` →
   `~/.local/share/fonts/` + `fc-cache -f` (volume icon);
   autostart line `uwsm app -t service -- sfwbar &`. Fuzzel:
   `final-configs/fuzzel.ini` → `~/.config/fuzzel/fuzzel.ini` (fix the
   `terminal=` AppImage path; supersedes the guest-yourfeel.sh heredoc).
   Swaylock config still per `guest-yourfeel.sh` (its waybar heredocs are
   obsolete). Notifications: `final-configs/swaync-style.css` →
   `~/.config/swaync/style.css` (swaync is on the Bazzite image; no config.json
   needed — defaults are fine).
   NOTE for your multi-monitor host: one sfwbar instance = one bar on one
   monitor by default; per-output bars need `-m <monitor>` instances or a
   `bar { monitor = ... }` block — untested in the single-output VM.
5. GearLever + OdyTTY AppImage (already on host — skip in migration).
6. Autostarts carry over automatically via XDG autostart under uwsm; mask
   any unwanted ones with `Hidden=true` overrides in `~/.config/autostart/`.
   No swayidle — you lock manually (Meta+L → swaylock).
