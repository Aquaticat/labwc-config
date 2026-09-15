/**
 Tests for the UTF-8 codec used where QuickJS-ng lacks `TextEncoder` and `TextDecoder`.

 @module
 */

import {
  describe,
  expect,
  it,
} from '@monochromatic-dev/module-test';

import {
  decodeUtf8,
  encodeUtf8,
} from './utf8.ts';

/** Text covering one-, two-, three-, and four-byte sequences. */
const SAMPLES = ['Lock screen', 'Ärger ß', '剪贴板 历史', 'emoji 🙂 and 𝄞', '',] as const;

await describe({
  name: 'utf8',
  children: [
    it({
      name: 'encodes exactly like TextEncoder',
      fn: async () => {
        SAMPLES.forEach((sample,) => expect([...encodeUtf8(sample,),],).toEqual([...new TextEncoder().encode(sample,),],));
      },
    },),
    it({
      name: 'decodes exactly like TextDecoder',
      fn: async () => {
        SAMPLES.forEach((sample,) => expect(decodeUtf8(new TextEncoder().encode(sample,),),).toEqual(sample,));
      },
    },),
    it({
      name: 'replaces malformed and truncated sequences with U+FFFD',
      fn: async () => {
        expect(decodeUtf8(new Uint8Array([0x61, 0xff, 0x62,],),),).toEqual('a�b',);
        expect(decodeUtf8(new Uint8Array([0x61, 0xe5, 0x89,],),),).toEqual('a�',);
      },
    },),
  ],
},);
