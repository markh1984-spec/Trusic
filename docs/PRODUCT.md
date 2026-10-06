# Trusic: product rules

Trusic is a music streaming platform for real bands and musicians to earn real money. AI music is allowed, but it
is always labelled and paid less, or nothing, and what it gives up goes to people.

This document is the source of truth for the rules. The code that implements them is in `packages/core`.

## 1. Where the money goes

1. **80/20.** Of all net revenue (after VAT, payment fees and app-store fees), 20% goes to Trusic and 80% to
   artists.
2. **User-centric.** A listener's 80% is shared only between the tracks _that listener_ played, in proportion to
   how often they played them. Listening to a track for **30 seconds** or more counts as a stream.
3. **Human-weighted.** Within a listener's money, each stream is weighted by **(100 − AI score)**:
   - AI score 0 earns the full rate.
   - AI score 25 earns 75% of what a human track gets per stream.
   - AI score 100 earns nothing.

   What AI-scored tracks give up goes to the human-made tracks the same listener played.

4. **The human pot.** If a paying listener played nothing, or only fully AI-generated tracks, their 80% goes into
   a platform-wide pot for human music. The pot is shared by human-weighted streams across everyone (free
   listeners' streams count towards the split). Revenue that can't be tied to a listener goes there too. If a whole
   month has no human streams, the pot carries over to the next month, so it is never kept by Trusic.
5. **Band splits.** Each track's money is divided between its payees by percentages they set (default: 100% to
   the uploader). Everyone in a split needs a Trusic account.
6. **Every penny is accounted for.** All amounts are whole pence, split with the largest-remainder method.
   Trusic's share + artist payouts + carried-over pot always equals revenue exactly, and the engine refuses to
   produce a result where it doesn't.

### Worked example

One listener pays £10,000 (to keep the numbers round). £2,000 goes to Trusic and £8,000 to artists.

| Track              | Streams | AI score | Without AI weighting | Paid      |
| ------------------ | ------- | -------- | -------------------- | --------- |
| Human band         | 5,000   | 0        | £4,000               | £5,405.41 |
| Band using some AI | 3,000   | 20       | £2,400               | £2,594.59 |
| Prompt-generated   | 2,000   | 100      | £1,600               | £0.00     |

The hybrid band still earns exactly 80% of the human band's per-stream rate, as its score says. It earns more
than its "without AI weighting" figure because it also gets a share of the prompt-generated track's £1,600. This
example is a test in `packages/core/src/payouts.test.ts`.

## 2. The AI score

The score measures **AI doing the creative work**. AI engineering tools are welcome and never change the score:
mastering, mixing assistants, stem separation, noise removal/restoration, pitch correction and transcription.
Artists can list them, and listeners can see them.

### Rubric (version 2026-10)

| Part of the track           | Weight | AI-assisted (25%) | AI-generated (100%) |
| --------------------------- | ------ | ----------------- | ------------------- |
| Songwriting & composition   | 30     | +7.5              | +30                 |
| Lyrics                      | 15     | +3.75             | +15                 |
| Vocals (incl. voice clones) | 25     | +6.25             | +25                 |
| Instruments & performance   | 25     | +6.25             | +25                 |
| Arrangement & sound design  | 5      | +1.25             | +5                  |

- **AI-assisted:** a person did the work; AI suggested ideas or helped with parts.
- **AI-generated:** AI produced it, for example from a prompt.
- **Doesn't apply:** the part isn't in the track (e.g. vocals on an instrumental). Its weight is spread over the
  other parts, so a fully generated instrumental still scores 100.

Examples: a band playing its own song, mastered with LANDR, scores **0**. A human song sung by an AI voice model
scores **25**. Human lyrics on a Suno-generated track score **85**. A Suno track scores **100**.

### Labels

| Score  | Label        |
| ------ | ------------ |
| 0–9    | Human-made   |
| 10–69  | AI-assisted  |
| 70–100 | AI-generated |

The exact score is always shown next to the label.

### How a track's score is set

1. **Declare.** At upload, the artist says how much AI went into each part. This gives the declared score.
2. **Detect.** Automated detection runs on every upload. It can only **raise** the score, never lower it, and only
   when it is at least 90% confident and finds more than 10 points of extra AI. A raised track is flagged.
3. **Appeal.** The artist can ask for a human review. A reviewer's decision overrides both. Admins can also
   re-score any track after an audit or a report.

