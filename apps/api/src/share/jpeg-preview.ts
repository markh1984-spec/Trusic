import type { RgbaImage } from "./canvas";

/**
 * Decode a JPEG at one eighth of its size, cheaply. Every 8×8 block of a JPEG stores its average colour
 * separately (the "DC" coefficient), so a small preview can be read without the full decoding maths. A
 * 3000×3000 cover becomes 375×375 using a few megabytes, where a full decode needs hundreds. Handles
 * baseline and progressive JPEGs, colour and greyscale, any chroma subsampling, and restart markers.
 * Returns null for anything else (CMYK, arithmetic coding, lossless), which then gets a placeholder.
 */
export function decodeJpegPreview(bytes: Uint8Array): RgbaImage | null {
  try {
    return decode(bytes);
  } catch {
    return null;
  }
}

interface Component {
  id: number;
  h: number;
  v: number;
  quant: number;
  /** Blocks across and down, padded to whole MCUs. */
  blocksAcross: number;
  blocksDown: number;
  /** Blocks that cover the image, for scans of this component alone. */
  usedAcross: number;
  usedDown: number;
  dc: Int32Array;
}

interface ScanComponent {
  component: Component;
  dc: Huffman | undefined;
  ac: Huffman | undefined;
}

interface Huffman {
  maxCode: Int32Array;
  valuePointer: Int32Array;
  minCode: Int32Array;
  symbols: Uint8Array;
}

function buildHuffman(counts: Uint8Array, symbols: Uint8Array): Huffman {
  const maxCode = new Int32Array(18).fill(-1);
  const valuePointer = new Int32Array(17);
  const minCode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    const n = counts[length - 1]!;
    if (n) {
      valuePointer[length] = k;
      minCode[length] = code;
      code += n;
      k += n;
      maxCode[length] = code - 1;
    }
    code <<= 1;
  }
  maxCode[17] = 0x7fffffff;
  return { maxCode, valuePointer, minCode, symbols };
}

