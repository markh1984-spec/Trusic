/**
 * A small baseline JPEG encoder for share images. Link previews want small JPEGs (WhatsApp skips images much
 * over 300 KB), and the JavaScript encoder on npm rebuilds big lookup tables for every image, which left the
 * server holding on to about 100 MB after a few images. This one builds its tables once and writes into a
 * reused buffer. Standard tables and the AAN forward DCT, as in the JPEG standard (ITU T.81, Annex K) and the
 * Independent JPEG Group's library; no chroma subsampling, so coloured text stays sharp.
 */

/** Zigzag position of each coefficient, in natural (row by row) order. */
const ZIGZAG = [
  0, 1, 5, 6, 14, 15, 27, 28, 2, 4, 7, 13, 16, 26, 29, 42, 3, 8, 12, 17, 25, 30, 41, 43, 9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54, 20, 22, 33, 38, 46, 51, 55, 60, 21, 34, 37, 47, 50, 56, 59, 61, 35, 36, 48, 49, 57,
  58, 62, 63,
];

const LUMINANCE_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
  87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
];
const CHROMINANCE_QUANT = [
  17,
  18,
  24,
  47,
  99,
  99,
  99,
  99,
  18,
  21,
  26,
  66,
  99,
  99,
  99,
  99,
  24,
  26,
  56,
  99,
  99,
  99,
  99,
  99,
  47,
  66,
  ...Array(38).fill(99),
];

/** Huffman tables: how many codes of each length (1-16), then the symbols in order. */
const DC_LUMINANCE = {
  counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const DC_CHROMINANCE = {
  counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
  symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const AC_LUMINANCE = {
  counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d],
  symbols: [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14,
    0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09,
    0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a,
    0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65,
    0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88,
    0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9,
    0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
    0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
    0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};
const AC_CHROMINANCE = {
  counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
  symbols: [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32,
    0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16,
    0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64,
    0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86,
    0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8,
    0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
    0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
  ],
};

interface HuffmanTable {
  codes: Uint16Array;
  lengths: Uint8Array;
}

function huffman({ counts, symbols }: { counts: number[]; symbols: number[] }): HuffmanTable {
  const codes = new Uint16Array(256);
  const lengths = new Uint8Array(256);
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < counts[length - 1]!; i++) {
      codes[symbols[k]!] = code++;
      lengths[symbols[k++]!] = length;
    }
    code *= 2;
  }
  return { codes, lengths };
}

const TABLES = {
  dcY: huffman(DC_LUMINANCE),
  acY: huffman(AC_LUMINANCE),
  dcC: huffman(DC_CHROMINANCE),
  acC: huffman(AC_CHROMINANCE),
};

/** AAN scale factors for the forward DCT. */
const AASF = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.5411961, 0.275899379];

interface Quantisation {
  /** Quantisers in zigzag order, as written to the file. */
  y: Uint8Array;
  c: Uint8Array;
  /** Multipliers that combine DCT scaling and quantisation, in natural order. */
  yScale: Float32Array;
  cScale: Float32Array;
}

const quantisations = new Map<number, Quantisation>();

function quantisation(quality: number): Quantisation {
  const cached = quantisations.get(quality);
  if (cached) return cached;
  const scale = quality < 50 ? Math.floor(5000 / quality) : Math.floor(200 - quality * 2);
  const table = (base: number[]) => {
    const zigzagged = new Uint8Array(64);
    for (let i = 0; i < 64; i++)
      zigzagged[ZIGZAG[i]!] = Math.min(255, Math.max(1, Math.floor((base[i]! * scale + 50) / 100)));
    const multipliers = new Float32Array(64);
    for (let row = 0, k = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++, k++)
        multipliers[k] = 1 / (zigzagged[ZIGZAG[k]!]! * AASF[row]! * AASF[col]! * 8);
    }
    return [zigzagged, multipliers] as const;
  };
  const [y, yScale] = table(LUMINANCE_QUANT);
  const [c, cScale] = table(CHROMINANCE_QUANT);
  const result = { y, c, yScale, cScale };
  quantisations.set(quality, result);
  return result;
}

/** In-place forward DCT of an 8×8 block (AAN algorithm): each row, then each column. */
function forwardDct(d: Float32Array): void {
  for (let i = 0; i < 8; i++) dct8(d, i * 8, 1);
  for (let i = 0; i < 8; i++) dct8(d, i, 8);
}

/** One-dimensional DCT of the 8 values at offset `o`, `s` apart. */
function dct8(d: Float32Array, o: number, s: number): void {
  const i0 = o;
  const i1 = o + s;
  const i2 = o + 2 * s;
  const i3 = o + 3 * s;
  const i4 = o + 4 * s;
  const i5 = o + 5 * s;
  const i6 = o + 6 * s;
  const i7 = o + 7 * s;
  const t0 = d[i0]! + d[i7]!;
  const t7 = d[i0]! - d[i7]!;
  const t1 = d[i1]! + d[i6]!;
  const t6 = d[i1]! - d[i6]!;
  const t2 = d[i2]! + d[i5]!;
  const t5 = d[i2]! - d[i5]!;
  const t3 = d[i3]! + d[i4]!;
  const t4 = d[i3]! - d[i4]!;

  let t10 = t0 + t3;
  const t13 = t0 - t3;
  let t11 = t1 + t2;
  let t12 = t1 - t2;
  d[i0] = t10 + t11;
  d[i4] = t10 - t11;
  const z1 = (t12 + t13) * 0.707106781;
  d[i2] = t13 + z1;
  d[i6] = t13 - z1;

  t10 = t4 + t5;
  t11 = t5 + t6;
  t12 = t6 + t7;
  const z5 = (t10 - t12) * 0.382683433;
  const z2 = 0.5411961 * t10 + z5;
  const z4 = 1.306562965 * t12 + z5;
  const z3 = t11 * 0.707106781;
  const z11 = t7 + z3;
  const z13 = t7 - z3;
  d[i5] = z13 + z2;
  d[i3] = z13 - z2;
  d[i1] = z11 + z4;
  d[i7] = z11 - z4;
}