Today's detector only reads file metadata (generators like Suno sometimes leave their name in the tags). It
catches careless uploads but is trivially evaded. A real audio-analysis detector is a launch requirement (see the
roadmap). Even the best detectors can't reliably see _partial_ AI use, so for scores between 0 and 100 the
artist's declaration will remain the main evidence; see [research/ai-detection.md](research/ai-detection.md).

## 3. Decisions log

| Date       | Decision                                                                                                                             | Why                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-06 | 80% artists / 20% platform, applied to net revenue.                                                                                  | Founder's model.                                                                                                                           |
| 2026-10-06 | AI forfeits are redistributed human-weighted, not only to score-0 artists.                                                           | No cliff edge: an artist with score 1 shouldn't lose all redistribution compared with score 0. Every track earns exactly its score's rate. |
| 2026-10-06 | User-centric payouts rather than Spotify-style pro-rata.                                                                             | Fairer to indie artists, much harder to game with stream farms, and suits a transparency brand.                                            |
| 2026-10-06 | Score = declare + detect (raise only) + human appeal.                                                                                | Partial AI use can't be reliably detected from audio alone, and false positives shouldn't silently cut a human artist's pay.               |
| 2026-10-06 | AI mastering and other engineering tools never affect the score.                                                                     | "What we're eliminating is the entire song being someone typing prompts."                                                                  |
| 2026-10-06 | A listener's AI forfeits go to the human tracks _that listener_ played; only AI-only listeners' money goes to the platform-wide pot. | Keeps the user-centric promise: your money only reaches artists you listened to, unless none of them were human.                           |
| 2026-10-06 | Payouts use each track's score at the time the month is calculated.                                                                  | Simple for now. To revisit before real payouts (see open questions).                                                                       |
| 2026-10-06 | The score is per track. Artist pages show how many of their tracks are human-made.                                                   | Bands may use AI on one song and not others.                                                                                               |

## 4. Open questions

These need a decision from the founder. The current behaviour is in brackets.

1. **Rubric weights and labels.** Are the weights right? For example, a song with human lyrics and vocals but an
   AI-generated melody and backing scores 55 and is labelled "AI-assisted". Should it be higher? [weights above]
2. **"AI-assisted" penalty.** AI-assisted lyrics cost 4 points (4% less per stream). Should light assistance be
   free? [25% of the part's weight]
3. **Penalties for lying.** If detection or an audit finds a track was under-declared, should there be more than
   the higher score: strikes, clawing back past earnings, bans? [higher score only]
4. **Fully AI tracks.** Allowed, labelled, earn nothing. Should they also be hidden from default recommendations,
   or have their own section? [shown like any other track]
5. **Free tier.** Ad-supported free listening, Premium only, or a limited free tier? The engine supports ad
   revenue per listener already. [free listening with no ads; free streams only steer the human pot]
6. **Price and market.** UK-first in GBP at £10.99/month? [GBP, £10.99 incl. VAT]
7. **Score changes mid-month.** If an appeal changes a track's score on the 20th, should earlier streams use the
   old score? [the score at calculation time applies to the whole month. Each play now records the score it was
   played at, so switching to "score at play time" is a small change once decided]
8. **Who can upload.** Direct uploads from artists only, or also deliveries from distributors (DistroKid, CD Baby…)
   and labels? [direct uploads only]
9. **Minimum payout and payment rails.** How and when do artists get paid out, with what minimum? [not built yet]
10. **What "80% to artists" covers.** Songwriting royalties (PRS for Music, about 16% of revenue on its small-service
    licence) are normally paid out of the music makers' share. Does "80%" mean recording artists only (Trusic keeps
    about 4%), recording plus songwriting (recording artists get about 64%), or 80/20 of what's left after
    songwriters (67% / 17%)? See [research/uk-licensing.md](research/uk-licensing.md). [not modelled yet: the engine
    pays 80% to recording payees]
11. **How confident detection must be.** The research suggests only raising scores automatically when two signals
    agree that a whole track is generated, and sending partial-AI signals to a person. Adopt that? See
    [research/ai-detection.md](research/ai-detection.md). [one confident signal is enough]

## 5. Research

- [Detecting AI-generated music](research/ai-detection.md): what detection can and can't do, vendors to trial, an
  evaluation plan, and what other platforms do.
- [Licensing and legal obligations in the UK](research/uk-licensing.md): recording versus songwriting rights, PRS for
  Music, how songwriting royalties affect the 80/20 split, platform liability, online safety and AI labelling.

Both were compiled from web searches on 6 October 2026. Several primary sources couldn't be opened directly, so
figures marked unverified must be checked before they go into a financial model.
