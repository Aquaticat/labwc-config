/**
 Signs built packages and assembles them into a pacman repository directory.

 ```sh
 deno run --allow-read --allow-write --allow-run packaging/assemble-repo.ts --packages DIR --output DIR --key KEY_ID!
 ```

 The key names the signing subkey;
 the trailing `!` makes gpg use that subkey instead of choosing one from the primary key.
 The output directory holds exactly what a pacman `Server` URL serves:
 each package with its signature,
 and the signed `labwc-config` database and files archives under their plain names,
 because GitHub Releases cannot serve the symbolic links `repo-add` creates.

 @module
 */

import { tagged, } from '@monochromatic-dev/module-logger';

const l = tagged({ tag: 'assemble-repo', },);

/** Repository name, which pacman.conf's section header must match. */
const REPOSITORY = 'labwc-config';

/** Thrown when arguments are missing or a signing or database command fails. */
class AssembleRepoError extends Error {
  /**
   @param message - which input or command failed and why
   */
  constructor(message: string,) {
    super(message,);
    this.name = AssembleRepoError.name;
  }
}

/**
 Reads the value following `flag` in the command line.

 @param flag - option name including its dashes
 @returns option value, so each required option is checked in one place
 @throws {AssembleRepoError} when the option or its value is absent
 @example
 ```ts
 const output = requiredOption('--output',);
 ```
 */
function requiredOption(flag: string,): string {
  const value = Deno.args[Deno.args.indexOf(flag,) + 1];
  if (!Deno.args.includes(flag,) || value === undefined || value.startsWith('--',)) {
    throw new AssembleRepoError(`${flag} is required`,);
  }
  return value;
}

/**
 Runs a program without a shell and fails loudly when it fails.

 @param argv - program and arguments
 @throws {AssembleRepoError} when the program exits unsuccessfully
 @example
 ```ts
 await runChecked(['gpg', '--version',],);
 ```
 */
async function runChecked(argv: readonly string[],): Promise<void> {
  const [program, ...args] = argv;
  if (program === undefined) {
    throw new AssembleRepoError('empty command',);
  }
  l.info(`running ${argv.join(' ',)}`,);
  const result = await new Deno.Command(program, { args, stdout: 'inherit', stderr: 'inherit', },).output();
  if (!result.success) {
    throw new AssembleRepoError(`${program} exited with code ${result.code}`,);
  }
}

const packages = requiredOption('--packages',);
const output = requiredOption('--output',);
const key = requiredOption('--key',);

const packageNames = (await Array.fromAsync(Deno.readDir(packages,),))
  .filter((entry,) => entry.isFile && entry.name.endsWith('.pkg.tar.zst',))
  .map((entry,) => entry.name)
  .toSorted();
if (packageNames.length === 0) {
  throw new AssembleRepoError(`no .pkg.tar.zst files in ${packages}`,);
}

await Deno.mkdir(output, { recursive: true, },);
for (const name of packageNames) {
  await Deno.copyFile(`${packages}/${name}`, `${output}/${name}`,);
  await runChecked(['gpg', '--batch', '--yes', '--local-user', key, '--detach-sign', '--no-armor', '--output',
    `${output}/${name}.sig`, `${output}/${name}`,],);
}

// repo-add verifies each package signature before adding it, then signs the database.
await runChecked(['repo-add', '--sign', '--key', key, '--verify', `${output}/${REPOSITORY}.db.tar.gz`,
  ...packageNames.map((name,) => `${output}/${name}`),],);

for (const archive of ['db', 'files',]) {
  for (const suffix of ['', '.sig',]) {
    const plain = `${output}/${REPOSITORY}.${archive}${suffix}`;
    const compressed = `${output}/${REPOSITORY}.${archive}.tar.gz${suffix}`;
    await Deno.remove(plain,);
    // pacman requests only the plain names, so the compressed name is renamed rather than published twice.
    await Deno.rename(compressed, plain,);
  }
}
l.info(`assembled ${packageNames.length} packages into ${output}`,);
await l.flush();
