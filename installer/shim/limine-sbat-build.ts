#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 Builds a copy of Limine carrying a `.sbat` section, which shim 15.3 and later require of every second stage.

 Installed on Hyper-V guests as `/usr/local/bin/limine-sbat-build`
 and run by a pacman hook whenever Limine is installed or upgraded.
 limine-entry-tool deploys the copy through `LIMINE_BINARY_PATH`.
 The file is self-contained,
 because a pacman hook must not need the network to resolve imports.

 @module
 */

/** Limine's own EFI binary. */
const SOURCE = '/usr/share/limine/BOOTX64.EFI';

/** SBAT-carrying copy that limine-entry-tool deploys. */
const DESTINATION = '/usr/local/share/limine/BOOTX64.EFI';

/** Size of a PE section header. */
const SECTION_HEADER_SIZE = 40;

/** Offset of the PE header pointer in the DOS header. */
const PE_POINTER_OFFSET = 0x3c;

/** Offsets inside the PE file header and optional header. */
const PE = {
  sectionCountOffset: 6,
  optionalHeaderSizeOffset: 20,
  optionalHeaderOffset: 24,
  sizeOfImageOffset: 56,
  sizeOfHeadersOffset: 60,
} as const;

/** Offsets inside a section header. */
const SECTION = {
  virtualSizeOffset: 8,
  virtualAddressOffset: 12,
  nameLength: 8,
} as const;

/** Thrown when the built binary would be rejected by shim's loader or a build command fails. */
export class SbatBuildError extends Error {
  /**
   @param message - which check or command failed
   */
  constructor(message: string,) {
    super(message,);
    this.name = SbatBuildError.name;
  }
}

/** One PE section's name and virtual address range. */
export type PeSection = {
  /** Section name with trailing NUL bytes removed. */
  readonly name: string;
  /** First virtual address. */
  readonly start: number;
  /** One past the last virtual address; empty sections count as one byte. */
  readonly end: number;
};

/**
 Reads section ranges and checks the layout rules shim's loader enforces.

 @param image - PE file bytes
 @returns sections sorted by address
 @throws {SbatBuildError} when a section ends past SizeOfImage,
 starts inside the headers,
 overlaps another,
 or no `.sbat` section exists
 @example
 ```ts
 const sections = checkPeLayout(await Deno.readFile('BOOTX64.EFI.new',),);
 ```
 */
export function checkPeLayout(image: Uint8Array,): readonly PeSection[] {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength,);
  const pe = view.getUint32(PE_POINTER_OFFSET, true,);
  const sectionCount = view.getUint16(pe + PE.sectionCountOffset, true,);
  const optionalHeaderSize = view.getUint16(pe + PE.optionalHeaderSizeOffset, true,);
  const optional = pe + PE.optionalHeaderOffset;
  const sizeOfImage = view.getUint32(optional + PE.sizeOfImageOffset, true,);
  const sizeOfHeaders = view.getUint32(optional + PE.sizeOfHeadersOffset, true,);
  const sections = Array.from({ length: sectionCount, }, (_unused, index,) => {
    const header = optional + optionalHeaderSize + SECTION_HEADER_SIZE * index;
    const name = new TextDecoder().decode(image.subarray(header, header + SECTION.nameLength,),).replaceAll('\0', '',);
    const virtualSize = view.getUint32(header + SECTION.virtualSizeOffset, true,);
    const start = view.getUint32(header + SECTION.virtualAddressOffset, true,);
    if (start + virtualSize > sizeOfImage) {
      throw new SbatBuildError(`section ${name} ends past SizeOfImage`,);
    }
    if (start < sizeOfHeaders) {
      throw new SbatBuildError(`section ${name} starts inside the headers`,);
    }
    return { name, start, end: start + Math.max(virtualSize, 1,), };
  },).toSorted((left, right,) => left.start - right.start);
  sections.slice(1,).forEach((section, index,) => {
    const previous = sections[index];
    if (previous !== undefined && previous.end > section.start) {
      throw new SbatBuildError(`sections ${previous.name} and ${section.name} overlap`,);
    }
  },);
  if (!sections.some((section,) => section.name === '.sbat')) {
    throw new SbatBuildError('no .sbat section',);
  }
  return sections;
}

/**
 Builds the SBAT metadata for a Limine version.

 @param version - Limine package version
 @returns CSV content of the `.sbat` section
 @example
 ```ts
 const csv = sbatCsv('11.2.0-1',);
 ```
 */
export function sbatCsv(version: string,): string {
  return [
    'sbat,1,SBAT Version,sbat,1,https://github.com/rhboot/shim/blob/main/SBAT.md',
    `limine,1,Limine,limine,${version},https://limine-bootloader.org`,
    '',
  ].join('\n',);
}

/**
 Runs a program and returns its standard output.

 @param argv - program and arguments
 @returns standard output
 @throws {SbatBuildError} when the program fails
 @example
 ```ts
 const version = await output(['pacman', '-Q', 'limine',],);
 ```
 */
async function output(argv: readonly string[],): Promise<string> {
  const [program, ...args] = argv;
  const result = await new Deno.Command(program ?? '', { args, stderr: 'inherit', },).output();
  if (!result.success) {
    throw new SbatBuildError(`${argv.join(' ',)} exited with code ${result.code}`,);
  }
  return new TextDecoder().decode(result.stdout,);
}

/**
 Builds and checks the SBAT copy, replacing the previous one only when every check passes.

 @example
 ```ts
 await buildSbatCopy();
 ```
 */
async function buildSbatCopy(): Promise<void> {
  const version = (await output(['pacman', '-Q', 'limine',],)).trim().split(' ',)[1] ?? '';
  // objdump -h shows raw sizes and .data has a zero-filled tail, so SizeOfImage is the first free address.
  const sizeOfImage = (await output(['objdump', '-x', SOURCE,],))
    .split('\n',)
    .find((line,) => line.startsWith('SizeOfImage',))
    ?.replaceAll('\t', ' ',)
    .split(' ',)
    .filter((part,) => part !== '')[1];
  if (sizeOfImage === undefined || version === '') {
    throw new SbatBuildError('could not read the Limine version or SizeOfImage',);
  }
  const csv = await Deno.makeTempFile({ suffix: '.csv', },);
  await Deno.writeTextFile(csv, sbatCsv(version,),);
  await Deno.mkdir(DESTINATION.slice(0, DESTINATION.lastIndexOf('/',),), { recursive: true, },);
  const candidate = `${DESTINATION}.new`;
  await output([
    'objcopy',
    '--add-section',
    `.sbat=${csv}`,
    '--set-section-flags',
    '.sbat=contents,alloc,load,readonly,data',
    '--change-section-vma',
    `.sbat=0x${sizeOfImage}`,
    SOURCE,
    candidate,
  ],);
  await Deno.remove(csv,);
  const sections = checkPeLayout(await Deno.readFile(candidate,),);
  await Deno.rename(candidate, DESTINATION,);
  console.log(
    `built ${DESTINATION} for limine ${version}: ${sections.map((section,) => `${section.name}@0x${section.start.toString(16,)}`).join(', ',)}`,
  );
}

if (import.meta.main) {
  await buildSbatCopy();
}
