#!/bin/sh
# Build the HiDPI-patched Xwayland ("patch 733" / _XWAYLAND_GLOBAL_OUTPUT_SCALE)
# in a Fedora container and install it to /usr/local/bin/Xwayland.
#
# Why: stock Xwayland cannot scale rootless surfaces -> X11-only apps are blurry
# on outputs with scale > 1. This patch makes Xwayland size its X screen at
# scale x logical (physical pixels) and set buffer scale on its wl_surfaces, so
# the compositor presents 1:1. Apps then self-scale via Xft.dpi/XSettings
# (see final-configs/xinitrc + xsettingsd.conf). Same model as KWin's
# "X11 apps apply scaling themselves" ([Xwayland] Scale=N in kwinrc).
#
# wlroots ignores PATH for Xwayland (path baked at build time); the session
# points at this binary via WLR_XWAYLAND=/usr/local/bin/Xwayland in
# ~/.config/uwsm/env. Rollback: remove that line (stock /usr/bin/Xwayland
# is untouched). Re-run this script after major Xwayland CVEs/releases.
#
# CRITICAL meson args: xkb paths must match the host (Fedora), otherwise
# Xwayland aborts at startup with "XKB: Failed to compile keymap".
set -ex
VER=24.1.13
mkdir -p ~/xwl-build && cd ~/xwl-build
curl -sLO "https://xorg.freedesktop.org/archive/individual/xserver/xwayland-${VER}.tar.xz"
curl -sLo hidpi.patch "https://aur.archlinux.org/cgit/aur.git/plain/hidpi.patch?h=xorg-xwayland-hidpi-xprop"
podman run --rm -v ~/xwl-build:/build:Z registry.fedoraproject.org/fedora:44 bash -c "
set -ex
dnf -y install dnf-plugins-core patch meson ninja-build gcc xkeyboard-config xkbcomp
dnf -y builddep xorg-x11-server-Xwayland
cd /build && rm -rf xwayland-${VER} && tar xf xwayland-${VER}.tar.xz && cd xwayland-${VER}
patch -Np1 -i ../hidpi.patch
meson setup build -Dbuildtype=release -Dprefix=/usr \
  -Dxkb_dir=/usr/share/X11/xkb -Dxkb_output_dir=/var/lib/xkb -Dxkb_bin_dir=/usr/bin
ninja -C build
cp build/hw/xwayland/Xwayland /build/Xwayland-hidpi
"
sudo install -m755 ~/xwl-build/Xwayland-hidpi /usr/local/bin/Xwayland
echo "Installed. Ensure ~/.config/uwsm/env has: export WLR_XWAYLAND=/usr/local/bin/Xwayland"
echo "Then restart the session (log out; getty autologin brings it back)."
