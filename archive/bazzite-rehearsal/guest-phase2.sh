#!/bin/sh
# Phase 2 (run in guest, after the layering reboot): wire up the uwsm-managed
# labwc session for SDDM and autologin into it for headless verification.
set -eu

# /usr/local is writable on ostree systems (-> /var/usrlocal); /usr/share is not.
sudo mkdir -p /usr/local/share/wayland-sessions
sudo tee /usr/local/share/wayland-sessions/labwc-uwsm.desktop >/dev/null <<'EOF'
[Desktop Entry]
Name=labwc (UWSM)
Comment=labwc Wayland compositor managed by uwsm/systemd
Exec=uwsm start -- /usr/bin/labwc
Type=Application
DesktopNames=wlroots:labwc
EOF

sudo mkdir -p /etc/sddm.conf.d
sudo tee /etc/sddm.conf.d/zz-labwc-test.conf >/dev/null <<'EOF'
[Wayland]
SessionDir=/usr/share/wayland-sessions,/usr/local/share/wayland-sessions

[Autologin]
User=user
Session=labwc-uwsm
Relogin=false
EOF

# Visible content for screenshot verification; apps launched via `uwsm app`
# land in managed app-*.scope units under app.slice.
mkdir -p "$HOME/.config/labwc"
cat > "$HOME/.config/labwc/autostart" <<'EOF'
swaybg -c '#1c4587' >/dev/null 2>&1 &
uwsm app -- foot >/dev/null 2>&1 &
EOF

echo PHASE2_OK
