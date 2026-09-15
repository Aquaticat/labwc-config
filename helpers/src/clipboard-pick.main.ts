/**
 `labwc-clipboard-pick`: picks a clipboard history entry and copies it back.

 Replaces the `sh -c 'cliphist list | fuzzel --dmenu | cliphist decode | wl-copy'` keybind.
 Unlike that pipeline,
 dismissing the picker leaves the clipboard untouched instead of copying empty output.
 Runs on QuickJS-ng because Meta+V is a hot path.

 @module
 */

/// <reference path="./qjs.d.ts" />

import * as std from 'qjs:std';

import { runPipeline, } from './process.qjs.ts';
import { tagged, } from './qjs-log.ts';

const l = tagged({ tag: 'labwc-clipboard-pick', },);

const picked = runPipeline({
  commands: [['cliphist', 'list',], ['labwc-launcher', 'dmenu', '-p', 'clipboard',],],
  captureOutput: true,
},);
if (picked.statuses[1] !== 0 || picked.output === '') {
  std.exit(0,);
}
const copied = runPipeline({ commands: [['cliphist', 'decode',], ['wl-copy',],], input: picked.output, },);
if (copied.statuses.some((status,) => status !== 0)) {
  l.error(`copying the selection failed with statuses ${JSON.stringify(copied.statuses,)}`,);
  std.exit(1,);
}
std.exit(0,);
