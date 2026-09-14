#!/bin/bash
# Plasma-feel kit, phase 2: user configs — Breeze-styled panel, launcher,
# titlebars, theming env, portals, autostart. Run after the layering reboot.
set -eu

# --- Waybar: Breeze-dark bottom panel with taskbar + tray ---------------------
mkdir -p ~/.config/waybar
cat > ~/.config/waybar/config.jsonc <<'EOF'
{
  "layer": "top",
  "position": "bottom",
  "height": 38,
  "spacing": 2,
  "modules-left": ["custom/menu", "wlr/taskbar"],
  "modules-right": ["tray", "pulseaudio", "network", "clock", "custom/power"],
  "custom/menu": { "format": "  ☰  ", "tooltip-format": "Applications (right-click: run)", "on-click": "nwg-drawer", "on-click-right": "fuzzel" },
  "wlr/taskbar": { "format": "{icon}", "icon-size": 24, "on-click": "activate", "on-click-middle": "close", "tooltip-format": "{title}" },
  "tray": { "icon-size": 18, "spacing": 8 },
  "pulseaudio": { "format": "🔊 {volume}%", "format-muted": "🔇", "on-click": "pavucontrol", "on-click-right": "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle" },
  "network": { "format-wifi": "📶 {essid}", "format-ethernet": "🌐", "format-disconnected": "⚠ offline", "tooltip-format": "{ifname}: {ipaddr}" },
  "clock": { "format": "{:%H:%M}", "tooltip-format": "{:%A %d %B %Y}" },
  "custom/power": { "format": "  ⏻  ", "on-click": "wlogout" }
}
EOF
cat > ~/.config/waybar/style.css <<'EOF'
* { font-family: "Noto Sans", sans-serif; font-size: 14px; min-height: 0; }
window#waybar { background: rgba(27, 30, 32, 0.95); color: #fcfcfc; }
#taskbar button { padding: 0 6px; margin: 3px 1px; border-radius: 3px; }
#taskbar button.active { background: rgba(61, 174, 233, 0.35); }
#taskbar button:hover { background: rgba(61, 174, 233, 0.2); }
#custom-menu:hover, #custom-power:hover { background: rgba(61, 174, 233, 0.35); }
#tray, #pulseaudio, #network, #clock { padding: 0 10px; }
#clock { font-weight: bold; }
EOF

# --- labwc: Breeze-like theme + KDE-style keybinds ----------------------------
mkdir -p ~/.local/share/themes/Plasmesque/openbox-3 ~/.config/labwc
cat > ~/.local/share/themes/Plasmesque/openbox-3/themerc <<'EOF'
border.width: 1
padding.height: 5
window.active.border.color: #3daee9
window.inactive.border.color: #26292c
window.active.title.bg: flat solid
window.active.title.bg.color: #31363b
window.active.label.text.color: #fcfcfc
window.inactive.title.bg: flat solid
window.inactive.title.bg.color: #26292c
window.inactive.label.text.color: #7f8c8d
window.active.button.unpressed.image.color: #fcfcfc
window.inactive.button.unpressed.image.color: #7f8c8d
EOF
cat > ~/.config/labwc/rc.xml <<'EOF'
<?xml version="1.0"?>
<labwc_config>
  <theme>
    <name>Plasmesque</name>
    <font name="Noto Sans" size="10"/>
  </theme>
  <keyboard>
    <default/>
    <keybind key="W-e"><action name="Execute" command="uwsm app -- dolphin"/></keybind>
    <keybind key="W-Return"><action name="Execute" command="uwsm app -- konsole"/></keybind>
    <keybind key="W-d"><action name="Execute" command="nwg-drawer"/></keybind>
    <keybind key="W-space"><action name="Execute" command="fuzzel"/></keybind>
    <keybind key="W-l"><action name="Execute" command="swaylock -f"/></keybind>
    <keybind key="W-v"><action name="Execute" command="sh -c 'cliphist list | fuzzel --dmenu | cliphist decode | wl-copy'"/></keybind>
    <keybind key="Print"><action name="Execute" command="sh -c 'grim - | tee ~/Pictures/screenshot-$(date +%s).png | wl-copy'"/></keybind>
    <keybind key="W-S-s"><action name="Execute" command="sh -c 'grim -g \"$(slurp)\" - | swappy -f -'"/></keybind>
    <keybind key="W-Left"><action name="SnapToEdge" direction="left"/></keybind>
    <keybind key="W-Right"><action name="SnapToEdge" direction="right"/></keybind>
    <keybind key="W-Up"><action name="ToggleMaximize"/></keybind>
    <keybind key="W-PageDown"><action name="Iconify"/></keybind>
  </keyboard>
