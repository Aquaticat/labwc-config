/**
 Runs every `*.unit.test.ts` file under the given directories, each in its own Deno process.

 ```sh
 deno run --allow-read --allow-run --allow-env --allow-sys test-support/run-unit-tests.ts installer helpers
 ```

 A separate process per file keeps one file's leaked async work from being attributed to another.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

const l = tagged({ tag: 'run-unit-tests', },);

/** Thrown when at least one test file fails. */
class UnitTestsFailedError extends Error {
  /**
   @param message - failing files
   */
  constructor(message: string,) {
    super(message,);
    this.name = UnitTestsFailedError.name;
  }
}

/** Suffix that marks a unit test file. */
const UNIT_TEST_SUFFIX = '.unit.test.ts';

/**
 Lists unit test files under a directory.

 @param directory - directory to search
 @returns test file paths, sorted so runs are reproducible
 @example
 ```ts
 const files = await unitTestFiles('installer',);
 ```
 */
async function unitTestFiles(directory: string,): Promise<readonly string[]> {
  const pending = [directory,];
  const found: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    for await (const entry of Deno.readDir(current,)) {
      const path = `${current}/${entry.name}`;
      if (entry.isDirectory && entry.name !== 'node_modules' && entry.name !== 'target') {
        pending.push(path,);
      } else if (entry.isFile && entry.name.endsWith(UNIT_TEST_SUFFIX,)) {
        found.push(path,);
      }
    }
  }
  return found.toSorted();
}

const directories = Deno.args.length > 0 ? Deno.args : ['installer', 'helpers',];
const files = (await Promise.all(directories.map(unitTestFiles,))).flat();
const failed: string[] = [];
for (const file of files) {
  const result = await new Deno.Command(Deno.execPath(), {
    // Tests write only to temporary directories they create.
    args: ['run', '--allow-read', '--allow-env', '--allow-sys', '--allow-write', file,],
    stdout: 'inherit',
    stderr: 'inherit',
  },).output();
  if (result.success) {
    l.info(`passed ${file}`,);
  } else {
    l.error(`failed ${file} with exit code ${result.code}`,);
    failed.push(file,);
  }
}
await l.flush();
if (failed.length > 0) {
  throw new UnitTestsFailedError(`${failed.length} of ${files.length} test files failed: ${failed.join(', ',)}`,);
}
l.info(`all ${files.length} test files passed`,);
await l.flush();
