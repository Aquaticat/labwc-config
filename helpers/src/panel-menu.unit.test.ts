/**
 Tests for the panel menu table.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  commandForSelection,
  menuInput,
  PANEL_MENU,
} from './panel-menu.ts';

await describe({
  name: 'panel menu',
  children: [
    it({
      name: 'offers the entries in their deliberate order, one per line',
      fn: async () => {
        expect(menuInput(),).toEqual('Audio settings\nLock screen\nManage session services\nRestart panel\nLog out\n',);
      },
    },),
    it({
      name: 'maps each label to its command',
      fn: async () => {
        expect(commandForSelection({ selection: 'Audio settings', },),).toEqual(['labwc-launcher', 'run', '--', 'pavucontrol',],);
        expect(commandForSelection({ selection: 'Manage session services', },),).toEqual([
          'uuctl',
          'labwc-launcher',
          'dmenu',
          '-p',
        ],);
        expect(commandForSelection({ selection: 'Restart panel', },),).toEqual([
          'systemctl',
          '--user',
          'restart',
          'labwc-panel.service',
        ],);
        expect(commandForSelection({ selection: 'Log out', },),).toEqual(['uwsm', 'stop',],);
      },
    },),
    it({
      name: 'returns nothing for text that is not a menu label',
      fn: async () => {
        expect(commandForSelection({ selection: 'rm -rf /', },),).toEqual(undefined,);
        expect(commandForSelection({ selection: '', },),).toEqual(undefined,);
      },
    },),
    it({
      name: 'keeps labels free of line breaks so dmenu lines stay intact',
      fn: async () => {
        expect(PANEL_MENU.every((entry,) => !entry.label.includes('\n',)),).toEqual(true,);
      },
    },),
  ],
},);
