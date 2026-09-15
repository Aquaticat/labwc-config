/**
 `labwc-screenshot`: saves a full-screen screenshot and copies it to the clipboard.

 Replaces the `sh -c 'grim - | tee ~/Pictures/screenshot-$(date +%s).png | wl-copy'` keybind,
 and saves into the pictures directory from `user-dirs.dirs`.

 @module
 */

/// <reference path="./qjs.d.ts" />

import * as os from 'qjs:os';
import * as std from 'qjs:std';

import { runPipeline, } from './process.qjs.ts';
import { tagged, } from './qjs-log.ts';
import {
  picturesDirectory,
  screenshotPath,
} from './screenshot-path.ts';

const l = tagged({ tag: 'labwc-screenshot', },);

/** Creates `directory` and its missing parents, ignoring directories that already exist. */
function makeDirectories({ directory, }: { readonly directory: string; },): void {
  directory.split('/',).reduce((prefix, part,) => {
    const next = part === '' ? prefix : `${prefix}/${part}`;
    if (part !== '') {
      os.mkdir(next, 0o755,);
    }
    return next;
  }, '',);
}

const home = std.getenv('HOME',) ?? '/';
const configHome = std.getenv('XDG_CONFIG_HOME',) || `${home}/.config`;
const directory = picturesDirectory({ userDirs: std.loadFile(`${configHome}/user-dirs.dirs`,) ?? undefined, home, },);
makeDirectories({ directory, },);
const path = screenshotPath({ directory, epochMilliseconds: Date.now(), },);
if (runPipeline({ commands: [['grim', path,],], },).statuses[0] !== 0) {
  l.error(`grim could not save ${path}`,);
  std.exit(1,);
}
const image = os.open(path, os.O_RDONLY,);
if (image < 0) {
  l.error(`reading back ${path} failed`,);
  std.exit(1,);
}
const copied = runPipeline({ commands: [['wl-copy', '--type', 'image/png',],], stdinFd: image, },);
os.close(image,);
std.exit(copied.statuses[0] ?? 1,);
