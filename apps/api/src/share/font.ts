/**
 * Just enough of a TrueType font reader to draw text on share images without a native graphics library: character
 * to glyph lookup, glyph outlines, advance widths and pair kerning. Ligatures and complex scripts aren't
 * supported; characters the font doesn't have are left out.
 */

export interface Point {
  x: number;
  y: number;
  /** TrueType outlines are quadratic curves: points are either on the curve or control points between. */
  onCurve: boolean;
}

export type Contour = Point[];

export interface PositionedGlyph {
  glyph: number;
  /** Pen position in pixels from the start of the text. */
  x: number;
}

export class Font {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  private readonly tables = new Map<string, number>();
  private readonly numGlyphs: number;
  private readonly numHMetrics: number;
  private readonly longLoca: boolean;
  private readonly cmap: (codePoint: number) => number;
  private readonly kernSubtables: number[];
  private readonly kernCache = new Map<number, number>();
  private readonly outlineCache = new Map<number, Contour[]>();

  constructor(private readonly data: Buffer) {
    const count = data.readUInt16BE(4);
    for (let i = 0; i < count; i++) {
      const record = 12 + i * 16;
      this.tables.set(data.toString("latin1", record, record + 4), data.readUInt32BE(record + 8));
    }
    const head = this.table("head");
    this.unitsPerEm = data.readUInt16BE(head + 18);
    this.longLoca = data.readInt16BE(head + 50) === 1;
    const hhea = this.table("hhea");
    this.ascender = data.readInt16BE(hhea + 4);
    this.descender = data.readInt16BE(hhea + 6);
    this.numHMetrics = data.readUInt16BE(hhea + 34);
    this.numGlyphs = data.readUInt16BE(this.table("maxp") + 4);
    this.cmap = this.readCmap();
    this.kernSubtables = this.readKernLookups();
  }

  private table(tag: string): number {
    const offset = this.tables.get(tag);
    if (offset === undefined) throw new Error(`font has no ${tag} table`);
    return offset;
  }

  /** 0 (the "missing" glyph) when the font doesn't have the character. */
  glyphFor(codePoint: number): number {
    const glyph = this.cmap(codePoint);
    return glyph < this.numGlyphs ? glyph : 0;
  }

  advance(glyph: number): number {
    const hmtx = this.table("hmtx");
    return this.data.readUInt16BE(hmtx + 4 * Math.min(glyph, this.numHMetrics - 1));
  }

  /** Lay text out on one line at `size` pixels. Missing characters are skipped. */
  layout(text: string, size: number, letterSpacing = 0): { glyphs: PositionedGlyph[]; width: number } {
    const scale = size / this.unitsPerEm;
    const glyphs: PositionedGlyph[] = [];
    let x = 0;
    let previous = -1;
    for (const char of text) {
      const glyph = this.glyphFor(char.codePointAt(0)!);
      if (glyph === 0) continue;
      if (previous >= 0) x += this.kerning(previous, glyph) * scale;
      glyphs.push({ glyph, x });
      x += this.advance(glyph) * scale + letterSpacing;
      previous = glyph;
    }
    return { glyphs, width: glyphs.length ? x - letterSpacing : 0 };
  }

  /** The glyph's outline in font units, y pointing up. */
  outline(glyph: number, depth = 0): Contour[] {
    const cached = this.outlineCache.get(glyph);
    if (cached) return cached;
    const contours = this.readOutline(glyph, depth);
    this.outlineCache.set(glyph, contours);
    return contours;
  }

  private glyphRange(glyph: number): [number, number] {
    const loca = this.table("loca");
    const read = (i: number) =>
      this.longLoca ? this.data.readUInt32BE(loca + i * 4) : this.data.readUInt16BE(loca + i * 2) * 2;
    return [read(glyph), read(glyph + 1)];
  }

