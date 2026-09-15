#!/bin/sh
# Installed as /usr/lib/systemd/user-environment-generators/70-labwc-config.
# Session defaults ship under /usr/share/labwc-config, ahead of the standard directories;
# a file under ~/.config still overrides them.
# flatpak's generator, 60-flatpak, rewrites XDG_DATA_DIRS without the prefix an environment.d file adds,
# so the prefix is applied here, after it, and only when missing.
prepend() {
  case ":$2:" in
    *":$1:"*) printf '%s\n' "$2" ;;
    *) printf '%s\n' "$1${2:+:$2}" ;;
  esac
}
# sfwbar reads its system defaults from XDG_DATA_DIRS, not XDG_CONFIG_DIRS.
printf 'XDG_DATA_DIRS=%s\n' "$(prepend /usr/share/labwc-config/data "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}")"
printf 'XDG_CONFIG_DIRS=%s\n' "$(prepend /usr/share/labwc-config/xdg "${XDG_CONFIG_DIRS:-/etc/xdg}")"
