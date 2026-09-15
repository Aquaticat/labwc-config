#!/bin/sh
# Installed on Hyper-V guests as /etc/boot/hooks/post.d/95-shim-limine-copy.
# limine-entry-tool re-enrolls the config hash and signs \EFI\limine\limine_x64.efi on every change;
# shim at \EFI\BOOT\BOOTX64.EFI loads grubx64.efi from its own directory, so this hook mirrors Limine there.
#
# It is a shell script, not Deno, because limine-snapper-sync.service runs post hooks under
# SystemCallFilter=@system-service @mount, which killed a Deno hook with SIGSYS on 2026-09-15
# and left grubx64.efi holding a Limine whose enrolled config hash no longer matched.
#
# LABWC_CONFIG_ESP overrides the ESP mount point for tests.
set -eu

esp="${LABWC_CONFIG_ESP:-/boot}"
source_file="${esp}/EFI/limine/limine_x64.efi"
destination="${esp}/EFI/BOOT/grubx64.efi"

if [ -f "${source_file}" ] && ! cmp --silent "${source_file}" "${destination}"; then
  cp -- "${source_file}" "${destination}.new"
  sync --data -- "${destination}.new"
  mv --force -- "${destination}.new" "${destination}"
fi

# limine-install registers a direct "Limine" boot entry; under Secure Boot it bypasses shim and fails.
if [ -z "${LABWC_CONFIG_ESP:-}" ] && command -v efibootmgr > /dev/null && [ -d /sys/firmware/efi/efivars ]; then
  efibootmgr | while IFS= read -r line; do
    case "${line}" in
      Boot[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]*limine_x64.efi*)
        number="$(printf '%s' "${line}" | cut --characters=5-8)"
        efibootmgr --quiet --bootnum "${number}" --delete-bootnum || true
        ;;
    esac
  done
  if ! efibootmgr | grep --quiet --fixed-strings 'CachyOS (shim)'; then
    efibootmgr --quiet --create --disk /dev/disk/by-partlabel/ESP --part 1 --label 'CachyOS (shim)' \
      --loader '\EFI\BOOT\BOOTX64.EFI' || true
  fi
fi
exit 0