  private readOutline(glyph: number, depth: number): Contour[] {
    const [start, end] = this.glyphRange(glyph);
    if (start === end || depth > 8) return [];
    const d = this.data;
    const base = this.table("glyf") + start;
    const contourCount = d.readInt16BE(base);
    if (contourCount < 0) return this.readComposite(base + 10, depth);

    const endPoints: number[] = [];
    for (let i = 0; i < contourCount; i++) endPoints.push(d.readUInt16BE(base + 10 + i * 2));
    const pointCount = contourCount ? endPoints[contourCount - 1]! + 1 : 0;
    let p = base + 10 + contourCount * 2;
    p += 2 + d.readUInt16BE(p); // skip hinting instructions

    const flags: number[] = [];
    while (flags.length < pointCount) {
      const flag = d[p++]!;
      flags.push(flag);
      if (flag & 8) for (let repeat = d[p++]!; repeat > 0; repeat--) flags.push(flag);
    }
    const readCoordinates = (shortBit: number, sameBit: number) => {
      const values: number[] = [];
      let value = 0;
      for (const flag of flags) {
        if (flag & shortBit) {
          const delta = d[p++]!;
          value += flag & sameBit ? delta : -delta;
        } else if (!(flag & sameBit)) {
          value += d.readInt16BE(p);
          p += 2;
        }
        values.push(value);
      }
      return values;
    };
    const xs = readCoordinates(2, 16);
    const ys = readCoordinates(4, 32);

    const contours: Contour[] = [];
    let first = 0;
    for (const last of endPoints) {
      const contour: Contour = [];
      for (let i = first; i <= last; i++) contour.push({ x: xs[i]!, y: ys[i]!, onCurve: (flags[i]! & 1) === 1 });
      contours.push(contour);
      first = last + 1;
    }
    return contours;
  }

