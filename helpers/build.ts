/**
 Bundles the QuickJS-ng helpers into standalone executable scripts.

 ```sh
 deno run --allow-read --allow-write --allow-run helpers/build.ts --out-dir helpers/dist
 ```

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

const l = tagged({ tag: 'helpers-build', },);

/** Thrown when bundling a helper fails. */
class HelperBuildError extends Error {
  /**
   @param message - which helper failed and why
   */
  constructor(message: string,) {
    super(message,);
    this.name = HelperBuildError.name;
  }
}

/** Installed command name for each entry point. */
const ENTRIES: Readonly<Record<string, string>> = {
  'labwc-panel-menu': 'panel-menu.main.ts',
  'labwc-clipboard-pick': 'clipboard-pick.main.ts',
  'labwc-screenshot': 'screenshot.main.ts',
  'labwc-screenshot-region': 'screenshot-region.main.ts',
};

/** Reads `--out-dir`. */
function outDir(): string {
  const index = Deno.args.indexOf('--out-dir',);
  return index >= 0 ? Deno.args[index + 1] ?? 'helpers/dist' : 'helpers/dist';
}

/**
 Bundles one entry point and marks it executable with a QuickJS-ng shebang.

 @param name - installed command name
 @param entry - entry file in `helpers/src`
 @param directory - output directory
 */
async function bundle({ name, entry, directory, }: { readonly name: string; readonly entry: string; readonly directory: string; },): Promise<void> {
  const output = `${directory}/${name}`;
  const source = new URL(`./src/${entry}`, import.meta.url,).pathname.replace(/^\/([A-Za-z]:)/u, '$1',);
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['bundle', '--quiet', '--platform=browser', '--external', 'qjs:*', '--output', `${output}.mjs`, source,],
    stderr: 'piped',
  },).output();
  if (!result.success) {
    throw new HelperBuildError(`${name}: ${new TextDecoder().decode(result.stderr,)}`,);
  }
  const bundled = await Deno.readTextFile(`${output}.mjs`,);
  await Deno.writeTextFile(output, `#!/usr/bin/qjs\n${bundled}`,);
  await Deno.remove(`${output}.mjs`,);
  await Deno.chmod(output, 0o755,).catch(() => undefined);
  l.info(`built ${output}`,);
}

const directory = outDir();
await Deno.mkdir(directory, { recursive: true, },);
for (const [name, entry,] of Object.entries(ENTRIES,)) {
  await bundle({ name, entry, directory, },);
}
