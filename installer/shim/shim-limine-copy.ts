#!/usr/bin/env -S deno run --ext=ts --allow-read --allow-write --allow-run=efibootmgr
/**
 Copies the signed Limine binary to where shim loads its second stage.

 Installed on Hyper-V guests as `/etc/boot/hooks/post.d/95-shim-limine-copy`,
 which limine-mkinitcpio-hook runs after it deploys,
 enrolls,
 and signs Limine.
 shim at `\EFI\BOOT\BOOTX64.EFI` loads `grubx64.efi` from its own directory.

 @module
 */

/** Limine as limine-entry-tool deploys and signs it. */
export const SOURCE = '/boot/EFI/limine/limine_x64.efi';

/** Second stage shim loads. */
export const DESTINATION = '/boot/EFI/BOOT/grubx64.efi';

/**
 Reads a file,
 treating a missing file as absent.

 @param path - file to read
 @returns bytes, or undefined when the file does not exist
 @example
 ```ts
 const bytes = await readIfPresent('/boot/EFI/BOOT/grubx64.efi',);
 ```
 */
async function readIfPresent(path: string,): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path,);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 Decides whether the destination needs replacing.

 @param source - signed Limine, or undefined when Limine is not deployed yet
 @param destination - current second stage, or undefined when absent
 @returns true when shim would load something other than the signed Limine
 @example
 ```ts
 const stale = needsCopy({ source, destination, },);
 ```
 */
export function needsCopy({ source, destination, }: {
  readonly source: Uint8Array | undefined;
  readonly destination: Uint8Array | undefined;
},): boolean {
  if (source === undefined) {
    return false;
  }
  return destination === undefined || source.length !== destination.length
    || source.some((byte, index,) => byte !== destination[index]);
}

/**
 Replaces the second stage atomically when it differs from the signed Limine.

 @param source - path of the signed Limine
 @param destination - path shim loads
 @returns whether a copy was made
 @example
 ```ts
 await copyForShim({ source: SOURCE, destination: DESTINATION, },);
 ```
 */
export async function copyForShim({ source, destination, }: {
  readonly source: string;
  readonly destination: string;
},): Promise<boolean> {
  const sourceBytes = await readIfPresent(source,);
  if (!needsCopy({ source: sourceBytes, destination: await readIfPresent(destination,), },) || sourceBytes === undefined) {
    return false;
  }
  const temporary = `${destination}.new`;
  await Deno.writeFile(temporary, sourceBytes,);
  // The ESP is FAT, which loses unsynced data on power loss; flush before the rename makes the copy visible.
  {
    // Scoped so the handle closes before the rename.
    using written = await Deno.open(temporary, { write: true, },);
    await written.syncData();
  }
  await Deno.rename(temporary, destination,);
  return true;
}

/** Label of the boot entry that starts shim. */
export const SHIM_ENTRY_LABEL = 'CachyOS (shim)';

/**
 Finds boot entries that start Limine directly.

 limine-install registers one on every run;
 under Secure Boot it bypasses shim and fails,
 so the hook removes it.

 @param listing - output of `efibootmgr`
 @returns four-digit boot entry numbers
 @example
 ```ts
 const numbers = directLimineEntries('Boot0003* Limine\tHD(1,GPT,...)/\\EFI\\limine\\limine_x64.efi\n',);
 ```
 */
export function directLimineEntries(listing: string,): readonly string[] {
  return listing
    .split('\n',)
    .filter((line,) => line.startsWith('Boot',) && line.toLowerCase().includes('limine_x64.efi',))
    .map((line,) => line.slice('Boot'.length, 'Boot'.length + 4,));
}

/**
 Runs efibootmgr and returns its output.

 @param args - efibootmgr arguments
 @returns standard output, or undefined when efibootmgr is missing or fails
 @example
 ```ts
 const listing = await efibootmgr([],);
 ```
 */
async function efibootmgr(args: readonly string[],): Promise<string | undefined> {
  try {
    const result = await new Deno.Command('efibootmgr', { args: [...args,], stderr: 'inherit', },).output();
    return result.success ? new TextDecoder().decode(result.stdout,) : undefined;
  } catch (error) {
    // A missing efibootmgr must not fail the boot hook; the copy above already happened.
    console.error(`95-shim-limine-copy: efibootmgr unavailable: ${String(error,)}`,);
    return undefined;
  }
}

/**
 Replaces direct Limine boot entries with one entry that starts shim.

 @example
 ```ts
 await keepShimBootEntry();
 ```
 */
async function keepShimBootEntry(): Promise<void> {
  const listing = await efibootmgr([],);
  if (listing === undefined) {
    return;
  }
  for (const number of directLimineEntries(listing,)) {
    await efibootmgr(['--quiet', '--bootnum', number, '--delete-bootnum',],);
  }
  if (!listing.includes(SHIM_ENTRY_LABEL,)) {
    await efibootmgr([
      '--quiet',
      '--create',
      '--disk',
      '/dev/disk/by-partlabel/ESP',
      '--part',
      '1',
      '--label',
      SHIM_ENTRY_LABEL,
      '--loader',
      '\\EFI\\BOOT\\BOOTX64.EFI',
    ],);
  }
}

if (import.meta.main) {
  await copyForShim({ source: SOURCE, destination: DESTINATION, },);
  await keepShimBootEntry();
}
