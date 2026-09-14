#!/bin/sh
# Boot the installed Bazzite VM — runs inside the vmrunner container with --network=host.
# SSH:  ssh -p 2222 -i id_ed25519 user@127.0.0.1
# VNC:  127.0.0.1:5910 (for interactive viewing)
# QMP:  tcp 127.0.0.1:4444 (screenshots, keys, powerdown)
set -eu
cd /work

exec qemu-system-x86_64 \
  -name bazzite-labwc \
  -machine q35,accel=kvm -cpu host -smp "${SMP:-8}" -m 8192 \
  -drive if=pflash,format=raw,readonly=on,file=/usr/share/edk2/ovmf/OVMF_CODE.fd \
  -drive if=pflash,format=raw,file=/work/OVMF_VARS.fd \
  -drive file="${DISK:-/work/disk.qcow2}",if=virtio,format=qcow2,discard=unmap \
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:2222-:22 -device virtio-net-pci,netdev=n0 \
  -device virtio-vga \
  -device virtio-tablet-pci -device virtio-keyboard-pci \
  -display none -vnc 127.0.0.1:10 \
  -serial file:/work/logs/vm-serial.log \
  -qmp tcp:127.0.0.1:4444,server,nowait