let output = new Uint8Array(512 * 1024);

/**
 * Encode RGB pixels (three floats per pixel, 0-255, row by row) as a baseline JPEG. `quality` is 1-100, as in
 * most image software.
 */
export function encodeJpeg(rgb: Float32Array, width: number, height: number, quality = 85): Buffer {
  const q = quantisation(Math.min(100, Math.max(1, Math.round(quality))));
  let length = 0;
  const byte = (value: number) => {
    if (length === output.length) {
      const bigger = new Uint8Array(output.length * 2);
      bigger.set(output);
      output = bigger;
    }
    output[length++] = value;
  };
  const word = (value: number) => {
    byte((value >> 8) & 0xff);
    byte(value & 0xff);
  };
  const bytes = (values: ArrayLike<number>) => {
    for (let i = 0; i < values.length; i++) byte(values[i]!);
  };

  // Headers: start of image, JFIF, quantisation tables, frame, Huffman tables, scan.
  word(0xffd8);
  word(0xffe0);
  word(16);
  bytes([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  word(0xffdb);
  word(132);
  byte(0);
  bytes(q.y);
  byte(1);
  bytes(q.c);
  word(0xffc0);
  word(17);
  byte(8);
  word(height);
  word(width);
  byte(3);
  bytes([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  word(0xffc4);
  word(418);
  for (const [klass, table] of [
    [0x00, DC_LUMINANCE],
    [0x10, AC_LUMINANCE],
    [0x01, DC_CHROMINANCE],
    [0x11, AC_CHROMINANCE],
  ] as const) {
    byte(klass);
    bytes(table.counts);
    bytes(table.symbols);
  }
  word(0xffda);
  word(12);
  bytes([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  // Entropy-coded data, with 0xFF bytes followed by 0x00 as the format requires.
  let bits = 0;
  let bitCount = 0;
  const write = (code: number, size: number) => {
    bits = (bits << size) | code;
    bitCount += size;
    while (bitCount >= 8) {
      const value = (bits >> (bitCount - 8)) & 0xff;
      byte(value);
      if (value === 0xff) byte(0);
      bitCount -= 8;
    }
    bits &= (1 << bitCount) - 1;
  };
  // Values are written as their size in bits (Huffman coded), then the bits: one's complement for negatives.
  const sizeOf = (value: number) => (value === 0 ? 0 : 32 - Math.clz32(Math.abs(value)));
  const bitsOf = (value: number, size: number) => (value < 0 ? value + (1 << size) - 1 : value);

  const block = new Float32Array(64);
  const coefficients = new Int32Array(64);
  const encodeBlock = (scale: Float32Array, dcTable: HuffmanTable, acTable: HuffmanTable, previousDc: number) => {
    forwardDct(block);
    for (let i = 0; i < 64; i++) {
      const v = block[i]! * scale[i]!;
      coefficients[ZIGZAG[i]!] = v > 0 ? (v + 0.5) | 0 : (v - 0.5) | 0;
    }
    const dc = coefficients[0]! - previousDc;
    const dcSize = sizeOf(dc);
    write(dcTable.codes[dcSize]!, dcTable.lengths[dcSize]!);
    if (dcSize) write(bitsOf(dc, dcSize), dcSize);
    let last = 63;
    while (last > 0 && coefficients[last] === 0) last--;
    for (let i = 1, zeros = 0; i <= last; i++) {
      const value = coefficients[i]!;
      if (value === 0) {
        zeros++;
        continue;
      }
      // Runs of 16 or more zeros are written as "16 zeros" markers.
      for (; zeros >= 16; zeros -= 16) write(acTable.codes[0xf0]!, acTable.lengths[0xf0]!);
      const size = sizeOf(value);
      const symbol = (zeros << 4) | size;
      write(acTable.codes[symbol]!, acTable.lengths[symbol]!);
      write(bitsOf(value, size), size);
      zeros = 0;
    }
    if (last !== 63) write(acTable.codes[0]!, acTable.lengths[0]!); // end of block
    return coefficients[0]!;
  };

  let dcY = 0;
  let dcCb = 0;
  let dcCr = 0;
  const yBlock = new Float32Array(64);
  const cbBlock = new Float32Array(64);
  const crBlock = new Float32Array(64);
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      for (let k = 0; k < 64; k++) {
        // Blocks past the edge repeat the last row or column.
        const x = Math.min(width - 1, bx + (k & 7));
        const y = Math.min(height - 1, by + (k >> 3));
        const i = (y * width + x) * 3;
        const r = rgb[i]!;
        const g = rgb[i + 1]!;
        const b = rgb[i + 2]!;
        yBlock[k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        cbBlock[k] = -0.16874 * r - 0.33126 * g + 0.5 * b;
        crBlock[k] = 0.5 * r - 0.41869 * g - 0.08131 * b;
      }
      block.set(yBlock);
      dcY = encodeBlock(q.yScale, TABLES.dcY, TABLES.acY, dcY);
      block.set(cbBlock);
      dcCb = encodeBlock(q.cScale, TABLES.dcC, TABLES.acC, dcCb);
      block.set(crBlock);
      dcCr = encodeBlock(q.cScale, TABLES.dcC, TABLES.acC, dcCr);
    }
  }
  // Pad the last byte with 1s, then end of image.
  if (bitCount > 0) write((1 << (8 - bitCount)) - 1, 8 - bitCount);
  word(0xffd9);
  return Buffer.from(output.subarray(0, length));
}
