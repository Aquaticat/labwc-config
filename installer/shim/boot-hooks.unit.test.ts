/**
 Tests for the Hyper-V boot hooks.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  checkPeLayout,
  SbatBuildError,
  sbatCsv,
} from './limine-sbat-build.ts';
import {
  copyForShim,
  directLimineEntries,
  needsCopy,
} from './shim-limine-copy.ts';

/** Address where the synthetic image's PE header starts. */
const PE_OFFSET = 0x40;

/** PE32+ optional header size. */
const OPTIONAL_HEADER_SIZE = 240;

/** Headers end here, so sections must start at or after it. */
const SIZE_OF_HEADERS = 0x400;

/**
 Builds a minimal PE image with the given sections.

 @param sections - name, virtual address, and virtual size of each section
 @param sizeOfImage - value of the optional header's SizeOfImage
 @returns image bytes readable by `checkPeLayout`
 @example
 ```ts
 const image = peImage({ sections: [{ name: '.text', start: 0x1000, size: 0x100, },], sizeOfImage: 0x2000, },);
 ```
 */
function peImage({ sections, sizeOfImage, }: {
  readonly sections: readonly { readonly name: string; readonly start: number; readonly size: number; }[];
  readonly sizeOfImage: number;
},): Uint8Array {
  const image = new Uint8Array(SIZE_OF_HEADERS,);
  const view = new DataView(image.buffer,);
  view.setUint32(0x3c, PE_OFFSET, true,);
  view.setUint16(PE_OFFSET + 6, sections.length, true,);
  view.setUint16(PE_OFFSET + 20, OPTIONAL_HEADER_SIZE, true,);
  view.setUint32(PE_OFFSET + 24 + 56, sizeOfImage, true,);
  view.setUint32(PE_OFFSET + 24 + 60, SIZE_OF_HEADERS, true,);
  sections.forEach((section, index,) => {
    const header = PE_OFFSET + 24 + OPTIONAL_HEADER_SIZE + 40 * index;
    image.set(new TextEncoder().encode(section.name,), header,);
    view.setUint32(header + 8, section.size, true,);
    view.setUint32(header + 12, section.start, true,);
  },);
  return image;
}

/** Sections of a well-formed Limine copy with `.sbat` placed at the old SizeOfImage. */
const GOOD_SECTIONS = [
  { name: '.text', start: 0x1000, size: 0x800, },
  { name: '.data', start: 0x2000, size: 0x1000, },
  { name: '.sbat', start: 0x3000, size: 0x80, },
] as const;

await describe({
  name: 'boot hooks',
  children: [
    it({
      name: 'accepts a Limine copy whose .sbat section follows the others inside SizeOfImage',
      fn: async () => {
        const sections = checkPeLayout(peImage({ sections: GOOD_SECTIONS, sizeOfImage: 0x4000, },),);
        expect(sections.map((section,) => section.name),).toEqual(['.text', '.data', '.sbat',],);
      },
    },),
    it({
      name: 'rejects the layouts shim refuses to load',
      fn: async () => {
        expect(() => checkPeLayout(peImage({ sections: GOOD_SECTIONS, sizeOfImage: 0x3040, },),)).toThrow(SbatBuildError,);
        expect(() =>
          checkPeLayout(peImage({
            sections: [...GOOD_SECTIONS.slice(0, 2,), { name: '.sbat', start: 0x2800, size: 0x80, },],
            sizeOfImage: 0x4000,
          },),)
        ).toThrow(SbatBuildError,);
        expect(() =>
          checkPeLayout(peImage({
            sections: [{ name: '.sbat', start: 0x200, size: 0x80, }, ...GOOD_SECTIONS.slice(0, 2,),],
            sizeOfImage: 0x4000,
          },),)
        ).toThrow(SbatBuildError,);
        expect(() => checkPeLayout(peImage({ sections: GOOD_SECTIONS.slice(0, 2,), sizeOfImage: 0x4000, },),)).toThrow(
          SbatBuildError,
        );
      },
    },),
    it({
      name: 'names the Limine version in the SBAT metadata',
      fn: async () => {
        expect(sbatCsv('11.2.0-1',).split('\n',)[1],).toEqual(
          'limine,1,Limine,limine,11.2.0-1,https://limine-bootloader.org',
        );
      },
    },),
    it({
      name: 'finds only the boot entries that start Limine without shim',
      fn: async () => {
        const listing = [
          'BootCurrent: 0001',
          'BootOrder: 0003,0001,0000',
          'Boot0000* EFI SCSI Device\tAcpiEx(VMBus,2,0)/VenHw(9b17e5a2-0891-42dd-b653-80b5c22809ba,...)',
          'Boot0001* CachyOS (shim)\tHD(1,GPT,0a1b,0x800,0x800000)/\\EFI\\BOOT\\BOOTX64.EFI',
          'Boot0003* Limine\tHD(1,GPT,0a1b,0x800,0x800000)/\\EFI\\limine\\limine_x64.efi',
          '',
        ].join('\n',);
        expect(directLimineEntries(listing,),).toEqual(['0003',],);
        expect(directLimineEntries('BootOrder: 0001\n',),).toEqual([],);
      },
    },),
    it({
      name: 'copies Limine for shim only when it is deployed and differs',
      fn: async () => {
        const bytes = new Uint8Array([1, 2, 3,],);
        expect(needsCopy({ source: undefined, destination: bytes, },),).toEqual(false,);
        expect(needsCopy({ source: bytes, destination: undefined, },),).toEqual(true,);
        expect(needsCopy({ source: bytes, destination: new Uint8Array([1, 2, 3,],), },),).toEqual(false,);
        expect(needsCopy({ source: bytes, destination: new Uint8Array([1, 2, 4,],), },),).toEqual(true,);

        const directory = await Deno.makeTempDir();
        const source = `${directory}/limine_x64.efi`;
        const destination = `${directory}/grubx64.efi`;
        await Deno.writeFile(source, bytes,);
        expect(await copyForShim({ source, destination, },),).toEqual(true,);
        expect(await Deno.readFile(destination,),).toEqual(bytes,);
        expect(await copyForShim({ source, destination, },),).toEqual(false,);
        await Deno.remove(directory, { recursive: true, },);
      },
    },),
  ],
},);
