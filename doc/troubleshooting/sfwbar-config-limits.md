# sfwbar configuration limits that shaped the panel

## Metadata

- **Status**:
  Verified behavior;
  the panel design works around each limit.
- **Observed**:
  2026-07-20 on sfwbar 1.0 beta16 in the Bazzite rehearsal.
  The resulting configuration passed again on sfwbar 1.0 beta17 in the CachyOS VM on 2026-08-29.
- **Evidence**:
  `archive/bazzite-rehearsal/YOUR-SETUP.md`,
  sections "Panel: sfwbar" and "Panel tray-end polish".

## Actions run without a shell

`Exec` actions start the program directly.
Redirections,
pipes,
and command substitution in an action string do not work.
Put that logic in a helper and call the helper.

## The native pager cannot express the 3×3 grid

The native `pager` widget laid workspaces out in reverse arrival order.
`pins` did not reorder existing workspaces,
and `-GtkWidget-direction` did not change the order.
`config/sfwbar/sfwbar.config` therefore builds the pager from nine image widgets
at explicit `loc(column,row)` positions,
fed by the `wlr-pager watch` client through `ExecClient`.
The pager's workspace names must match the `<names>` list in `config/labwc/rc.xml`.

## Style names did not reach label cells that carry actions

In beta16,
a style name applied through CSS (`#stylename`) worked on plain labels such as the clock,
but did not apply to label cells with actions.
The pager uses SVG image cells,
whose `value` is a file path and needs no CSS.
An inline `css =` property always applied.
Menus take their configuration name as the CSS id,
for example `#winops`,
and their entries use `#menu_item`.

## Scanner grabs keep one line

`Grab()` in a scanner is line-based and keeps only the last line of a command's output.
Its aggregators are `First`,
`Last`,
`Sum`,
and `Product`;
none concatenates lines.
Line breaks could not be injected into a GTK label either:
the pango entity `&#10;` did not break the line,
and U+2028 rendered as a visible glyph.
The calendar popup uses sfwbar's shipped `cal.widget`,
which builds the month from per-day labels,
with local patches in `config/sfwbar/cal.widget`.

## Launching sfwbar outside the session

sfwbar started from a shell outside the session needs `XDG_CURRENT_DESKTOP` and `WAYLAND_DISPLAY` exported.
Start it with `uwsm app -t service -- sfwbar` so it receives the session environment;
see `doc/troubleshooting/uwsm-launch-environment-and-xwayland-satellite.md`.

## Known dead spot

Clicking an empty part of the panel,
such as the clock area,
does not close fuzzel.
sfwbar takes no keyboard focus,
so fuzzel's focus-loss exit does not fire,
and the click is not in labwc's Root context,
so the Root mousebinds do not run either.
