# labwc silently drops configuration and applies some rules only to new windows

## Metadata

- **Status**:
  Verified behavior with local workarounds.
- **First observed**:
  2026-07-20 on labwc 0.9.6 in the Bazzite rehearsal.
- **Re-checked**:
  the same `rc.xml` loaded on labwc 0.20.2 in the CachyOS VM on 2026-08-29.
- **Evidence**:
  `archive/bazzite-rehearsal/HANDOVER.md`,
  sections "Gotchas" and "window decorations".

## A parse error falls back to every default

### Symptom

After editing `config/labwc/rc.xml`,
every custom keybind,
mousebind,
and theme setting disappears at once.
labwc keeps running and shows no error on screen.

### Root cause

When `rc.xml` fails to parse,
labwc loads its built-in defaults instead of the user file.
The rehearsal hit this with an `Execute` command that quoted an argument as `\"`,
which is not XML escaping.

### Fix

Escape quotes inside attributes as `&quot;`,
as the `W-S-S` screenshot bind in `config/labwc/rc.xml` does.
Validate the file before reloading:

```bash
# config/labwc/rc.xml
xmllint --noout config/labwc/rc.xml
```

## Window rules apply when a window maps

### Symptom

After changing a decoration rule and reloading with `labwc --reconfigure` or `SIGHUP`,
windows that were already open keep their old titlebars or lack of them.

### Root cause

labwc evaluates decoration window rules when a window maps.
Reconfiguring changes the rules for windows opened afterwards.

### Fix

Close and reopen the affected windows after changing decoration rules.

## A user bind on a button replaces the default for that button

### Symptom

Adding a Root-context `Press` mousebind for the right button removes the desktop right-click menu.

### Root cause

A user mousebind for the same context,
button,
and event replaces labwc's default instead of adding to it.
labwc's defaults load even without a `<default/>` element.

### Fix

Restate the default action next to the new one.
`config/labwc/rc.xml` closes fuzzel on Middle and Right presses
and then shows `client-list-combined-menu` and `root-menu`.
Left press only closes fuzzel,
because the default left-click root menu was unwanted.

## Default binds deserve a re-check on labwc upgrades

The keymap avoids Ctrl+F1 to Ctrl+F4 and Alt+F1 because IntelliJ IDEA's Windows keymap uses them,
and moves the client menu to Alt+Space.
The rehearsal checked labwc's built-in default binds against that keymap on labwc 0.9.6.
Defaults can change between releases,
so compare `man labwc-config`,
section "default keybinds",
after a labwc upgrade.

## Keyboard shortcut inhibition was unavailable

labwc 0.9.6 did not advertise `keyboard-shortcuts-inhibit-unstable-v1`
(checked with `wayland-info` on 2026-07-20).
The Meta+F12 `ToggleKeybinds` guard exists because of that.
This was not re-checked on labwc 0.20.2;
run `wayland-info | rg keyboard_shortcuts_inhibit` before relying on either conclusion.
