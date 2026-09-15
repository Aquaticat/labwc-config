/**
 `labwc-panel-menu`: the panel's right-click menu, shown through the launcher daemon's dmenu.

 Runs on QuickJS-ng because an empty-panel right-click is a hot path.

 @module
 */

/// <reference path="./qjs.d.ts" />

import * as std from 'qjs:std';

import {
  commandForSelection,
  menuInput,
} from './panel-menu.ts';
import { runPipeline, } from './process.qjs.ts';
import { tagged, } from './qjs-log.ts';

const l = tagged({ tag: 'labwc-panel-menu', },);

const picked = runPipeline({ commands: [['labwc-launcher', 'dmenu', '-p', 'panel',],], input: menuInput(), captureOutput: true, },);
// Status 1 means the user dismissed the menu; anything else non-zero was already reported by the client.
if (picked.statuses[0] !== 0) {
  std.exit(0,);
}
const selection = picked.output.replace(/\n$/u, '',);
const argv = commandForSelection({ selection, },);
if (argv === undefined) {
  l.error(`dmenu returned ${JSON.stringify(selection,)}, which is not a panel menu entry`,);
  std.exit(1,);
}
std.exit(runPipeline({ commands: [argv,], },).statuses[0] ?? 1,);