function decode(bytes: Uint8Array): RgbaImage | null {
  const u16 = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
  if (u16(0) !== 0xffd8) return null;
  const quantDc = new Int32Array(4).fill(1);
  const dcTables: Huffman[] = [];
  const acTables: Huffman[] = [];
  let components: Component[] = [];
  let width = 0;
  let height = 0;
  let maxH = 1;
  let maxV = 1;
  let mcusAcross = 0;
  let mcusDown = 0;
  let progressive = false;
  let restartInterval = 0;
  let adobeRgb = false;

  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) {
      p++;
      continue;
    }
    const marker = bytes[p + 1]!;
    p += 2;
    if (marker === 0xd8 || marker === 0x01 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) {
      if (marker === 0xff) p--; // fill byte
      continue;
    }
    if (marker === 0xd9) break;
    const length = u16(p);
    const start = p + 2;
    const end = p + length;

    if (marker === 0xdb) {
      for (let q = start; q < end;) {
        const precision = bytes[q]! >> 4;
        const id = bytes[q]! & 15;
        // Only the first value (the DC quantiser) matters here.
        quantDc[id] = precision ? u16(q + 1) : bytes[q + 1]!;
        q += 1 + 64 * (precision ? 2 : 1);
      }
    } else if (marker === 0xc4) {
      for (let q = start; q < end;) {
        const tableClass = bytes[q]! >> 4;
        const id = bytes[q]! & 15;
        const counts = bytes.subarray(q + 1, q + 17);
        const total = counts.reduce((a, b) => a + b, 0);
        const table = buildHuffman(counts, bytes.subarray(q + 17, q + 17 + total));
        (tableClass === 0 ? dcTables : acTables)[id] = table;
        q += 17 + total;
      }
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      progressive = marker === 0xc2;
      height = u16(start + 1);
      width = u16(start + 3);
      const count = bytes[start + 5]!;
      if (!width || !height || (count !== 1 && count !== 3)) return null;
      const raw = [];
      for (let i = 0; i < count; i++) {
        const at = start + 6 + i * 3;
        raw.push({ id: bytes[at]!, h: bytes[at + 1]! >> 4, v: bytes[at + 1]! & 15, tq: bytes[at + 2]! });
      }
      maxH = Math.max(...raw.map((c) => c.h));
      maxV = Math.max(...raw.map((c) => c.v));
      mcusAcross = Math.ceil(width / (8 * maxH));
      mcusDown = Math.ceil(height / (8 * maxV));
      components = raw.map((c) => {
        const blocksAcross = mcusAcross * c.h;
        const blocksDown = mcusDown * c.v;
        return {
          id: c.id,
          h: c.h,
          v: c.v,
          quant: c.tq,
          blocksAcross,
          blocksDown,
          usedAcross: Math.ceil(Math.ceil((width * c.h) / maxH) / 8),
          usedDown: Math.ceil(Math.ceil((height * c.v) / maxV) / 8),
          dc: new Int32Array(blocksAcross * blocksDown),
        };
      });
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return null; // lossless, hierarchical or arithmetic coded
    } else if (marker === 0xdd) {
      restartInterval = u16(start);
    } else if (marker === 0xee) {
      // Adobe's marker says whether three components are YCbCr or plain RGB.
      if (bytes[start] === 0x41 && bytes[start + 1] === 0x64 && length >= 12) adobeRgb = bytes[start + 11] === 0;
    } else if (marker === 0xda) {
      if (!components.length) return null;
      const count = bytes[start]!;
      const scan: ScanComponent[] = [];
      for (let i = 0; i < count; i++) {
        const component = components.find((c) => c.id === bytes[start + 1 + i * 2]);
        if (!component) return null;
        const tables = bytes[start + 2 + i * 2]!;
        scan.push({ component, dc: dcTables[tables >> 4], ac: acTables[tables & 15] });
      }
      const at = start + 1 + count * 2;
      const spectralStart = bytes[at]!;
      const ah = bytes[at + 2]! >> 4;
      const al = bytes[at + 2]! & 15;
      // Progressive scans of the finer detail (AC) aren't needed: skip to the next marker.
      p =
        spectralStart === 0
          ? decodeDcScan(bytes, end, scan, { progressive, ah, al, restartInterval, mcusAcross, mcusDown })
          : nextMarker(bytes, end);
      continue;
    }
    p = end;
  }
  if (!components.length) return null;

  // One output pixel per 8×8 block of the full image.
  const outWidth = Math.ceil(width / 8);
  const outHeight = Math.ceil(height / 8);
  const data = new Uint8Array(outWidth * outHeight * 4);
  const sample = (c: Component, x: number, y: number) => {
    const bx = Math.min(c.blocksAcross - 1, Math.floor((x * c.h) / maxH));
    const by = Math.min(c.blocksDown - 1, Math.floor((y * c.v) / maxV));
    return (c.dc[by * c.blocksAcross + bx]! * quantDc[c.quant]!) / 8 + 128;
  };
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const o = (y * outWidth + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      if (components.length === 1) {
        r = g = b = sample(components[0]!, x, y);
      } else if (adobeRgb) {
        [r, g, b] = [sample(components[0]!, x, y), sample(components[1]!, x, y), sample(components[2]!, x, y)];
      } else {
        const lum = sample(components[0]!, x, y);
        const cb = sample(components[1]!, x, y) - 128;
        const cr = sample(components[2]!, x, y) - 128;
        r = lum + 1.402 * cr;
        g = lum - 0.344136 * cb - 0.714136 * cr;
        b = lum + 1.772 * cb;
      }
      data[o] = Math.max(0, Math.min(255, Math.round(r)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
      data[o + 3] = 255;
    }
  }
  return { width: outWidth, height: outHeight, data };
}

/** Where the next marker (other than a restart marker) starts, from `p` in entropy-coded data. */
function nextMarker(bytes: Uint8Array, p: number): number {
  for (let i = p; i + 1 < bytes.length; i++) {
    if (bytes[i] !== 0xff) continue;
    const next = bytes[i + 1]!;
    if (next !== 0 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) return i;
  }
  return bytes.length;
}

