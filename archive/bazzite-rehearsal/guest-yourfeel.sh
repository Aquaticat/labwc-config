#!/bin/bash
# Personalization retrofit: mirror the host's real KDE setup in labwc.
# Expects in ~: convergence.png, kdeglobals-host, odytty-x86_64.AppImage
set -eu

# --- Fonts (Inter Variable + JetBrains Mono) — layered, needs reboot ----------
sudo rpm-ostree install --idempotent rsms-inter-vf-fonts jetbrains-mono-fonts || true

# --- GearLever (flatpak) + OdyTTY AppImage ------------------------------------
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo 2>/dev/null || true
flatpak install --user -y --noninteractive flathub it.mijorus.gearlever >/dev/null 2>&1 || echo "WARN: gearlever install failed"
chmod +x ~/odytty-x86_64.AppImage
if flatpak run it.mijorus.gearlever --integrate ~/odytty-x86_64.AppImage -y >/dev/null 2>&1; then
  echo "gearlever integrated odytty"
else
  echo "WARN: gearlever CLI integration failed; manual fallback"
  mkdir -p ~/AppImages ~/.local/share/applications
  cp ~/odytty-x86_64.AppImage ~/AppImages/odytty.appimage
  printf '[Desktop Entry]\nName=OdyTTY\nExec=%s\nType=Application\nTerminal=false\nIcon=utilities-terminal\n' \
    "$HOME/AppImages/odytty.appimage" > ~/.local/share/applications/odytty.desktop
