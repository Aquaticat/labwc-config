/**
 UTF-8 encoding and decoding for QuickJS-ng, which has no `TextEncoder` or `TextDecoder`.

 Decoding follows the WHATWG Encoding Standard's UTF-8 decoder,
 so malformed input produces the same replacement characters as `TextDecoder`.

 @module
 */

/** Replacement character for unencodable or malformed input. */
const REPLACEMENT = 0xfffd;

/**
 Encodes text as UTF-8.

 @param text - text to encode; lone surrogates become U+FFFD
 @returns the encoded bytes
 */
export function encodeUtf8(text: string,): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let codePoint = text.charCodeAt(index,);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = text.charCodeAt(index + 1,);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index++;
      } else {
        codePoint = REPLACEMENT;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = REPLACEMENT;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint,);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f),);
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f),);
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes,);
}

/**
 Decodes UTF-8 bytes.

 @param bytes - bytes to decode
 @returns the text, with each malformed or truncated sequence replaced by U+FFFD
 */
export function decodeUtf8(bytes: Uint8Array,): string {
  const codePoints: number[] = [];
  let codePoint = 0;
  let needed = 0;
  let seen = 0;
  let lower = 0x80;
  let upper = 0xbf;
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    if (needed === 0) {
      index++;
      if (byte <= 0x7f) {
        codePoints.push(byte,);
      } else if (byte >= 0xc2 && byte <= 0xdf) {
        needed = 1;
        codePoint = byte & 0x1f;
      } else if (byte >= 0xe0 && byte <= 0xef) {
        lower = byte === 0xe0 ? 0xa0 : 0x80;
        upper = byte === 0xed ? 0x9f : 0xbf;
        needed = 2;
        codePoint = byte & 0xf;
      } else if (byte >= 0xf0 && byte <= 0xf4) {
        lower = byte === 0xf0 ? 0x90 : 0x80;
        upper = byte === 0xf4 ? 0x8f : 0xbf;
        needed = 3;
        codePoint = byte & 0x7;
      } else {
        codePoints.push(REPLACEMENT,);
      }
      continue;
    }
    if (byte < lower || byte > upper) {
      // The byte starts a new sequence, so it is examined again without advancing.
      codePoints.push(REPLACEMENT,);
      needed = 0;
      seen = 0;
      lower = 0x80;
      upper = 0xbf;
      continue;
    }
    index++;
    lower = 0x80;
    upper = 0xbf;
    codePoint = (codePoint << 6) | (byte & 0x3f);
    seen++;
    if (seen === needed) {
      codePoints.push(codePoint,);
      needed = 0;
      seen = 0;
    }
  }
  if (needed !== 0) {
    codePoints.push(REPLACEMENT,);
  }
  let text = '';
  for (let start = 0; start < codePoints.length; start += 4096) {
    text += String.fromCodePoint(...codePoints.slice(start, start + 4096,),);
  }
  return text;
}
