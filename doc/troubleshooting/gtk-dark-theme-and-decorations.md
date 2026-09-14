# GTK applications render light, rounded, or shadowed under labwc

## Metadata

- **Status**:
  Verified fixes.
- **Observed**:
  2026-07-20 in the Bazzite rehearsal with webapp-manager (GTK3),
  yafti (GTK4 with libadwaita),
  Dolphin (Qt),
  and the Vivaldi Flatpak.
  On 2026-08-29 in the CachyOS VM,
  pavucontrol rendered light until `breeze-gtk` was installed and Breeze-Dark was selected.
- **Evidence**:
  `archive/bazzite-rehearsal/HANDOVER.md`,
  sections dated 2026-07-20 evening and 2026-07-20 latest.

## A GTK3 application renders light although dark is preferred

### Root cause

A labwc session has no desktop settings daemon.
GTK3 ignores `color-scheme=prefer-dark` and renders the theme named in `gtk-theme`,
which was light Breeze.
X11 GTK applications do not read GSettings;
without an XSettings manager for their theme,
they read `settings.ini`.

### Fix

Set the theme through GSettings for Wayland GTK applications:

```bash
gsettings set org.gnome.desktop.interface gtk-theme Breeze-Dark
gsettings set org.gnome.desktop.interface icon-theme breeze-dark
gsettings set org.gnome.desktop.interface color-scheme prefer-dark
```

Write matching `~/.config/gtk-3.0/settings.ini` and `~/.config/gtk-4.0/settings.ini` for X11 GTK applications.
On CachyOS,
install `breeze-gtk` first.
Qt applications take the black color scheme from `QT_QPA_PLATFORMTHEME=kde` in `~/.config/uwsm/env`.

## Who draws which decoration

- Qt applications request server-side decorations,
  so labwc draws the titlebar and border.
- GTK4 applications state no decoration preference,
  so labwc's default server-side decoration applies to them.
- GTK3 applications draw client-side decorations with their own shadow and rounded corners.
- Vivaldi draws its own square frame without a shadow.

## Removing rounding, shadows, and the focus highlight

- labwc rounds the top corners of its titlebars by 8 pixels by default;
  `config/labwc/rc.xml` sets `<cornerRadius>0</cornerRadius>`.
- `config/theme/PureBlack/openbox-3/themerc` gives the active window border the inactive color,
  `#1a1a1a`,
  so a focused window gets no highlight.
- `config/gtk-3.0/gtk.css` and `config/gtk-4.0/gtk.css` remove client-side decoration rounding and shadows.
  They must be appended to existing `gtk.css` files that contain generated `@import` lines,
  not written over them.
- Flatpak GTK applications need read access to those files:
  `flatpak override --user --filesystem=xdg-config/gtk-3.0:ro --filesystem=xdg-config/gtk-4.0:ro`.

GTK reads `gtk.css` when an application starts.
Restart the application,
not the compositor,
after changing it.

## Vivaldi ignores the portal's dark preference

The settings portal returned `color-scheme` 1 (prefer dark) both on the host bus and inside the Vivaldi Flatpak sandbox.
Vivaldi's theme schedule was set to follow the operating system,
yet it chose its light theme,
and a `GTK_THEME` override had no effect because Vivaldi's interface does not use GTK theming.
Selecting the dark theme in `vivaldi://settings/themes` fixed it.
The equivalent file change,
made while Vivaldi is closed,
sets `vivaldi.theme.schedule.enabled` to `"off"` and `vivaldi.themes.current` to `"Vivaldi2"` in
`~/.var/app/com.vivaldi.Vivaldi/config/vivaldi/Default/Preferences`.
