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

## Resolved checks

- swaync 0.12.6 reads `style.css` and `config.json` from the user directory,
  then every `XDG_CONFIG_DIRS` entry,
  so its default installs under `/usr/share/labwc-config/xdg/swaync/`.
- GTK 3 and GTK 4 read `settings.ini` from every `XDG_CONFIG_DIRS` entry,
  but `gtk.css` only from the user directory,
  so the installer imports the packaged `gtk.css` overrides from the user's file.
- The environment is prepended by `/etc/xdg/uwsm/env.d/labwc-config`,
  which uwsm sources at session start.
- The getty autologin drop-in names a user,
  so the installer writes it.
- `pacman-repository.md` lists where the package installs each file.

## Open checks

- Every environment change above must be verified in the rehearsal VM by reading the running session's environment.
