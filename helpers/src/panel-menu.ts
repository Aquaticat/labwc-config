/**
 The panel's right-click menu: what it offers and what each entry runs.

 Kept free of runtime imports so it is unit-tested under Deno and bundled for QuickJS-ng.

 @module
 */

/** One panel menu entry. */
export type PanelMenuEntry = {
  /** Text shown in the menu. */
  readonly label: string;
  /** Program and arguments run when the entry is chosen, looked up on `PATH`. */
  readonly argv: readonly string[];
};

/** Entries in display order, matching the retired `panel-menu` script. */
export const PANEL_MENU: readonly PanelMenuEntry[] = [
  { label: 'Audio settings', argv: ['labwc-launcher', 'run', '--', 'pavucontrol',], },
  { label: 'Lock screen', argv: ['swaylock', '-f',], },
  // uuctl appends its own prompt text after the trailing prompt flag.
  { label: 'Manage session services', argv: ['uuctl', 'labwc-launcher', 'dmenu', '-p',], },
  { label: 'Restart panel', argv: ['systemctl', '--user', 'restart', 'labwc-panel.service',], },
  { label: 'Log out', argv: ['uwsm', 'stop',], },
];

/**
 Serializes the menu for `labwc-launcher dmenu`.

 @returns every label followed by a line break
 */
export function menuInput(): string {
  return PANEL_MENU.map((entry,) => `${entry.label}\n`).join('',);
}

/**
 Finds the command for the line dmenu printed.

 @param selection - chosen line without its trailing line break
 @returns the entry's argv, or `undefined` when the text matches no label
 */
export function commandForSelection({ selection, }: { readonly selection: string; },): readonly string[] | undefined {
  return PANEL_MENU.find((entry,) => entry.label === selection)?.argv;
}
