# Detecting AI-generated music

Research note for the founder. Compiled 6 October 2026.

**How this was researched.** Web searches only. The research environment could not open several primary pages
directly (Deezer's newsroom, arXiv, Music Business Worldwide and others were blocked). For those, figures come from
search-engine summaries of the pages, and the URL is given so you can check the original. Treat every vendor
accuracy figure as a **claim made by the vendor**, not an independent measurement, unless it says otherwise.

## Summary for the founder

- **Fully generated tracks from the big generators are now fairly easy to catch.** Deezer says its detector is 99.8%
  accurate and wrongly flags fewer than 1 in 10,000 human tracks. IRCAM Amplify claims 99% with under 1% false
  positives. Neither figure has been independently audited.
- **Independent tests are much less flattering.** Detectors break when audio is pitch-shifted, sped up, resampled or
  re-encoded, and when a new generator version comes out. One September 2026 benchmark found Deezer's _publicly
  released research model_ fell to about 78% balanced accuracy on unfamiliar material. (This is not necessarily the
  same as Deezer's commercial tool.)
- **Partial AI use is the hard part, and it is exactly what Trusic's score measures.** Detecting an AI vocal over a
  human band, or an AI backing track under a human singer, is a 2026 research topic, not a solved product. AI-assisted
  lyrics, and AI-written melodies played by real musicians, cannot be reliably detected from the audio at all.
- **Watermarks are arriving and are cheap, strong evidence when present.** Google watermarks Lyria music, Udio
  registers its output with Audible Magic, Suno said in August 2026 it would start watermarking, and the EU AI Act now
  requires generators to mark their output. But no watermark proves nothing.
- **Trusic's design (declare, detect to raise only, human appeal) fits the technology well.** Detection should be
  a safety net for careless or dishonest uploads, not the main source of the score.
- **Trial three detectors:** Deezer's licensable detector, IRCAM Amplify, and ACRCloud (which separately checks vocals
  and accompaniment and appears to have the most transparent pricing). Add free checks for metadata, C2PA
  provenance and watermarks.
- **Set the threshold from your own test data, not from the vendor's "confidence" number.** In version 1, only
  automatically raise a score for a full-track "fully generated" verdict that two signals agree on. Send partial-AI
  signals to a human reviewer instead.
- **Positioning:** Deezer, Qobuz and Tidal detect fully AI tracks and limit or remove their pay; Spotify and Apple
  label only what uploaders declare; Bandcamp bans AI music. No platform found pays on a **sliding scale by how much
  AI was used**. That is Trusic's distinctive idea, and also the hardest thing to verify.

## 1. The four ways to detect AI music

There are four families of technique. They answer different questions, so a real system combines them.

| Approach                                                                                                                                                                 | How it works                                                                                            | What it catches                                                                 | What it misses                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Audio classifier** (a model trained to sort audio into "human" and "AI")                                                                                               | Looks for tiny traces generators leave in the sound, or for musical patterns typical of generated songs | Unedited output of generators it was trained on                                 | New generators, edited or degraded audio, AI used only for the songwriting     |
| **Watermark** (an inaudible signal the generator hides in its output)                                                                                                    | The generator embeds a code; a matching detector reads it back                                          | Output of that one generator, often even after compression                      | Every generator that doesn't watermark; watermarks that have been stripped     |
| **Provenance metadata** (signed records of how a file was made, such as C2PA "Content Credentials", or AI-disclosure fields in DDEX, the music industry's data standard) | Tools attach a record to the file or its delivery data                                                  | Honest uploads from tools that write these records                              | Anything where the record was never added or was removed (it is easy to strip) |
| **Fingerprint matching** (a compact "audio fingerprint" compared with a database of known recordings)                                                                    | Matches a new upload against registered recordings                                                      | Re-uploads of known tracks, including tracks a generator registered at creation | New AI tracks that nobody registered                                           |

### Audio classifiers

Most commercial detectors are classifiers that look for **artefacts**: tiny, inaudible patterns left by the part of
the generator that turns its internal data into sound. Deezer says its tool works this way, and that because the
artefacts differ between generators it can also say _which_ generator was used ([Deezer
detector page](https://www.deezer.com/explore/en-us/ai-music-detector/)). Deezer's researchers published a
mathematical explanation in 2025: the "upsampling" layers in many generators leave small, regular spikes in the
frequency spectrum, and these depend on the model's design rather than its training
([Afchar et al., ISMIR 2025](https://arxiv.org/abs/2506.19108)).

The strength of artefact detection is that it is very accurate on clean output. The weakness is that the artefacts
are fragile (see section 4). Newer research tries to look at **musical content** instead (vocal style, structure,
effects), which should generalise better to unseen generators
([Han et al., June 2026](https://arxiv.org/abs/2606.16612)).

A separate line of work transcribes the lyrics with speech recognition and runs AI-text detection on them. Deezer
Research found this was more robust to audio edits and to unseen generators than audio-only detectors
([Frohmann et al., ISMIR 2025](https://arxiv.org/abs/2506.18488)). Note that this was tested on fully generated
songs, not on human songs with AI-assisted lyrics.

### Watermarks

- **Google SynthID:** every track from Lyria 3 in the Gemini app carries a SynthID watermark, which Google says
  survives noise, MP3 compression and speed changes. Google's SynthID Detector portal is limited to early testers on
  a waitlist; the Gemini app can check uploaded audio
  ([CineD](https://www.cined.com/google-lyria-3-launches-in-gemini-ai-music-generation-with-lyrics-style-control-and-synthid-watermarking/),
  [Google](https://blog.google/innovation-and-ai/products/google-synthid-ai-content-detector/)).
- **Suno:** in August 2026, under legal pressure, Suno said it would roll out watermarking and fingerprinting "in
  the coming weeks", cap downloads, and use Musixmatch's Sentinel copyright checks
  ([TechCrunch](https://techcrunch.com/2026/08/06/amid-legal-battles-suno-says-it-will-start-watermarking-songs/)).
  I could not confirm whether it has shipped, or how other platforms will be able to read it.
- **Open research watermarks** vary a lot in strength. A NeurIPS 2024 benchmark found Meta's AudioSeal the most robust
  of three tested, while WavMark could be removed by adding noise or MP3 compression
  ([AudioMarkBench](https://proceedings.neurips.cc/paper_files/paper/2024/file/5d9b7775296a641a1913ab6b4425d5e8-Paper-Datasets_and_Benchmarks_Track.pdf)).
- **Regulation:** from 2 August 2026 the EU AI Act requires providers of generative AI to mark output in a
  machine-readable way (with a grace period to 2 December 2026 for systems already on the market). See
  [uk-licensing.md](uk-licensing.md) for details. This should make watermarks more common, but only from generators
  that follow EU law.

A watermark tells you that a generator was used **somewhere** in the file. It does not say how much. A human vocal over
a Suno backing track would still carry Suno's watermark.

### Provenance metadata

C2PA Content Credentials now support common audio formats including MP3, WAV and AIFF
([C2PA specification 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)).
On the music-industry side, Spotify's "AI credits" use a new DDEX AI-disclosure standard, filled in by the uploader
through their distributor ([Digital Music News](https://www.digitalmusicnews.com/2026/04/22/spotify-tests-ai-credit-labels-distrokid/)).
Both are useful for honest uploaders and useless against dishonest ones. Trusic's existing tag check is in this
family.

### Fingerprint matching

Fingerprinting (Audible Magic, Pex, ACRCloud, YouTube's Content ID) is built to spot copies of known recordings, which
Trusic needs anyway for copyright. It becomes an AI detector when a generator registers everything it makes. Udio
agreed in April 2025 to fingerprint every output with Audible Magic, so distributors and streaming services can tell
which tracks were made with Udio
([Audible Magic](https://www.audiblemagic.com/2025/04/30/udio-partners-with-audible-magic-to-fingerprint-ai-generated-tracks-and-to-check-for-infringements/)).

### Partial AI use, part by part

This table maps the rubric in `PRODUCT.md` to what detection can realistically do today.

| Rubric part                    | Can audio detection catch it?                                                                                                                        | Best evidence available                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Songwriting and composition    | **No**, if humans perform it. An AI-written melody played by a real band leaves no audio artefacts                                                   | Artist declaration; possibly a watermark if a generated demo was uploaded as-is |
| Lyrics                         | **Not reliably.** Lyrics detection works on fully generated songs, but AI-text detectors are notoriously unreliable on human writing (see section 4) | Declaration                                                                     |
| Vocals, including voice clones | **Partly.** Research and some products separate vocals and check them. Singing-voice deepfake detection exists as a research field                   | Stem-level detection; voice identification (Pex) for clones of known singers    |
| Instruments and performance    | **Partly.** Drums and guitar seem easier to spot than bass                                                                                           | Stem-level detection                                                            |
| Arrangement and sound design   | **No**                                                                                                                                               | Declaration                                                                     |

Research on "hybrid" tracks started in earnest in 2026:

- Deezer Research found that separating a mix into stems and then running a detector does **not** reliably recover
  the AI traces, and proposed a different design with "encouraging" results
  ([Rigaud et al., ISMIR 2026](https://arxiv.org/abs/2607.26874)).
- A Universitat Pompeu Fabra and BMAT study estimated the _share_ of AI in a mix, with an average error of about 7.6
  percentage points on test mixes built the same way as its training data. Drums and guitar were easiest to detect;
  vocals and bass were hardest ([Garcia de la Cruz et al., ISMIR 2026](https://arxiv.org/abs/2608.07285);
  [BMAT summary](https://www.bmat.com/ai-music-detection-how-much-ai-in-a-track/)).
- An NYU and Deezer paper did well on vocals, drums and guitar but struggled with bass, and named source separation as
  the main bottleneck ([Namballa et al., submitted to ICASSP 2027](https://arxiv.org/abs/2609.26956)).

Note that the papers disagree on vocals. All of them simulate hybrids in the lab, so expect lower accuracy on real
uploads.

## 2. Services you can buy

| Service                                                                 | What it detects                                                                                                                                                                                                                | Published accuracy and how measured                                                                                                                                                                                 | Integration                                                                                                                    | Price                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deezer AI detection** (licensed since January 2026)                   | Fully generated tracks; names the generator (Suno, Udio and others it has examples of)                                                                                                                                         | 99.8% accuracy; misses about 2 in 1,000 AI tracks; flags fewer than 1 in 10,000 human tracks. Deezer's own figures; method not published                                                                            | Commercial licence; details on request ([Deezer for business](https://business.deezer.com/ai-detection/))                      | Not public; "varies based on the type of deal" ([Rappler/Reuters](https://www.rappler.com/technology/deezer-artificial-intelligence-music-detection-tool-france-sacem-license/)) |
| **IRCAM Amplify** AI Music Detector                                     | Fully generated tracks from Suno, Udio, Sonauto, ElevenLabs and others                                                                                                                                                         | 98.5% at launch in May 2024 ([Music Ally](https://musically.com/2024/05/02/ircam-amplify-launches-a-tool-to-detect-ai-generated-music/)); now claims 99% with under 1% false positives. Vendor's internal test sets | REST API returning a probability ([demo code](https://github.com/Ircam-Amplify/AI-MUSIC-DETECTOR))                             | Not public; sales enquiry                                                                                                                                                        |
| **ACRCloud** AI Music Detector                                          | Full track **and vocals and accompaniment separately**; names the generator (lists Suno, Udio, ElevenLabs, Seed Music, MiniMax, Mureka, Riffusion, Lyria and others) ([ACRCloud](https://www.acrcloud.com/ai-music-detector/)) | I found no figure published by ACRCloud itself                                                                                                                                                                      | API and bulk file scanning ([docs](https://docs.acrcloud.com/reference/console-api/file-scanning/metadata/ai-music-detection)) | A third-party review reports about US$32 per 10,000 requests after a 14-day trial ([fast.io](https://fast.io/resources/ai-music-detector-tools-2026/)). **Unverified**           |
| **Vobile AI Song Detector** (built by Pex, which Vobile bought in 2025) | Fully generated songs; names the generator. Pex also identifies singers' voices for clone detection ([Pex](https://pex.com/blog/keeping-it-real-how-pex-identifies-ai-generated-voices-in-music/))                             | Claims to beat competitors "by every metric" on a mixed test set; no numbers found ([Pex](https://pex.com/blog/vobile-launches-ai-song-detector-for-streaming-platforms-distributors-and-collection-societies/))    | API with JSON response                                                                                                         | Not public                                                                                                                                                                       |
| **Hive** AI-generated music detection                                   | Whether the music, and separately the vocals, are AI-generated, in 10-second chunks with 0 to 1 confidence scores ([Hive docs](https://docs.thehive.ai/reference/ai-generated-music-detection-1))                              | None found                                                                                                                                                                                                          | API                                                                                                                            | Not found                                                                                                                                                                        |
| **Believe AI Radar** (in-house at Believe/TuneCore)                     | AI masters and "deep fakes"                                                                                                                                                                                                    | 98% on AI masters and about 93% on deep fakes (2023) ([MBW](https://www.musicbusinessworldwide.com/believe-has-developed-its-own-ai-made-music-detector-with-98-accuracy-what-might-this-mean-for-the-future1/))    | Not offered to third parties as far as I could find                                                                            | n/a                                                                                                                                                                              |
| **SubmitHub AI Song Checker**                                           | Version 4.0 (23 September 2026) scores vocals and instrumental separately and returns human, hybrid or AI                                                                                                                      | Says 499 of 500 human tracks were called correctly in its own test, and that results get "a lot muddier" with edited stems ([SubmitHub](https://www.submithub.com/story/ai-song-checker-v4-0))                      | Web tool; I found no API                                                                                                       | Free, rate-limited                                                                                                                                                               |
| **Audible Magic**                                                       | Fingerprints, including Udio's registry of generated tracks                                                                                                                                                                    | n/a (matching, not classifying)                                                                                                                                                                                     | API                                                                                                                            | Not public                                                                                                                                                                       |

Others are worth knowing about but are not AI detectors in Trusic's sense. Musixmatch Sentinel spots copyrighted
lyrics in prompts and output ([MBW](https://www.musicbusinessworldwide.com/musixmatch-launches-sentinel-service-to-detect-when-copyrighted-music-and-lyrics-are-used-in-ai-and-user-generated-content/)).
SoundPatrol and Vermillio work on spotting existing songs inside AI output
([RouteNote](https://routenote.com/blog/can-we-finally-detect-copyrighted-works-in-ai-music-umg-and-sony-join-forces-with-soundpatrol/)).
Modulate lists an AI music detection API at US$0.07 per hour of audio
([Modulate](https://www.modulate.ai/api/ai-music-detection)); I found no accuracy data for it.

**Who already uses what:** Deezer licensed its detector to the French collecting society Sacem in January 2026, and
Hungary's EJI took it in March 2026
([MarketScreener](https://www.marketscreener.com/news/deezer-signs-groundbreaking-agreement-with-sacem-to-detect-ai-generated-music-ce7e5bdfda8df224),
[iMusician](https://imusician.pro/en/resources/blog/deezer-ai-music-policy)). Tidal uses an unnamed "external
detection partner" ([Variety](https://variety.com/2026/music/news/tidal-label-ai-generated-music-ban-royalties-from-ai-songs-1236798543/)).

## 3. Open-source and academic detectors

These are free to study and could be run on Trusic's own servers, but they are research code. Check each licence
before commercial use; I did not verify the licences.

| Model or dataset                                                        | What it is                                                                          | Key result                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [deezer/deepfake-detector](https://github.com/deezer/deepfake-detector) | Deezer's research detector (ICASSP 2025)                                            | 99.8% on its test set, but collapses with pitch shifts, noise or re-encoding, and on unseen generators ([paper](https://arxiv.org/abs/2405.04181))       |
| [SONICS](https://github.com/awsaf49/sonics) (ICLR 2025)                 | 97,000-song dataset (49,000 synthetic, from Suno and Udio) plus the SpecTTTra model | Strong on its own data; below 0.30 AUROC in a 2026 shifted benchmark (see below)                                                                         |
| [FakeMusicCaps](https://arxiv.org/abs/2409.10684)                       | Dataset for detecting and attributing text-to-music output                          | Useful for building a test set                                                                                                                           |
| [SVDD 2024 challenge](https://arxiv.org/abs/2408.16132)                 | Singing-voice deepfake detection                                                    | Best team: 1.65% equal error rate in the controlled track                                                                                                |
| [ArtifactBench](https://arxiv.org/abs/2609.23550) (September 2026)      | Benchmark that tests detectors on new generators and new kinds of real music        | Its authors' own ArtifactNet scored 0.982 AUROC; Deezer's public detector 0.761; SpecTTTra and CLAM below 0.30. Note the authors built the winning model |

_AUROC is a 0 to 1 score of how well a detector separates the two classes across all thresholds; 0.5 is a coin
toss, 1.0 is perfect._

## 4. Known weaknesses

**False positives on human music.** This is the risk that matters most to Trusic, because a false positive cuts a
human artist's pay.

- Vendors report very low rates (Deezer under 0.01%, IRCAM under 1%), measured on their own data.
- Researchers point out that real uploads are remixed, re-encoded or pitch-shifted, and these edits can create
  spectral traces that look like AI artefacts. A detector trained specifically to tell AI from edited human audio
  reached only 0.811 balanced accuracy ([Morosanu et al., August 2026](https://arxiv.org/abs/2608.14916)).
- **Trusic-specific risk:** Trusic explicitly allows AI mastering, stem separation, noise removal and pitch
  correction. Several of these tools are themselves neural networks. I found no study measuring whether they trigger
  AI-music detectors, so **this must be tested** before launch.
- AI _text_ detection, which a lyrics check would rely on, has a poor record. OpenAI withdrew its own text classifier
  in 2023, which caught only 26% of AI text and wrongly flagged 9% of human text
  ([Search Engine Land](https://searchengineland.com/openai-ai-classifier-no-longer-available-429912)). A Stanford
  study found detectors flagged 61% of essays by non-native English writers as AI
  ([Liang et al., summarised by CASRAI](https://casrai.org/guides/ai-detection-accuracy-higher-education)).

**Robustness to re-encoding, pitch-shifting and re-recording.**

- Deezer's own researchers showed accuracy "plummets" with a two-semitone pitch shift or a little added noise
  ([Afchar et al.](https://arxiv.org/abs/2501.10111)). A 2026 paper confirmed detection "collapses" under speed or
  pitch changes, and proposed a fix that is built to resist them
  ([Dugelay et al., ISMIR 2026](https://arxiv.org/abs/2607.27454)).
- An ICASSP 2026 study reported that a commercial baseline could be fooled simply by resampling audio to 22.05 kHz
  ([López-Ayala et al.](https://arxiv.org/abs/2602.06823)).
- Detectors that were near-perfect on clean music degraded substantially on real TV recordings
  ([BAMM study](https://arxiv.org/abs/2608.07359)). I found no study of playing a track through speakers and
  re-recording it, but the broadcast results suggest that would also hurt.
- Services marketing ways to make AI music "undetectable" are openly advertised (for example
  [Undetectr](https://undetectr.com/blog/ai-music-detector-comparison)). Expect deliberate evasion.

**New generator versions.** Artefact detectors learn specific generator designs. Suno launched v6 models in
September 2026 ([Unite.AI](https://www.unite.ai/suno-launches-v6-music-models-built-with-warner-music-bmg-and-believe/)),
and each new release may need retraining. Deezer says it can add any generator it has examples of. The ArtifactBench
results above show how much performance can drop on unfamiliar material.

## 5. Recommendation for Trusic

### Shortlist to trial

1. **Deezer AI detection.** Largest real-world track record (it has tagged more than 13.4 million tracks), names the
   generator, and is used by collecting societies. Ask whether it offers stem-level or hybrid output, a calibrated
   score, and on-premises deployment. Price unknown.
2. **ACRCloud AI Music Detector.** Checks vocals and accompaniment separately, which maps onto the rubric's vocals and
   instruments rows. It has a free trial and what appears to be self-serve pricing. No published accuracy, so your
   own test matters most here. ACRCloud also sells copyright fingerprinting, which the roadmap needs anyway.
3. **IRCAM Amplify.** Well-established, API-first, with a published false-positive claim. Price unknown.

Alternates: Vobile/Pex (adds voice-clone identification and copyright fingerprinting) and Hive (per-chunk vocal and
music scores).

**Free layers to run alongside, all of them raise-only:**

- the existing metadata check
- C2PA manifests
- SynthID, once an API is available
- Udio's Audible Magic registry and Suno's watermark, if they offer partner access

A positive watermark or registry hit is strong evidence that AI was used somewhere in the track. It does not tell you
which part.

### Evaluation plan

**Build a labelled test set, labelled part by part using the rubric**, so you can compare detector output with the
"true" score.

| Group                                                                                                                        | Suggested size         | Why                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| Human, untouched (many genres, including lo-fi home recordings, live, classical, electronic)                                 | 1,000 or more          | Measures false positives                                      |
| Human, processed with **allowed** AI tools (AI mastering, stem separation, noise removal, pitch correction)                  | 300                    | "Hard negatives": the cases most likely to be wrongly flagged |
| Human, transformed (MP3/AAC at several bitrates, ±1–2 semitones, ±5% speed, resampled)                                       | Derived from the above | Robustness                                                    |
| Hybrid: AI vocal over human backing; human vocal over AI backing; one AI instrument; AI melody re-performed by humans        | 300                    | Partial-AI detection                                          |
| Fully generated, from as many generators and versions as you can (Suno, Udio, ElevenLabs, Lyria, MiniMax, Mureka and others) | 500                    | Recall per generator                                          |
| Fully generated, then mastered, re-encoded or pitch-shifted                                                                  | Derived from the above | Evasion                                                       |
| **Held-out newest generator** (never shown to you before testing)                                                            | 100                    | Generalisation                                                |

For human material, use recordings made before modern music generators existed (pre-2022) plus new tracks
commissioned from early Trusic artists with written consent. For hybrids, record human stems and generate AI stems
yourself so the truth is known.

**Metrics to measure:**

- **False-positive rate on human tracks** (the share of human tracks flagged) at the chosen threshold, overall, per
  genre and for the "hard negatives". This is the headline number.
- **Detection rate (recall)** on fully generated tracks, per generator, and on the held-out generator.
- **Per-part accuracy on hybrids**: did the detector find the AI vocal or the AI backing?
- **Calibration**: when a tool says "90% confident", is it right about 90% of the time? Vendor confidence numbers are
  often not true probabilities.
- **Robustness**: how much each figure drops after transformation.
- **Operations**: cost per track, speed, and how often the API fails or returns nothing.

**Statistics note.** To show a false-positive rate is below 0.1% with reasonable confidence, you need about 3,000
human tracks with **zero** false positives (the "rule of three": zero errors in _n_ tests puts the 95% upper limit
near 3/_n_). With 1,000 human tracks you can only show it is below about 0.3%. Start with 1,000 and keep adding, using
appeal outcomes as fresh labelled data.

### Setting the threshold

The current rule in `PRODUCT.md` is "raise only, at 90% confidence or more, by more than 10 points." Suggested changes
for version 1:

1. **Don't trust a vendor's "90%".** Pick the threshold on your own test set: the lowest setting at which the
   false-positive rate on human tracks (including hard negatives) is at or below your target. A sensible target is
   **0.1% or lower**. At 10,000 human uploads a month, 1% would mean about 100 wrongly penalised artists and 100
   appeals every month; 0.1% would mean about 10.
2. **Automatically raise only on full-track "fully generated" verdicts**, and only when two independent signals agree
   (two detectors, or one detector plus a watermark or registry hit). Raise to the rubric score that fits what was
   found, rather than straight to 100, unless every part is flagged.
3. **Send partial-AI signals** (an AI vocal, an AI backing track) **to human review** rather than changing the score
   automatically, until stem-level detection has proved itself on your test set.
4. **Show the artist the evidence**: which tool, which part, which generator if named, and the score. Promise an
   appeal turnaround time.
5. **Re-test every quarter and whenever a major generator ships a new version**, and record the detector version on
   each decision.

## 6. What other platforms do

| Platform         | Labelling                                                                                                                                                            | Detection                                            | Pay                                                                                         | Recommendations                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Deezer**       | Tags albums containing fully AI tracks (since June 2025)                                                                                                             | Own detector since January 2025                      | Up to 85% of streams on AI tracks found fraudulent and demonetised; no hi-res copies stored | Fully AI tracks excluded from algorithmic and editorial picks             |
| **Spotify**      | "AI credits" in song credits, self-declared via distributors (beta from April 2026); "AI Persona" badge for AI-generated artist identities (from mid-September 2026) | Spam filter; reviews artist profiles for AI personas | No penalty for AI-assisted music; impersonation banned                                      | AI Personas excluded from recommendations by default                      |
| **Apple Music**  | "Transparency Tags" declared by labels and distributors (from March 2026); visible "Made With AI" labels due by end of 2026                                          | None independent (self-declared)                     | None announced                                                                              | None announced                                                            |
| **YouTube**      | Creators must disclose realistic altered or synthetic content; label made more prominent in May 2026                                                                 | SynthID for Google's own tools                       | "Inauthentic" mass-produced content is not eligible for monetisation (since July 2025)      | Disclosure alone doesn't reduce reach                                     |
| **Tidal**        | "AI" badge on wholly AI tracks (from July 2026)                                                                                                                      | External detection partner                           | **No royalties** for wholly AI-generated tracks                                             | n/a                                                                       |
| **Qobuz**        | Tag on detected AI music (visible since 24 September 2026)                                                                                                           | Own detector                                         | Fraudulent streams filtered out of royalties                                                | Excluded from editorial and algorithmic picks; can be removed from search |
| **Bandcamp**     | n/a: music "generated wholly or in substantial part by AI" is **banned** (13 January 2026)                                                                           | None; relies on user reports                         | n/a                                                                                         | n/a                                                                       |
| **SoundCloud**   | Unclear; reports conflict                                                                                                                                            | Unclear                                              | Impersonation and voice cloning banned                                                      | Unclear                                                                   |
| **Amazon Music** | No detailed public policy found                                                                                                                                      | Unclear                                              | Unclear                                                                                     | Unclear                                                                   |

Sources for this table: Deezer ([June 2025](https://newsroom-deezer.com/2025/06/deezer-launches-worlds-first-ai-tagging-system-for-music-streaming/),
[January 2026](https://newsroom-deezer.com/2026/01/ai-generated-music-deezer-selling-detection-tool/),
[April 2026](https://techcrunch.com/2026/04/20/deezer-says-44-of-songs-uploaded-to-its-platform-daily-are-ai-generated/));
Spotify ([Variety](https://variety.com/2025/digital/news/spotify-new-ai-safeguards-1236528493/),
[Digital Music News](https://www.digitalmusicnews.com/2026/04/22/spotify-tests-ai-credit-labels-distrokid/),
[TechCrunch](https://techcrunch.com/2026/08/11/spotify-will-label-ai-persona-profiles-and-exclude-their-music-from-recommendations/));
Apple ([MBW](https://www.musicbusinessworldwide.com/apple-music-launches-ai-transparency-tags-but-only-if-labels-and-distributors-choose-to-declare-them/),
[MacRumors](https://www.macrumors.com/2026/08/20/apple-music-to-label-ai-generated-songs/));
YouTube ([YouTube Help](https://support.google.com/youtube/answer/1311392?hl=en),
[Social Media Today](https://www.socialmediatoday.com/news/youtube-clarifies-monetization-update-inauthentic-repeated-content/752892/),
[air.io](https://air.io/en/youtube-hacks/youtube-ai-disclosure-in-2026-label-it-yourself-or-youtube-will));
Tidal ([Variety](https://variety.com/2026/music/news/tidal-label-ai-generated-music-ban-royalties-from-ai-songs-1236798543/));
Qobuz ([Music Ally](https://musically.com/2026/02/27/qobuz-joins-deezer-in-tagging-tracks-it-detects-are-ai-generated/),
[AlternativeTo](https://alternativeto.net/news/2026/9/qobuz-now-displays-a-tag-alerting-users-when-music-has-been-identified-as-ai-generated/));
Bandcamp ([Consequence](https://consequence.net/2026/01/bandcamp-bans-all-ai-music/));
SoundCloud ([Hollywood Reporter](https://www.hollywoodreporter.com/music/music-news/soundcloud-updates-ai-policies-after-backlash-1236217531/));
Amazon ([Digital Music News](https://www.digitalmusicnews.com/2026/03/06/ai-rules-at-major-streaming-platforms/));
and Billboard's continuously updated tracker ([Billboard](https://www.billboard.com/lists/how-each-music-listening-platform-treats-ai-music/)).

**Scale of the problem.**

- Deezer received about 10,000 fully AI tracks a day in January 2025. That rose to about 75,000 a day (44% of uploads)
  by April 2026 and about 90,000 (more than half) by June–July 2026. Yet AI tracks are only 1–3% of streams
  ([TechCrunch](https://techcrunch.com/2026/07/21/music-streamer-deezer-says-more-than-50-of-daily-uploads-are-ai-generated/),
  [Music Ally](https://musically.com/2026/07/21/ai-generated-music-is-now-more-than-half-of-deezers-uploads/)).
- Apple told Billboard in April 2026 that "more than a third" of its monthly uploads were fully AI-generated, with
  under 0.5% of listening ([Dataconomy](https://dataconomy.com/2026/04/28/one-third-of-apple-music-uploads-now-fully-ai-generated/)).

**Where this leaves Trusic.**

- **The closest peers act only on "wholly AI".** Tidal pays nothing for wholly AI tracks, and Deezer and Qobuz limit
  their reach and filter fraud.
- **The biggest platforms label without verifying.** Spotify and Apple show what uploaders declare.
- **Bandcamp bans AI music** and relies on user reports.
- **Trusic's graded score is a genuine differentiator.** It pays partly-AI music a proportionally lower rate and
  sends the difference to human artists the same listener played.
- **But detection can't yet verify the graded middle.** So in practice the score will rest on the artist's
  declaration. That makes the artist agreement, audits and penalties for false declarations (open question 3 in
  `PRODUCT.md`) at least as important as the detector.
- **Wording.** Tidal says it will tag "substantially AI-generated" music once detection becomes more reliable, a
  useful precedent. Trusic should say publicly that partial-AI scores are mainly declared, not detected.

## Sources

Platform and vendor pages and press

- Deezer, AI music detector page: https://www.deezer.com/explore/en-us/ai-music-detector/
- Deezer for business, AI detection: https://business.deezer.com/ai-detection/
- Deezer newsroom, AI tagging (June 2025): https://newsroom-deezer.com/2025/06/deezer-launches-worlds-first-ai-tagging-system-for-music-streaming/
- Deezer newsroom, 85% of AI streams fraudulent; tool for sale (January 2026): https://newsroom-deezer.com/2026/01/ai-generated-music-deezer-selling-detection-tool/
- Deezer newsroom, 44% of uploads (April 2026): https://newsroom-deezer.com/2026/04/ai-generated-tracks-represent-44-of-new-uploaded-music/
- Deezer newsroom, over 50% of uploads (July 2026): https://newsroom-deezer.com/2026/07/ai-music-exceeds-50-percent-daily-uploads-deezer/
- TechCrunch, Deezer 44%: https://techcrunch.com/2026/04/20/deezer-says-44-of-songs-uploaded-to-its-platform-daily-are-ai-generated/
- TechCrunch, Deezer over 50%: https://techcrunch.com/2026/07/21/music-streamer-deezer-says-more-than-50-of-daily-uploads-are-ai-generated/
- TechCrunch, Deezer opens tool to rivals: https://techcrunch.com/2026/01/29/deezer-makes-it-easier-for-rival-platforms-to-take-a-stance-against-ai-generated-music
- Music Ally, Deezer over half of uploads: https://musically.com/2026/07/21/ai-generated-music-is-now-more-than-half-of-deezers-uploads/
- MarketScreener, Deezer and Sacem: https://www.marketscreener.com/news/deezer-signs-groundbreaking-agreement-with-sacem-to-detect-ai-generated-music-ce7e5bdfda8df224
- Rappler (Reuters), Deezer licensing and pricing: https://www.rappler.com/technology/deezer-artificial-intelligence-music-detection-tool-france-sacem-license/
- iMusician, Deezer AI policy (EJI licence): https://imusician.pro/en/resources/blog/deezer-ai-music-policy
- Music Ally, IRCAM Amplify launch: https://musically.com/2024/05/02/ircam-amplify-launches-a-tool-to-detect-ai-generated-music/
- IRCAM Amplify: https://www.ircamamplify.com/
- IRCAM Amplify demo code: https://github.com/Ircam-Amplify/AI-MUSIC-DETECTOR
- ACRCloud AI Music Detector: https://www.acrcloud.com/ai-music-detector/
- ACRCloud docs: https://docs.acrcloud.com/reference/console-api/file-scanning/metadata/ai-music-detection
- fast.io detector comparison (third-party pricing claim): https://fast.io/resources/ai-music-detector-tools-2026/
- Pex/Vobile AI Song Detector: https://pex.com/blog/vobile-launches-ai-song-detector-for-streaming-platforms-distributors-and-collection-societies/
- Pex voice identification: https://pex.com/blog/keeping-it-real-how-pex-identifies-ai-generated-voices-in-music/
- Hive AI music detection docs: https://docs.thehive.ai/reference/ai-generated-music-detection-1
- Modulate AI music detection API: https://www.modulate.ai/api/ai-music-detection
- MBW, Believe AI Radar: https://www.musicbusinessworldwide.com/believe-has-developed-its-own-ai-made-music-detector-with-98-accuracy-what-might-this-mean-for-the-future1/
- SubmitHub AI Song Checker v4.0: https://www.submithub.com/story/ai-song-checker-v4-0
- Audible Magic and Udio: https://www.audiblemagic.com/2025/04/30/udio-partners-with-audible-magic-to-fingerprint-ai-generated-tracks-and-to-check-for-infringements/
- MBW, Musixmatch Sentinel: https://www.musicbusinessworldwide.com/musixmatch-launches-sentinel-service-to-detect-when-copyrighted-music-and-lyrics-are-used-in-ai-and-user-generated-content/
- RouteNote, SoundPatrol: https://routenote.com/blog/can-we-finally-detect-copyrighted-works-in-ai-music-umg-and-sony-join-forces-with-soundpatrol/
- TechCrunch, Suno watermarking: https://techcrunch.com/2026/08/06/amid-legal-battles-suno-says-it-will-start-watermarking-songs/
- Unite.AI, Suno v6: https://www.unite.ai/suno-launches-v6-music-models-built-with-warner-music-bmg-and-believe/
- CineD, Lyria 3 and SynthID: https://www.cined.com/google-lyria-3-launches-in-gemini-ai-music-generation-with-lyrics-style-control-and-synthid-watermarking/
- Google, SynthID Detector: https://blog.google/innovation-and-ai/products/google-synthid-ai-content-detector/
- C2PA specification 2.4: https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html
- Undetectr (example of an evasion service): https://undetectr.com/blog/ai-music-detector-comparison
- Search Engine Land, OpenAI classifier withdrawn: https://searchengineland.com/openai-ai-classifier-no-longer-available-429912
- CASRAI, AI text detector false positives: https://casrai.org/guides/ai-detection-accuracy-higher-education

Research papers

- Afchar et al., Detecting music deepfakes is easy but actually hard: https://arxiv.org/abs/2405.04181
- Afchar, AI-generated music detection and its challenges: https://arxiv.org/abs/2501.10111
- Afchar et al., A Fourier explanation of AI-music artifacts (ISMIR 2025): https://arxiv.org/abs/2506.19108
- Frohmann et al., AI-generated song detection via lyrics transcripts (ISMIR 2025): https://arxiv.org/abs/2506.18488
- Rahman et al., SONICS (ICLR 2025): https://github.com/awsaf49/sonics
- FakeMusicCaps: https://arxiv.org/abs/2409.10684
- deezer/deepfake-detector: https://github.com/deezer/deepfake-detector
- SVDD 2024 challenge: https://arxiv.org/abs/2408.16132
- AudioMarkBench (NeurIPS 2024): https://proceedings.neurips.cc/paper_files/paper/2024/file/5d9b7775296a641a1913ab6b4425d5e8-Paper-Datasets_and_Benchmarks_Track.pdf
- López-Ayala et al., AI-generated music detection in broadcast monitoring (ICASSP 2026): https://arxiv.org/abs/2602.06823
- Assessing AI-generated music detection in real-world broadcast monitoring (BAMM): https://arxiv.org/abs/2608.07359
- Han et al., Beyond Artifacts: https://arxiv.org/abs/2606.16612
- Rigaud et al., Detection of AI-generated stems within hybrid human-AI music (ISMIR 2026): https://arxiv.org/abs/2607.26874
- Dugelay et al., Improved robustness in AI-generated music detection (ISMIR 2026): https://arxiv.org/abs/2607.27454
- Garcia de la Cruz et al., How much AI is in this track? (ISMIR 2026): https://arxiv.org/abs/2608.07285
- BMAT summary of the above: https://www.bmat.com/ai-music-detection-how-much-ai-in-a-track/
- Morosanu et al., Distinguishing AI-generated music from edited audio: https://arxiv.org/abs/2608.14916
- ArtifactBench: https://arxiv.org/abs/2609.23550
- Namballa et al., A stem-agnostic approach to hybrid AI music detection: https://arxiv.org/abs/2609.26956

Other platforms

- Variety, Spotify AI safeguards (September 2025): https://variety.com/2025/digital/news/spotify-new-ai-safeguards-1236528493/
- Digital Music News, Spotify AI credits beta: https://www.digitalmusicnews.com/2026/04/22/spotify-tests-ai-credit-labels-distrokid/
- TechCrunch, Spotify AI Persona: https://techcrunch.com/2026/08/11/spotify-will-label-ai-persona-profiles-and-exclude-their-music-from-recommendations/
- MBW, Apple Music Transparency Tags: https://www.musicbusinessworldwide.com/apple-music-launches-ai-transparency-tags-but-only-if-labels-and-distributors-choose-to-declare-them/
- MacRumors, Apple "Made With AI" labels: https://www.macrumors.com/2026/08/20/apple-music-to-label-ai-generated-songs/
- Dataconomy, Apple uploads one-third AI: https://dataconomy.com/2026/04/28/one-third-of-apple-music-uploads-now-fully-ai-generated/
- YouTube channel monetisation policies: https://support.google.com/youtube/answer/1311392?hl=en
- Social Media Today, YouTube inauthentic content: https://www.socialmediatoday.com/news/youtube-clarifies-monetization-update-inauthentic-repeated-content/752892/
- air.io, YouTube AI disclosure in 2026: https://air.io/en/youtube-hacks/youtube-ai-disclosure-in-2026-label-it-yourself-or-youtube-will
- Variety, Tidal AI policy: https://variety.com/2026/music/news/tidal-label-ai-generated-music-ban-royalties-from-ai-songs-1236798543/
- Music Ally, Qobuz tagging: https://musically.com/2026/02/27/qobuz-joins-deezer-in-tagging-tracks-it-detects-are-ai-generated/
- AlternativeTo, Qobuz tag visible: https://alternativeto.net/news/2026/9/qobuz-now-displays-a-tag-alerting-users-when-music-has-been-identified-as-ai-generated/
- Consequence, Bandcamp ban: https://consequence.net/2026/01/bandcamp-bans-all-ai-music/
- Hollywood Reporter, SoundCloud terms: https://www.hollywoodreporter.com/music/music-news/soundcloud-updates-ai-policies-after-backlash-1236217531/
- Digital Music News, AI rules at major platforms: https://www.digitalmusicnews.com/2026/03/06/ai-rules-at-major-streaming-platforms/
- Billboard, how each platform treats AI music: https://www.billboard.com/lists/how-each-music-listening-platform-treats-ai-music/
