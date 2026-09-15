#!/usr/bin/env -S deno run --allow-read --allow-write
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

if (import.meta.main) {
  await copyForShim({ source: SOURCE, destination: DESTINATION, },);
}
