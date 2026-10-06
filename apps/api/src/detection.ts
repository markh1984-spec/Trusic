import type { DetectionResult } from "@trusic/core";
import type { IAudioMetadata } from "music-metadata";

/**
 * Automated AI-music detection. It can only ever raise a track's score (see
 * resolveAiScore in @trusic/core), and artists can appeal its findings.
 *
 * The production plan is a real audio-analysis model (a vendor API or our own)
 * behind this interface. Until then, MetadataDetector catches files that still
 * carry the generator's fingerprints in their tags.
 */
export interface AiDetector {
  readonly name: string;
  analyze(input: { filePath: string; metadata: IAudioMetadata }): Promise<DetectionResult>;
}

const GENERATOR_NAMES = [
  "suno",
  "udio",
  "boomy",
  "mubert",
  "soundraw",
  "aiva",
  "riffusion",
  "musicgen",
  "stable audio",
  "soundful",
  "beatoven",
];

/**
 * Creative tags (title, artist, lyrics...) are skipped: a human song can be called
 * "Suno" (Hindi for "listen"). Generators leave their marks in comments, encoder
 * and URL tags instead.
 */
const CREATIVE_TAG_IDS = new Set(
  [
    // ID3
    "TIT1", "TIT2", "TIT3", "TPE1", "TPE2", "TPE3", "TPE4", "TALB", "TCON", "USLT", "SYLT", "TCOM", "TEXT",
    // Vorbis / FLAC
    "TITLE", "ARTIST", "ALBUM", "ALBUMARTIST", "GENRE", "LYRICS", "COMPOSER", "PERFORMER",
    // iTunes / MP4
    "©nam", "©ART", "aART", "©alb", "©gen", "©lyr", "©wrt",
    // RIFF INFO
    "INAM", "IART", "IPRD", "IGNR",
  ].map((id) => id.toUpperCase()),
);

/** Looks for AI music generators named in the file's technical tags. Easy to evade by stripping tags. */
export class MetadataDetector implements AiDetector {
  readonly name = "metadata-v1";

  async analyze({ metadata }: { metadata: IAudioMetadata }): Promise<DetectionResult> {
    const evidence: string[] = [];
    for (const [format, tags] of Object.entries(metadata.native ?? {})) {
      for (const tag of tags) {
        if (CREATIVE_TAG_IDS.has(tag.id.toUpperCase())) continue;
        const text = tagText(tag.value).toLowerCase();
        const hit = GENERATOR_NAMES.find((g) => new RegExp(`\\b${g}\\b`).test(text));
        if (hit) evidence.push(`${format} tag ${tag.id} mentions "${hit}"`);
      }
    }
    if (evidence.length > 0) {
      return { detector: this.name, verdict: "likely_ai", confidence: 0.95, estimatedScore: 100, evidence };
    }
    return { detector: this.name, verdict: "inconclusive", confidence: 0, evidence: [] };
  }
}

function tagText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(tagText).join(" ");
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    return Object.values(value).map(tagText).join(" ");
  }
  return "";
}