  /** Accented letters are often built from other glyphs, moved and sometimes scaled. */
  private readComposite(p: number, depth: number): Contour[] {
    const d = this.data;
    const contours: Contour[] = [];
    for (;;) {
      const flags = d.readUInt16BE(p);
      const component = d.readUInt16BE(p + 2);
      p += 4;
      let dx: number;
      let dy: number;
      if (flags & 1) {
        dx = d.readInt16BE(p);
        dy = d.readInt16BE(p + 2);
        p += 4;
      } else {
        dx = d.readInt8(p);
        dy = d.readInt8(p + 1);
        p += 2;
      }
      // Components placed by matching points (rather than by offset) are rare; place them at the origin.
      if (!(flags & 2)) dx = dy = 0;
      let [a, b, c, e] = [1, 0, 0, 1];
      const f2dot14 = (at: number) => d.readInt16BE(at) / 16384;
      if (flags & 8) {
        a = e = f2dot14(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2dot14(p);
        e = f2dot14(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        [a, b, c, e] = [f2dot14(p), f2dot14(p + 2), f2dot14(p + 4), f2dot14(p + 6)];
        p += 8;
      }
      for (const contour of this.outline(component, depth + 1)) {
        contours.push(
          contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + e * pt.y + dy, onCurve: pt.onCurve })),
        );
      }
      if (!(flags & 0x20)) return contours;
    }
  }

  private readCmap(): (codePoint: number) => number {
    const d = this.data;
    const cmap = this.table("cmap");
    const subtables = new Map<string, number>();
    for (let i = 0; i < d.readUInt16BE(cmap + 2); i++) {
      const record = cmap + 4 + i * 8;
      const offset = cmap + d.readUInt32BE(record + 4);
      subtables.set(`${d.readUInt16BE(record)}/${d.readUInt16BE(record + 2)}/${d.readUInt16BE(offset)}`, offset);
    }
    // Prefer full Unicode (format 12), then the Basic Multilingual Plane (format 4).
    const format12 = subtables.get("3/10/12") ?? subtables.get("0/4/12") ?? subtables.get("0/6/12");
    if (format12 !== undefined) {
      const groups = d.readUInt32BE(format12 + 12);
      return (codePoint) => {
        let lo = 0;
        let hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const group = format12 + 16 + mid * 12;
          if (codePoint < d.readUInt32BE(group)) hi = mid - 1;
          else if (codePoint > d.readUInt32BE(group + 4)) lo = mid + 1;
          else return d.readUInt32BE(group + 8) + codePoint - d.readUInt32BE(group);
        }
        return 0;
      };
    }
    const format4 = subtables.get("3/1/4") ?? subtables.get("0/3/4");
    if (format4 === undefined) throw new Error("font has no Unicode character map");
    const segments = d.readUInt16BE(format4 + 6) / 2;
    const ends = format4 + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    return (codePoint) => {
      if (codePoint > 0xffff) return 0;
      for (let i = 0; i < segments; i++) {
        if (d.readUInt16BE(ends + i * 2) < codePoint) continue;
        const start = d.readUInt16BE(starts + i * 2);
        if (start > codePoint) return 0;
        const delta = d.readUInt16BE(deltas + i * 2);
        const rangeOffset = d.readUInt16BE(rangeOffsets + i * 2);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyph = d.readUInt16BE(rangeOffsets + i * 2 + rangeOffset + (codePoint - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  }

  /** The pair-positioning subtables of the font's "kern" feature (GPOS lookup type 2). */
  private readKernLookups(): number[] {
    const gpos = this.tables.get("GPOS");
    if (gpos === undefined) return [];
    const d = this.data;
    const features = gpos + d.readUInt16BE(gpos + 6);
    const lookups = gpos + d.readUInt16BE(gpos + 8);
    const lookupIndices = new Set<number>();
    for (let i = 0; i < d.readUInt16BE(features); i++) {
      const record = features + 2 + i * 6;
      if (d.toString("latin1", record, record + 4) !== "kern") continue;
      const feature = features + d.readUInt16BE(record + 4);
      for (let j = 0; j < d.readUInt16BE(feature + 2); j++) lookupIndices.add(d.readUInt16BE(feature + 4 + j * 2));
    }
    const subtables: number[] = [];
    for (const index of [...lookupIndices].sort((x, y) => x - y)) {
      const lookup = lookups + d.readUInt16BE(lookups + 2 + index * 2);
      const type = d.readUInt16BE(lookup);
      for (let k = 0; k < d.readUInt16BE(lookup + 4); k++) {
        let subtable = lookup + d.readUInt16BE(lookup + 6 + k * 2);
        // Large fonts wrap lookups in "extension" subtables that can point further away.
        if (type === 9) {
          if (d.readUInt16BE(subtable + 2) !== 2) continue;
          subtable += d.readUInt32BE(subtable + 4);
        } else if (type !== 2) continue;
        subtables.push(subtable);
      }
    }
    return subtables;
  }

  /** Horizontal adjustment between two glyphs, in font units. */
  kerning(left: number, right: number): number {
    const key = left * 65536 + right;
    let value = this.kernCache.get(key);
    if (value === undefined) {
      value = this.findKerning(left, right);
      this.kernCache.set(key, value);
    }
    return value;
  }

  private findKerning(left: number, right: number): number {
    const d = this.data;
    for (const sub of this.kernSubtables) {
      const coverageIndex = this.coverage(sub + d.readUInt16BE(sub + 2), left);
      if (coverageIndex < 0) continue;
      const format1 = d.readUInt16BE(sub + 4);
      const format2 = d.readUInt16BE(sub + 6);
      const size1 = 2 * popcount(format1);
      const size2 = 2 * popcount(format2);
      // Only the first glyph's advance matters for horizontal kerning.
      const advanceOf = (record: number) => (format1 & 4 ? d.readInt16BE(record + 2 * popcount(format1 & 3)) : 0);
      if (d.readUInt16BE(sub) === 1) {
        const pairSet = sub + d.readUInt16BE(sub + 10 + coverageIndex * 2);
        const recordSize = 2 + size1 + size2;
        let lo = 0;
        let hi = d.readUInt16BE(pairSet) - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const record = pairSet + 2 + mid * recordSize;
          const second = d.readUInt16BE(record);
          if (second < right) lo = mid + 1;
          else if (second > right) hi = mid - 1;
          else return advanceOf(record + 2);
        }
      } else {
        const class1 = this.classOf(sub + d.readUInt16BE(sub + 8), left);
        const class2 = this.classOf(sub + d.readUInt16BE(sub + 10), right);
        const class2Count = d.readUInt16BE(sub + 14);
        return advanceOf(sub + 16 + (class1 * class2Count + class2) * (size1 + size2));
      }
    }
    return 0;
  }

  private coverage(table: number, glyph: number): number {
    const d = this.data;
    const count = d.readUInt16BE(table + 2);
    if (d.readUInt16BE(table) === 1) {
      let lo = 0;
      let hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const value = d.readUInt16BE(table + 4 + mid * 2);
        if (value < glyph) lo = mid + 1;
        else if (value > glyph) hi = mid - 1;
        else return mid;
      }
      return -1;
    }
    for (let i = 0; i < count; i++) {
      const range = table + 4 + i * 6;
      if (glyph >= d.readUInt16BE(range) && glyph <= d.readUInt16BE(range + 2)) {
        return d.readUInt16BE(range + 4) + glyph - d.readUInt16BE(range);
      }
    }
    return -1;
  }

  private classOf(table: number, glyph: number): number {
    const d = this.data;
    if (d.readUInt16BE(table) === 1) {
      const first = d.readUInt16BE(table + 2);
      const index = glyph - first;
      return index >= 0 && index < d.readUInt16BE(table + 4) ? d.readUInt16BE(table + 6 + index * 2) : 0;
    }
    for (let i = 0; i < d.readUInt16BE(table + 2); i++) {
      const range = table + 4 + i * 6;
      if (glyph >= d.readUInt16BE(range) && glyph <= d.readUInt16BE(range + 2)) return d.readUInt16BE(range + 4);
    }
    return 0;
  }
}

function popcount(n: number): number {
  let count = 0;
  for (let v = n; v; v &= v - 1) count++;
  return count;
}
