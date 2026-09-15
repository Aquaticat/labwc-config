/**
 Tests for choosing where full-screen screenshots are saved.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  picturesDirectory,
  screenshotPath,
} from './screenshot-path.ts';

await describe({
  name: 'screenshot path',
  children: [
    it({
      name: 'reads XDG_PICTURES_DIR from user-dirs.dirs and expands $HOME',
      fn: async () => {
        const userDirs = '# written by xdg-user-dirs-update\nXDG_DESKTOP_DIR="$HOME/Desktop"\nXDG_PICTURES_DIR="$HOME/Images"\n';
        expect(picturesDirectory({ userDirs, home: '/home/user', },),).toEqual('/home/user/Images',);
      },
    },),
    it({
      name: 'accepts absolute directories',
      fn: async () => {
        expect(picturesDirectory({ userDirs: 'XDG_PICTURES_DIR="/data/Pictures"\n', home: '/home/user', },),).toEqual(
          '/data/Pictures',
        );
      },
    },),
    it({
      name: 'falls back to ~/Pictures without a usable entry',
      fn: async () => {
        expect(picturesDirectory({ userDirs: undefined, home: '/home/user', },),).toEqual('/home/user/Pictures',);
        expect(picturesDirectory({ userDirs: 'XDG_PICTURES_DIR="relative/dir"\n', home: '/home/user', },),).toEqual(
          '/home/user/Pictures',
        );
        expect(picturesDirectory({ userDirs: 'XDG_PICTURES_DIR="$HOME/"\n', home: '/home/user', },),).toEqual(
          '/home/user/Pictures',
        );
      },
    },),
    it({
      name: 'names the file after the epoch seconds, as the old keybind did',
      fn: async () => {
        expect(screenshotPath({ directory: '/home/user/Pictures', epochMilliseconds: 1789430000123, },),).toEqual(
          '/home/user/Pictures/screenshot-1789430000.png',
        );
      },
    },),
  ],
},);