fi
ODY=$(ls ~/AppImages/*.appimage ~/AppImages/*.AppImage 2>/dev/null | head -1)
[ -z "$ODY" ] && ODY=$HOME/odytty-x86_64.AppImage
echo "odytty at: $ODY"

# --- Your exact Qt colors/fonts (host kdeglobals, terminal keys updated) ------
sed -e "s|^TerminalApplication=.*|TerminalApplication=$ODY|" \
    -e "s|^TerminalService=.*|TerminalService=odytty.desktop|" \
    ~/kdeglobals-host > ~/.config/kdeglobals

# --- Waybar: black per-output panel, pager + text taskbar + tray + clock ------
mkdir -p ~/.config/waybar ~/Pictures
cat > ~/.config/waybar/config.jsonc <<'EOF'
{
  "layer": "top",
  "position": "bottom",
  "height": 30,
  "spacing": 0,
  "modules-left": ["ext/workspaces", "wlr/taskbar"],
  "modules-right": ["tray", "pulseaudio", "clock"],
  "ext/workspaces": { "format": "{name}", "on-click": "activate" },
  "wlr/taskbar": { "format": "{icon} {title:.30}", "icon-size": 16, "on-click": "activate", "on-click-middle": "close", "tooltip-format": "{title}" },
  "tray": { "icon-size": 16, "spacing": 6 },
  "pulseaudio": { "format": "{volume}%", "format-muted": "muted", "on-click": "pavucontrol" },
  "clock": { "format": "{:%H:%M\n%Y-%m-%d}", "tooltip-format": "{:%A %d %B %Y}", "justify": "center" }
}
EOF
cat > ~/.config/waybar/style.css <<'EOF'
* { font-family: "Inter Variable", "Inter", sans-serif; font-size: 12px; min-height: 0; border-radius: 0; }
window#waybar { background: #000000; color: #eff0f1; }
#workspaces button { padding: 0 5px; margin: 2px 1px; background: #1a1a1a; color: #7f8c8d; }
#workspaces button.active { background: #6060c0; color: #ffffff; }
#taskbar button { padding: 0 8px; margin: 2px 1px; background: #1a1a1a; color: #eff0f1; }
#taskbar button.active { background: rgba(96, 96, 192, 0.4); }
#taskbar button:hover { background: rgba(96, 96, 192, 0.25); }
#tray, #pulseaudio { padding: 0 8px; }
#clock { padding: 0 10px; font-size: 10px; }
EOF

# --- labwc: 9-desktop grid, your keybinds, borderless windows -----------------
mkdir -p ~/.config/labwc ~/.local/share/themes/PureBlack/openbox-3
cat > ~/.local/share/themes/PureBlack/openbox-3/themerc <<'EOF'
border.width: 1
padding.height: 4
window.active.border.color: #1a1a1a
window.inactive.border.color: #1a1a1a
window.active.title.bg: flat solid
window.active.title.bg.color: #000000
window.active.label.text.color: #eff0f1
window.inactive.title.bg: flat solid
window.inactive.title.bg.color: #000000
window.inactive.label.text.color: #7f8c8d
window.active.button.unpressed.image.color: #eff0f1
window.inactive.button.unpressed.image.color: #7f8c8d
EOF
cat > ~/.config/labwc/rc.xml <<EOF
<?xml version="1.0"?>
<labwc_config>
  <theme>
    <name>PureBlack</name>
    <font name="Inter Variable" size="10"/>
  </theme>
  <desktops number="9">
    <names>
      <name>left top</name><name>top</name><name>right top</name>
      <name>left</name><name>middle</name><name>right</name>
      <name>left bottom</name><name>bottom</name><name>right bottom</name>
    </names>
  </desktops>
  <windowRules>
    <windowRule identifier="*" serverDecoration="no"/>
  </windowRules>
  <keyboard>
    <default/>
    <!-- 3x3 grid navigation: left/right = +-1, up/down = +-3 (wrapping) -->
    <keybind key="W-C-Left"><action name="GoToDesktop" to="left"/></keybind>
    <keybind key="W-C-Right"><action name="GoToDesktop" to="right"/></keybind>
    <keybind key="W-C-Up"><action name="GoToDesktop" to="left"/><action name="GoToDesktop" to="left"/><action name="GoToDesktop" to="left"/></keybind>
    <keybind key="W-C-Down"><action name="GoToDesktop" to="right"/><action name="GoToDesktop" to="right"/><action name="GoToDesktop" to="right"/></keybind>
    <keybind key="W-C-S-Left"><action name="SendToDesktop" to="left"/></keybind>
    <keybind key="W-C-S-Right"><action name="SendToDesktop" to="right"/></keybind>
    <keybind key="W-C-S-Up"><action name="SendToDesktop" to="left"/><action name="SendToDesktop" to="left"/><action name="SendToDesktop" to="left"/></keybind>
    <keybind key="W-C-S-Down"><action name="SendToDesktop" to="right"/><action name="SendToDesktop" to="right"/><action name="SendToDesktop" to="right"/></keybind>
    <keybind key="C-F1"><action name="GoToDesktop" to="1"/></keybind>
    <keybind key="C-F2"><action name="GoToDesktop" to="2"/></keybind>
    <keybind key="C-F3"><action name="GoToDesktop" to="3"/></keybind>
    <keybind key="C-F4"><action name="GoToDesktop" to="4"/></keybind>
    <keybind key="W-F1"><action name="GoToDesktop" to="1"/></keybind>
    <keybind key="W-F2"><action name="GoToDesktop" to="2"/></keybind>
    <keybind key="W-F3"><action name="GoToDesktop" to="3"/></keybind>
    <keybind key="W-F4"><action name="GoToDesktop" to="4"/></keybind>
    <!-- Window management (yours) -->
    <keybind key="W-Up"><action name="ToggleMaximize"/></keybind>
    <keybind key="W-Down"><action name="Iconify"/></keybind>
    <keybind key="W-Left"><action name="SnapToEdge" direction="left"/></keybind>
    <keybind key="W-Right"><action name="SnapToEdge" direction="right"/></keybind>
    <keybind key="W-S-Left"><action name="MoveToOutput" direction="left"/></keybind>
    <keybind key="W-S-Right"><action name="MoveToOutput" direction="right"/></keybind>
    <keybind key="A-F3"><action name="ShowMenu" menu="client-menu"/></keybind>
    <keybind key="A-F4"><action name="Close"/></keybind>
    <keybind key="W-Tab"><action name="NextWindow"/></keybind>
    <!-- Launchers / tools -->
    <keybind key="A-F1"><action name="Execute" command="fuzzel"/></keybind>
    <keybind key="W-Return"><action name="Execute" command="uwsm app -- $ODY"/></keybind>
    <keybind key="W-L"><action name="Execute" command="swaylock -f"/></keybind>
    <keybind key="W-V"><action name="Execute" command="sh -c 'cliphist list | fuzzel --dmenu | cliphist decode | wl-copy'"/></keybind>
    <keybind key="Print"><action name="Execute" command="sh -c 'grim - | tee ~/Pictures/screenshot-\$(date +%s).png | wl-copy'"/></keybind>
    <keybind key="W-S-S"><action name="Execute" command="sh -c 'grim -g \"\$(slurp)\" - | swappy -f -'"/></keybind>
  </keyboard>
</labwc_config>
EOF

# --- fuzzel: black + Inter + your selection color -----------------------------
mkdir -p ~/.config/fuzzel
cat > ~/.config/fuzzel/fuzzel.ini <<EOF
launch-prefix=uwsm app --
terminal=$ODY
icon-theme=breeze-dark
font=Inter Variable:size=12
[colors]
background=000000f0
text=eff0f1ff
selection=6060c0ff
selection-text=ffffffff
border=346c92ff
EOF

# --- GTK fonts to match -------------------------------------------------------
gsettings set org.gnome.desktop.interface font-name 'Inter Variable 10' 2>/dev/null || true
gsettings set org.gnome.desktop.interface monospace-font-name 'JetBrains Mono 10' 2>/dev/null || true

# --- Autostart: your wallpaper + panel + services, uwsm-scoped ----------------
cp ~/convergence.png ~/Pictures/convergence.png
cat > ~/.config/labwc/autostart <<'EOF'
swaybg -m fill -i ~/Pictures/convergence.png >/dev/null 2>&1 &
uwsm app -- waybar >/dev/null 2>&1 &
uwsm app -- swaync >/dev/null 2>&1 &
uwsm app -- /usr/libexec/kf6/polkit-kde-authentication-agent-1 >/dev/null 2>&1 &
uwsm app -- wl-paste --watch cliphist store >/dev/null 2>&1 &
uwsm app -- nm-applet --indicator >/dev/null 2>&1 &
uwsm app -- swayidle -w timeout 600 'swaylock -f' before-sleep 'swaylock -f' >/dev/null 2>&1 &
EOF

echo YOURFEEL_OK
