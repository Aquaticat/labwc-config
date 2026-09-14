# Ship session defaults as system configuration

## Goal

The PKGBUILD installs the session's default configuration under `/usr`,
so it rolls back with the `@` snapshot and needs no per-user copy step.
A file under `~/.config` still overrides a default when one exists.

## Verified lookup behavior

Package manuals and source,
read on 2026-09-14 from the CachyOS packages labwc 0.20.2-1.1,
fuzzel 1.15.0-1.1,
swaync 0.12.6-1.1,
and from sfwbar's `main` branch:

- labwc searches `${XDG_CONFIG_HOME:-$HOME/.config}/labwc`,
  then `${XDG_CONFIG_DIRS:-/etc/xdg}/labwc`,
  and reads only the first file it finds unless started with `--merge-config`
  (`labwc-config(5)`).
- fuzzel searches `XDG_CONFIG_HOME/fuzzel/fuzzel.ini`,
  then `XDG_CONFIG_DIRS/fuzzel/fuzzel.ini`
  (`fuzzel.ini(5)`).
- The fuzzel package owns `/etc/xdg/fuzzel/fuzzel.ini`,
  and the swaync package owns `/etc/xdg/swaync/style.css` and `/etc/xdg/swaync/config.json`,
  so another package cannot install files at those paths.
- sfwbar's `get_xdg_config_file` in `src/util/file.c` searches the directory of the loaded config file,
  then `g_get_user_config_dir()/sfwbar`,
  then every `g_get_system_data_dirs()` entry with `/sfwbar` appended,
  then `SYSTEM_CONF_DIR`.
  sfwbar therefore reads system defaults from `XDG_DATA_DIRS`,
  not `XDG_CONFIG_DIRS`.

## Proposed layout

- Install configuration defaults under `/usr/share/labwc-config/xdg/<application>/`.
- Install sfwbar defaults under `/usr/share/labwc-config/data/sfwbar/`.
- Prepend both directories in the UWSM environment,
  keeping the standard fallbacks:
  `XDG_CONFIG_DIRS=/usr/share/labwc-config/xdg:/etc/xdg`
  and `XDG_DATA_DIRS=/usr/share/labwc-config/data:/usr/local/share:/usr/share`.
- Install the PureBlack labwc theme under `/usr/share/themes/PureBlack/openbox-3/`.
- Install Material Symbols under `/usr/share/fonts/labwc-config/`.
- Install unit drop-ins under `/usr/lib/systemd/system/` and `/usr/lib/systemd/user/`.

## Open checks

- swaync:
  confirm from source whether it searches `XDG_CONFIG_DIRS` before its compiled-in `/etc/xdg` path.
- GTK:
  `gtk.css` is read from the user configuration directory only,
  so the decoration overrides need another mechanism;
  `settings.ini` lookup through `XDG_CONFIG_DIRS` needs confirming from GTK source.
- The getty autologin drop-in names a user;
  a username cannot be hardcoded in a package,
  so the installer writes that drop-in instead.
- Every environment change above must be verified in the rehearsal VM by reading the running session's environment.
