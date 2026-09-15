# Signed pacman repository for the session

## Goal

Every file of the session comes from a signed package,
so a Snapper root snapshot rolls the whole session back,
and the machine installs the session with pacman instead of copying files.

## Packages

`packaging/PKGBUILD` builds three packages from the checkout it sits in:

- `labwc-config-launcher`:
  `labwc-launcherd`,
  `labwc-launcher`,
  `labwc-pager`,
  and the launcher's user unit.
- `labwc-config-helpers`:
  the QuickJS-ng panel menu,
  clipboard picker,
  and screenshot helpers.
- `labwc-config`:
  configuration defaults,
  the PureBlack theme,
  Material Symbols,
  the uwsm environment file,
  the GSettings override,
  and the user units with their `graphical-session.target.wants` links.

`check()` runs the launcher's Rust tests and the helpers' unit tests,
so a package is never built from a tree whose tests fail.

The version is `r<commit count>.<commit hash>`,
so every commit on main produces a newer version.

## Where each file goes

- Configuration read through `XDG_CONFIG_DIRS` installs under `/usr/share/labwc-config/xdg/`:
  labwc's `rc.xml`,
  swaync's `style.css`,
  and GTK's `settings.ini` for GTK 3 and GTK 4.
- sfwbar reads defaults through `XDG_DATA_DIRS`,
  so its files install under `/usr/share/labwc-config/data/sfwbar/`.
- `/usr/lib/environment.d/50-labwc-config.conf` prepends both directories for the systemd user manager,
  so session units and the XDG autostart generator see them;
  in the dev VM on 2026-09-14,
  the generator ignored the nm-applet override while only uwsm's environment carried the prefix.
- `/etc/xdg/uwsm/env.d/labwc-config` sets the Qt,
  cursor,
  and Xwayland variables that used to live in `~/.config/uwsm/env`.
  It is a pacman backup file,
  so a local edit survives upgrades as a `.pacnew`.
- `/usr/share/glib-2.0/schemas/90_labwc-config.gschema.override` sets the dark GTK theme for Wayland GTK applications;
  glib2's pacman hook compiles it.
- GTK reads `gtk.css` only from the user's configuration directory,
  so the package installs the decoration overrides under `/usr/share/labwc-config/gtk/`
  and the installer writes an `@import` of them into the user's `gtk.css`.
- `/etc/profile.d/labwc-config.sh` and `/usr/share/fish/vendor_conf.d/labwc-config.fish` start the session from a login shell,
  guarded by `uwsm check may-start`,
  which allows only a fresh local login on the first virtual terminal.
- The getty autologin drop-in names a user,
  so the installer writes it.
- `swaync.service` and the session's own units start through `graphical-session.target.wants` links.
- `/usr/share/labwc-config/xdg/autostart/nm-applet.desktop` overrides the applet's autostart entry to add `--indicator`,
  because sfwbar shows only StatusNotifierItem icons.

Lookup behavior behind these paths was read from source on 2026-09-14:
GTK 3 and GTK 4 `gtksettings.c` read `settings.ini` from every `XDG_CONFIG_DIRS` entry and `gtk.css` only from the user directory;
swaync 0.12.6 `functions.vala` reads `style.css` and `config.json` from `XDG_CONFIG_DIRS`;
uwsm 0.26.7 sources `uwsm/env` and `uwsm/env.d/*` from the XDG configuration hierarchy.
`system-config-layout.md` records labwc's and sfwbar's lookup.

## Publishing

`.github/workflows/pacman-repo.yml` builds and tests the packages on every push and pull request.
On main,
it signs them with the CI signing subkey,
assembles the database with `packaging/assemble-repo.ts`,
and uploads everything to the release tagged `repo`.
It uploads packages before the database,
then deletes assets that are no longer part of the repository.

The machine's `pacman.conf` entry:

```ini
[labwc-config]
SigLevel = Required
Server = https://github.com/Aquaticat/labwc-config/releases/download/repo
```

Older package versions stay in the machine's pacman cache and in root snapshots,
so rolling back does not depend on the release keeping old files.

## Signing key

The owner generates the key on an offline machine:

1. Create a primary key used only for certification.
2. Add a signing subkey with an expiry.
3. Export the public key into `packaging/labwc-config-signing.asc`,
   which the installer adds to pacman's keyring and locally signs.
4. Export only the subkey's secret with `gpg --armor --export-secret-subkeys SUBKEY_ID!`,
   without a passphrase because CI signs unattended,
   and store it as the repository secret `PACMAN_SIGNING_SUBKEY`.
5. Store the subkey's ID as the repository variable `PACMAN_SIGNING_KEY_ID`.

If the subkey leaks,
the owner revokes it with the offline primary key,
adds a new subkey,
and republishes the public key;
pacman keeps trusting the primary key's local signature.

Until the key exists,
the workflow builds and tests but skips publishing,
and the rehearsal VM uses a local repository signed with a throwaway key.