/** Read the DC values of one scan into each component's `dc`, skipping the rest. Returns where the scan ends. */
function decodeDcScan(
  bytes: Uint8Array,
  dataStart: number,
  scan: ScanComponent[],
  options: {
    progressive: boolean;
    ah: number;
    al: number;
    restartInterval: number;
    mcusAcross: number;
    mcusDown: number;
  },
): number {
  let p = dataStart;
  let bitBuffer = 0;
  let bitCount = 0;
  const readBit = (): number => {
    if (bitCount === 0) {
      if (p >= bytes.length) return 0;
      const value = bytes[p]!;
      if (value === 0xff) {
        // 0xFF 0x00 is a 0xFF byte of data; anything else is a marker, which ends the data (read as zeros).
        if (bytes[p + 1] !== 0) return 0;
        p += 2;
      } else p++;
      bitBuffer = value;
      bitCount = 8;
    }
    bitCount--;
    return (bitBuffer >> bitCount) & 1;
  };
  const readBits = (n: number) => {
    let value = 0;
    for (let i = 0; i < n; i++) value = (value << 1) | readBit();
    return value;
  };
  const receiveExtend = (size: number) => {
    if (size === 0) return 0;
    const value = readBits(size);
    return value < 1 << (size - 1) ? value - (1 << size) + 1 : value;
  };
  const decodeHuffman = (table: Huffman): number => {
    let code = readBit();
    let length = 1;
    while (code > table.maxCode[length]!) {
      code = (code << 1) | readBit();
      if (++length > 16) throw new Error("bad Huffman code");
    }
    return table.symbols[table.valuePointer[length]! + code - table.minCode[length]!]!;
  };

  const { progressive, ah, al, restartInterval } = options;
  const predictions = new Map<Component, number>(scan.map(({ component }) => [component, 0]));

  const decodeBlock = (entry: ScanComponent, index: number) => {
    const { component } = entry;
    if (progressive && ah > 0) {
      // A refinement scan adds one more bit to each value.
      if (readBit()) component.dc[index] = component.dc[index]! | (1 << al);
      return;
    }
    if (!entry.dc) throw new Error("missing Huffman table");
    const size = decodeHuffman(entry.dc);
    const value = predictions.get(component)! + receiveExtend(size);
    predictions.set(component, value);
    component.dc[index] = progressive ? value << al : value;
    if (!progressive) {
      // Baseline scans hold each block's fine detail as well, which has to be read past.
      if (!entry.ac) throw new Error("missing Huffman table");
      for (let k = 1; k < 64;) {
        const rs = decodeHuffman(entry.ac);
        const run = rs >> 4;
        const bits = rs & 15;
        if (bits) {
          readBits(bits);
          k += run + 1;
        } else if (run === 15) k += 16;
        else break;
      }
    }
  };

  const restart = () => {
    // Restart markers sit between intervals: realign to a byte, step over the marker, reset predictions.
    bitCount = 0;
    if (bytes[p] === 0xff && bytes[p + 1]! >= 0xd0 && bytes[p + 1]! <= 0xd7) p += 2;
    for (const key of predictions.keys()) predictions.set(key, 0);
  };

  let units = 0;
  const unitDone = () => {
    units++;
    if (restartInterval && units % restartInterval === 0) restart();
  };

  if (scan.length === 1) {
    // A scan of one component goes block by block over just the blocks the image covers.
    const entry = scan[0]!;
    const c = entry.component;
    for (let by = 0; by < c.usedDown; by++) {
      for (let bx = 0; bx < c.usedAcross; bx++) {
        decodeBlock(entry, by * c.blocksAcross + bx);
        unitDone();
      }
    }
  } else {
    for (let my = 0; my < options.mcusDown; my++) {
      for (let mx = 0; mx < options.mcusAcross; mx++) {
        for (const entry of scan) {
          const c = entry.component;
          for (let v = 0; v < c.v; v++) {
            for (let h = 0; h < c.h; h++) decodeBlock(entry, (my * c.v + v) * c.blocksAcross + mx * c.h + h);
          }
        }
        unitDone();
      }
    }
  }
  return nextMarker(bytes, p);
}