</labwc_config>
EOF

# --- Theming env for uwsm sessions (Qt -> Breeze via plasma-integration) ------
mkdir -p ~/.config/uwsm
cat > ~/.config/uwsm/env <<'EOF'
export QT_QPA_PLATFORMTHEME=kde
export XCURSOR_THEME=breeze_cursors
export XCURSOR_SIZE=24
export QT_WAYLAND_DISABLE_WINDOWDECORATION=1
EOF

# --- fuzzel: Breeze colors, krunner stand-in ----------------------------------
mkdir -p ~/.config/fuzzel
cat > ~/.config/fuzzel/fuzzel.ini <<'EOF'
launch-prefix=uwsm app --
terminal=konsole
icon-theme=breeze-dark
font=Noto Sans:size=12
[colors]
background=31363bf2
text=fcfcfcff
selection=3daee9ff
selection-text=fcfcfcff
border=3daee9ff
EOF

# --- Portals: KDE file dialogs + wlr screenshot/cast --------------------------
mkdir -p ~/.config/xdg-desktop-portal
for f in labwc-portals.conf wlroots-portals.conf; do
cat > ~/.config/xdg-desktop-portal/$f <<'EOF'
[preferred]
default=kde
org.freedesktop.impl.portal.ScreenCast=wlr
org.freedesktop.impl.portal.Screenshot=wlr
EOF
done

# --- swaylock: Breeze-ish ------------------------------------------------------
mkdir -p ~/.config/swaylock
printf 'color=1b1e20\nindicator-radius=90\nring-color=3daee9\nkey-hl-color=fcfcfc\n' > ~/.config/swaylock/config

# --- GTK + Qt color scheme -----------------------------------------------------
gsettings set org.gnome.desktop.interface gtk-theme Breeze 2>/dev/null || true
gsettings set org.gnome.desktop.interface icon-theme breeze-dark 2>/dev/null || true
gsettings set org.gnome.desktop.interface cursor-theme breeze_cursors 2>/dev/null || true
gsettings set org.gnome.desktop.interface color-scheme prefer-dark 2>/dev/null || true
plasma-apply-colorscheme BreezeDark 2>/dev/null || \
  printf '[General]\nColorScheme=BreezeDark\n' > ~/.config/kdeglobals

# --- Autostart: Plasma Next wallpaper + panel + services, all uwsm-scoped -----
WALL=$(ls /usr/share/wallpapers/Next/contents/images/1920* 2>/dev/null | head -1)
[ -z "$WALL" ] && WALL=$(find /usr/share/wallpapers -name '*.png' 2>/dev/null | head -1)
cat > ~/.config/labwc/autostart <<EOF
swaybg -m fill -i "$WALL" >/dev/null 2>&1 &
uwsm app -- waybar >/dev/null 2>&1 &
uwsm app -- swaync >/dev/null 2>&1 &
uwsm app -- /usr/libexec/kf6/polkit-kde-authentication-agent-1 >/dev/null 2>&1 &
uwsm app -- wl-paste --watch cliphist store >/dev/null 2>&1 &
uwsm app -- nm-applet --indicator >/dev/null 2>&1 &
uwsm app -- swayidle -w timeout 600 'swaylock -f' before-sleep 'swaylock -f' >/dev/null 2>&1 &
EOF
command -v kdeconnect-indicator >/dev/null 2>&1 && \
  echo "uwsm app -- kdeconnect-indicator >/dev/null 2>&1 &" >> ~/.config/labwc/autostart

echo CONFIG_OK
