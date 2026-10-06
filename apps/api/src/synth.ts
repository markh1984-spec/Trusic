/**
 * A tiny WAV synthesiser for tests and demo data, so the repo needs no audio files.
 * Not used by the running service.
 */

export interface SynthOptions {
  seconds: number;
  sampleRate?: number;
  /** Changes the melody, so demo tracks don't all sound the same. */
  seed?: number;
  bpm?: number;
  /** Written to the RIFF INFO comment (ICMT) and software (ISFT) tags. */
  comment?: string;
  software?: string;
}

const SCALES = [
  [0, 2, 4, 7, 9], // major pentatonic
  [0, 3, 5, 7, 10], // minor pentatonic
  [0, 2, 3, 5, 7, 8, 10], // natural minor
  [0, 2, 4, 5, 7, 9, 11], // major
];

export function synthWav(options: SynthOptions): Buffer {
  const sampleRate = options.sampleRate ?? 22_050;
  const total = Math.floor(options.seconds * sampleRate);
  let seed = (options.seed ?? 1) * 7919 + 17;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;

  const scale = SCALES[Math.floor(rand() * SCALES.length)]!;
  const root = 48 + Math.floor(rand() * 12);
  const bpm = options.bpm ?? 84 + Math.floor(rand() * 50);
  const beat = Math.floor((60 / bpm) * sampleRate);
  const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  const progression = [0, 3, 4, 2].map((d) => (d + Math.floor(rand() * 2)) % scale.length);

  const samples = new Int16Array(total);
  let melodyNote = root + 12;
  for (let start = 0, step = 0; start < total; start += beat / 2, step++) {
    if (rand() < 0.75) {
      const degree = Math.floor(rand() * scale.length);
      melodyNote = root + 12 + scale[degree]! + (rand() < 0.2 ? 12 : 0);
      addTone(samples, sampleRate, start, beat * (rand() < 0.3 ? 1 : 0.5), freq(melodyNote), 0.22);
    }
    if (step % 8 === 0) {
      const chordRoot = root + scale[progression[(step / 8) % progression.length]!]!;
      for (const interval of [0, 4, 7]) addTone(samples, sampleRate, start, beat * 4, freq(chordRoot + interval), 0.08);
      addTone(samples, sampleRate, start, beat * 2, freq(chordRoot - 12), 0.18);
    }
  }
  // Fade in and out.
  const fade = Math.min(sampleRate, total / 4);
  for (let i = 0; i < fade; i++) {
    samples[i] = Math.round(samples[i]! * (i / fade));
    samples[total - 1 - i] = Math.round(samples[total - 1 - i]! * (i / fade));
  }
  return encodeWav(samples, sampleRate, { ICMT: options.comment, ISFT: options.software });
}

function addTone(out: Int16Array, sampleRate: number, start: number, length: number, hz: number, gain: number) {
  const end = Math.min(out.length, Math.floor(start + length));
  for (let i = Math.floor(start); i < end; i++) {
    const t = (i - start) / sampleRate;
    const envelope = Math.min(1, t * 80) * Math.exp(-3 * t);
    const v = Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t);
    out[i] = clamp16(out[i]! + v * envelope * gain * 32767);
  }
}

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

function encodeWav(samples: Int16Array, sampleRate: number, info: Record<string, string | undefined>): Buffer {
  const infoEntries = Object.entries(info).filter((e): e is [string, string] => Boolean(e[1]));
  const infoChunks = infoEntries.map(([id, text]) => {
    const body = Buffer.from(`${text}\0`, "latin1");
    const padded = body.length % 2 ? Buffer.concat([body, Buffer.alloc(1)]) : body;
    const header = Buffer.alloc(8);
    header.write(id, 0, "ascii");
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, padded]);
  });
  const list = infoChunks.length
    ? (() => {
        const content = Buffer.concat([Buffer.from("INFO", "ascii"), ...infoChunks]);
        const header = Buffer.alloc(8);
        header.write("LIST", 0, "ascii");
        header.writeUInt32LE(content.length, 4);
        return Buffer.concat([header, content]);
      })()
    : Buffer.alloc(0);

  const dataBytes = samples.length * 2;
  const header = Buffer.alloc(36);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + 24 + list.length + 8 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(dataBytes, 4);
  return Buffer.concat([header, list, dataHeader, Buffer.from(samples.buffer, samples.byteOffset, dataBytes)]);
}
