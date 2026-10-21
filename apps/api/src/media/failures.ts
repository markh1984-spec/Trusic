/**
 * What went wrong with an upload, in words an artist can act on. The converter's own message (kept on the job, for
 * the logs and admins) is technical; this picks out the few kinds of failure worth telling apart.
 */
const REASONS: [RegExp, string][] = [
  [/took longer than/i, "Converting it took too long. That can happen with very long files, or when Trusic is busy."],
  [
    /no space left|ENOSPC/i,
    "Trusic ran out of storage space while converting it. That's our problem, not your file's.",
  ],
  [
    /exit null|SIGKILL|cannot allocate memory|out of memory/i,
    "Trusic ran out of memory while converting it. That's our problem, not your file's.",
  ],
  [/ENOENT|NoSuchKey|: 404\b/i, "We couldn't find the file you uploaded."],
  [
    /timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|: 5\d\d\b/i,
    "Trusic couldn't reach the place it keeps files. That's our problem, not your file's.",
  ],
  [
    /invalid data|could not find codec|moov atom|error while decoding|does not contain any stream|matches no streams|invalid argument|header missing|unknown format/i,
    "The file looks damaged, or it's in a form we can't read.",
  ],
];

const SOMETHING = "Something went wrong while converting it.";

export function failureReason(error: string | null): string {
  if (!error) return SOMETHING;
  return REASONS.find(([pattern]) => pattern.test(error))?.[1] ?? SOMETHING;
}

/** The whole message for Studio: why, and what to do next. */
export function failureMessage(error: string | null, canRetry: boolean): string {
  const again = canRetry
    ? "Try again, or export it again as WAV, FLAC or MP3 and upload that."
    : "Export it again as WAV, FLAC or MP3, then upload it again.";
  return `We couldn't prepare this file for streaming. ${failureReason(error)} ${again}`;
}
