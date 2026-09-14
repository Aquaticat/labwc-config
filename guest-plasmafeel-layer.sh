#!/bin/sh
# Plasma-feel kit, phase 1: layer the component packages.
set -eu
sudo rpm-ostree install --idempotent \
  SwayNotificationCenter cliphist wl-clipboard grim slurp swappy \
  swaylock swayidle wlsunset network-manager-applet pavucontrol \
  kanshi wlogout nwg-drawer
echo LAYER2_OK
