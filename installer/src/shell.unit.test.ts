/**
 Tests for `createSystemShell`, running Deno itself as the child process so they work on every platform.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  CommandFailedError,
  createSystemShell,
} from './shell.ts';

/**
 Builds a command that evaluates JavaScript in a child Deno.

 @param source - script to evaluate
 @returns argument vector
 @example
 ```ts
 const argv = denoEval('console.log(1)',);
 ```
 */
function denoEval(source: string,): readonly string[] {
  return [Deno.execPath(), 'eval', source,];
}

await describe({
  name: createSystemShell.name,
  children: [
    it({
      name: 'runs a successful command without capturing its output',
      fn: async () => {
        await createSystemShell().run({ description: 'succeed', argv: denoEval('console.log("shown")',), },);
      },
    },),
    it({
      name: 'throws when a command fails, for both run and capture',
      fn: async () => {
        const shell = createSystemShell();
        await expect(shell.run({ description: 'fail', argv: denoEval('Deno.exit(3)',), },),).rejects.toThrow(
          CommandFailedError,
        );
        await expect(shell.capture({ description: 'fail', argv: denoEval('Deno.exit(4)',), },),).rejects.toThrow(
          CommandFailedError,
        );
      },
    },),
    it({
      name: 'captures output and passes standard input and environment variables to the command',
      fn: async () => {
        const output = await createSystemShell().capture({
          description: 'echo input and environment',
          argv: denoEval(
            'const input = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer()); console.log(input.trim() + ":" + Deno.env.get("INSTALLER_TEST"))',
          ),
          stdin: 'from-stdin\n',
          environment: { INSTALLER_TEST: 'from-environment', },
        },);
        expect(output.trim(),).toEqual('from-stdin:from-environment',);
      },
    },),
    it({
      name: 'writes files with their mode, creating parent directories',
      fn: async () => {
        const directory = await Deno.makeTempDir();
        const path = `${directory}/nested/file.conf`;
        const shell = createSystemShell();
        await shell.writeFile({ description: 'nested file', path, content: 'value\n', mode: 0o600, },);
        expect(await shell.readFile(path,),).toEqual('value\n',);
        if (Deno.build.os !== 'windows') {
          expect((await Deno.stat(path,)).mode! & 0o777,).toEqual(0o600,);
        }
        await Deno.remove(directory, { recursive: true, },);
      },
    },),
  ],
},);
