import { runFfmpeg, type Ffmpeg } from "./ffmpeg";

/**
 * How uploads are prepared for streaming.
 *
 * AAC in an .m4a file plays everywhere Trusic runs: Safari and iPhones, Chrome, Android and the desktop app. At
 * 160 kbps a minute is about 1.2 MB, against about 10 MB for a WAV, so free hosting's 5 GB a month goes much further.
 */
export const STREAM_BITRATE = "160k";
export const STREAM_MIME = "audio/mp4";

/**
 * Loudness: tracks are measured with the EBU R128 meter and turned up or down towards −14 LUFS, as Spotify and
 * YouTube do, so one track isn't much louder than the next. Nothing is compressed or limited: a quiet track is only
 * turned up as far as its loudest moment allows (a true peak of −1.5 dB, leaving room for the encoder), so its
 * dynamics are left as the artist made them.
 */
export const TARGET_LUFS = -14;
export const PEAK_CEILING_DB = -1.5;
const MAX_BOOST_DB = 20;
/** The meter's floor: anything this quiet is silence, and is left alone. */
const SILENCE_LUFS = -70;

export interface AudioAnalysis {
  /** Integrated loudness, LUFS. Null if it couldn't be measured. */
  integratedLufs: number | null;
  /** True peak, dBTP. */
  truePeakDb: number | null;
  sampleRate: number | null;
}

/** First pass: measure the whole file. */
export async function analyseAudio(
  ffmpeg: Ffmpeg,
  input: string,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<AudioAnalysis> {
  // A mono upload is measured as mono: ffmpeg spreads it over both stereo channels at −3 dB each, which sounds
  // the same.
  const log = await runFfmpeg(
    ffmpeg,
    ["-nostats", "-i", input, "-map", "0:a:0", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
    options,
  );
  return parseAnalysis(log);
}

export function parseAnalysis(log: string): AudioAnalysis {
  const summary = log.slice(log.lastIndexOf("Summary:"));
  const value = (re: RegExp) => {
    const n = Number(re.exec(summary)?.[1]);
    return Number.isFinite(n) ? n : null;
  };
  const rate = Number(/Stream #0:\d+[^\n]*: Audio: [^\n]*?(\d+) Hz/.exec(log)?.[1]);
  return {
    integratedLufs: value(/\bI:\s+(-?[\d.]+) LUFS/),
    truePeakDb: value(/\bPeak:\s+(-?[\d.]+) dBFS/),
    sampleRate: Number.isFinite(rate) && rate > 0 ? rate : null,
  };
}

/** How many dB to turn a track up (positive) or down to reach the target without its peak going over the ceiling. */
export function normalisingGain({ integratedLufs, truePeakDb }: AudioAnalysis): number {
  if (integratedLufs === null || integratedLufs <= SILENCE_LUFS) return 0;
  let gain = TARGET_LUFS - integratedLufs;
  if (truePeakDb !== null) gain = Math.min(gain, PEAK_CEILING_DB - truePeakDb);
  return Math.round(Math.min(gain, MAX_BOOST_DB) * 10) / 10;
}

/**
 * Second pass: apply the gain and write the streaming file, plus, if `preview` is given, a separate file of the first
 * `previewSeconds` with a short fade at the end. Both in one run, so the upload is only decoded once.
 */
export async function encodeAudio(
  ffmpeg: Ffmpeg,
  input: string,
  options: {
    gainDb: number;
    sampleRate: number | null;
    full: string;
    preview: string | null;
    previewSeconds: number;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  // Keep 48 kHz material at 48 kHz; everything else (44.1 kHz, and anything lower) becomes 44.1 kHz.
  const rate = options.sampleRate && options.sampleRate % 48_000 === 0 ? 48_000 : 44_100;
  const fadeAt = Math.max(0, options.previewSeconds - 2);
  const graph = options.preview
    ? `[0:a:0]volume=${options.gainDb}dB,aresample=${rate},asplit=2[full][pre];` +
      `[pre]atrim=0:${options.previewSeconds},afade=t=out:st=${fadeAt}:d=2[preview]`
    : `[0:a:0]volume=${options.gainDb}dB,aresample=${rate}[full]`;
  // Stereo AAC with no tags, and the index at the front of the file so playback and seeking start straight away.
  const aac = (out: string) => [
    ...["-c:a", "aac", "-b:a", STREAM_BITRATE, "-ac", "2", "-map_metadata", "-1"],
    ...["-movflags", "+faststart", "-f", "mp4", out],
  ];
  await runFfmpeg(
    ffmpeg,
    [
      ...["-i", input, "-filter_complex", graph, "-map", "[full]", ...aac(options.full)],
      ...(options.preview ? ["-map", "[preview]", ...aac(options.preview)] : []),
    ],
    options,
  );
}
