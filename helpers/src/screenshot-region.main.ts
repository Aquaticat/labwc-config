/**
 `labwc-screenshot-region`: captures a selected region and opens it in swappy.

 Replaces the `sh -c 'grim -g "$(slurp)" - | swappy -f -'` keybind.
 Dismissing the selection ends quietly instead of capturing the whole screen.

 @module
 */

/// <reference path="./qjs.d.ts" />

import * as std from 'qjs:std';

import { runPipeline, } from './process.qjs.ts';
import { tagged, } from './qjs-log.ts';

const l = tagged({ tag: 'labwc-screenshot-region', },);

const region = runPipeline({ commands: [['slurp',],], captureOutput: true, },);
const geometry = region.output.trim();
if (region.statuses[0] !== 0 || geometry === '') {
  std.exit(0,);
}
const captured = runPipeline({ commands: [['grim', '-g', geometry, '-',], ['swappy', '-f', '-',],], },);
if (captured.statuses.some((status,) => status !== 0)) {
  l.error(`capturing ${geometry} failed with statuses ${JSON.stringify(captured.statuses,)}`,);
  std.exit(1,);
}
std.exit(0,);
