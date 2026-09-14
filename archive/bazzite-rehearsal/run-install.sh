#!/bin/sh
# Automated Bazzite install into disk.qcow2 — runs inside the vmrunner container.
# QEMU exits when the installer finishes (reboot request + -no-reboot).
set -eu
cd /work
[ -f OVMF_VARS.fd ] || cp /usr/share/edk2/ovmf/OVMF_VARS.fd .
[ -f disk.qcow2 ] || qemu-img create -f qcow2 disk.qcow2 64G

exec qemu-system-x86_64 \
  -name bazzite-install \
  -machine q35,accel=kvm -cpu host -smp 8 -m 8192 \
  -drive if=pflash,format=raw,readonly=on,file=/usr/share/edk2/ovmf/OVMF_CODE.fd \
  -drive if=pflash,format=raw,file=/work/OVMF_VARS.fd \
  -drive file=/work/disk.qcow2,if=virtio,format=qcow2,discard=unmap \
  -cdrom /work/netinst.iso \
  -kernel /work/boot/vmlinuz \
  -initrd /work/boot/initrd-ks.img \
  -append "inst.stage2=hd:LABEL=${ISO_LABEL} inst.ks=file:/ks.cfg inst.text console=ttyS0,115200" \
  -netdev user,id=n0 -device virtio-net-pci,netdev=n0 \
  -display none \
  -serial file:/work/logs/install-serial.log \
  -no-reboot
