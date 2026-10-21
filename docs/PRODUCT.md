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

4. **The human pot.** If a subscriber played nothing, or only fully AI-generated tracks, their 80% goes into a
   platform-wide pot for human music. The pot is shared by human-weighted streams across all subscribers. Revenue
   that can't be tied to a listener goes there too, and so does money clawed back from false declarations (see
   strikes, below). If a whole month has no human streams, the pot carries over to the next month, so it is never
   kept by Trusic.
5. **Band splits.** Each track's money is divided between its payees by percentages they set (default: 100% to
   the uploader). Everyone in a split needs a Trusic account.
6. **Every penny is accounted for.** All amounts are whole pence, split with the largest-remainder method.
   Trusic's share + artist payouts + carried-over pot always equals revenue (plus anything carried in or clawed
   back) exactly, and the engine refuses to produce a result where it doesn't.
7. **Months are finalised.** A month is calculated, checked, then finalised. Until then it can be recalculated.
   Once finalised, its earnings can be paid out (via Stripe, once an artist has £10 or more available), and later
   corrections are made by clawing money back rather than rewriting the month.

### Listening

- **Subscribers only. No free tier and no adverts.** Premium is £10.99 a month including VAT.
- Anyone can browse the whole catalogue and hear **30-second previews**. Previews never count as plays, so only
  subscribers' listening moves money.
- **Embedded players** on other websites (a band's own site, say) play the same 30-second previews to everyone,
  subscribers included: nobody signs in inside someone else's website. They always show the AI label and link to
  Trusic to listen in full. Only these players can appear inside other websites; every other Trusic page refuses.

### Sharing

- A link to a track, release, artist or public playlist shows a preview wherever it's pasted (WhatsApp, iMessage,
  Slack, Discord, X, Facebook…): the title, who it's by, the artwork and the AI label, on a picture Trusic draws
  itself.
- Previews never show private playlists, anything taken down after a report, or deleted accounts.

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

### Rubric (version 2026-10.2)

| Part of the track           | Weight | AI-assisted (free) | AI-generated (100%) |
| --------------------------- | ------ | ------------------ | ------------------- |
| Songwriting & composition   | 30     | +0                 | +30                 |
| Lyrics                      | 15     | +0                 | +15                 |
| Vocals (incl. voice clones) | 25     | +0                 | +25                 |
| Instruments & performance   | 25     | +0                 | +25                 |
| Arrangement & sound design  | 5      | +0                 | +5                  |

- **AI-assisted:** a person did the work; AI suggested ideas or helped with parts. This is free: light help can't
  be detected or checked, and penalising honest artists for admitting it would only reward the ones who don't. It's
  still shown on the track.
- **AI-generated:** AI produced it, for example from a prompt.
- **Doesn't apply:** the part isn't in the track (e.g. vocals on an instrumental). Its weight is spread over the
  other parts, so a fully generated instrumental still scores 100.

Examples: a band playing its own song, mastered with LANDR, scores **0**. A human song sung by an AI voice model
scores **25**. Human lyrics on a Suno-generated track score **85**. A Suno track scores **100**.

### Labels

| Score  | Label      |
| ------ | ---------- |
| 0–9    | Human-made |
| 10–69  | Partly AI  |
| 70–100 | AI Slop    |

The exact score is always shown next to the label.

### How a track's score is set

1. **Declare.** At upload, the artist says how much AI went into each part. This gives the declared score.
2. **Detect.** Automated detection runs on every upload. It can only **raise** the score, never lower it, and only
   when it is at least 90% confident and finds more than 10 points of extra AI. A raised track is flagged.
3. **Appeal.** The artist can ask for a human review. A reviewer's decision overrides both. Admins can also
   re-score any track after an audit or a report.
4. **Strikes.** When a declaration is proven false (by an audit, or when rejecting an appeal), an admin can issue a
   strike with the corrected score. The track is re-scored; whatever it over-earned in finalised months is clawed
   back from its payees' future earnings and paid to human music in the next run; months not yet finalised are
   simply recalculated. **Three strikes suspends the account**: its tracks come down and it can't upload. An admin
   can reinstate it, and the strikes stay on record.

### Songwriting details

Uploads ask who wrote the song, whether any songwriter belongs to PRS for Music or another collecting society,
whether it's a cover, and the ISRC if there is one. Nothing is paid differently because of it yet: it's the
information Trusic will need to agree a licence with PRS (see open question 10).

### Lyrics

- Artists add lyrics in Studio, as plain text or synced to the music, so each line lights up as it's sung.
- Only the track's uploader and the people in its band split can add or change them.
- **Lyrics aren't shown for covers.** The words belong to the original songwriters, and showing lyrics on screen
  needs its own licence, separate from playing the song, usually bought through LyricFind or Musixmatch. Trusic
  doesn't have one, so it doesn't accept lyrics for tracks marked as covers, and hides any added before a track was
  marked as one.
- For original songs, Trusic shows lyrics on the uploader's word that the band wrote them and can let Trusic show
  them. Whether that's enough, for example when a writer has a music publisher, is open question 17.

Today's detector only reads file metadata (generators like Suno sometimes leave their name in the tags). It
catches careless uploads but is trivially evaded. A real audio-analysis detector is a launch requirement (see the
roadmap). Even the best detectors can't reliably see _partial_ AI use, so for scores between 0 and 100 the
artist's declaration will remain the main evidence; see [research/ai-detection.md](research/ai-detection.md).

## 3. Accounts, reports and takedowns

### Accounts

- **Confirming an email address.** Sign-up emails a link. Listening works straight away, but uploading music,
  artwork or photos, setting up payouts and being paid all wait until the address is confirmed. The demo accounts
  count as confirmed.
- **Forgotten passwords.** A reset link works once and for 1 hour, and only a scrambled copy (a hash) of it is stored.
  The form says the same thing whether or not an email address has an account. Each account gets at most 3 links an
  hour, and each internet address can ask 5 times in 15 minutes. Setting a new password signs out every other
  session.
- **Settings.** Change your name; change your email address (the old one keeps working, and is warned, until the new
  one is confirmed); change your password (needs the current one, and signs out your other devices); and sign out
  everywhere.
- **Email** is printed in the server's log until an email service is set up. See [EMAIL.md](EMAIL.md).

### Your data (UK GDPR)

- **Download:** a JSON file of everything Trusic holds about the account: profile, artist profiles, track details,
  plays, likes, playlists, follows, statements, earnings, ledger, strikes, appeals and reports.
- **Delete:** needs the password and typing "DELETE". Then:
  - the name, email address, password, likes, follows, playlists, sessions and email links go;
  - the account's tracks come down for good (taken-down tracks stay taken down), their audio, artwork and photos are
    deleted, releases are deleted, and artist profiles are hidden and renamed "Deleted artist";
  - the account's share of other people's tracks goes to whoever uploaded each track;
  - plays, payments, monthly statements, payout runs, ledger entries and strikes **stay**, attached to an anonymous
    account with no name, email or password. Other people's statements and Trusic's books are built from them, so
    deleting them would change what other artists were paid;
  - money still owed to the account is held, not paid out (open question 12);
  - a subscription is cancelled straight away;
  - the email address is free to sign up with again, as a brand-new account. Copyright notices the person sent are
    kept as a legal record; their contact details are removed from their other reports.

### Reports and takedowns

- **Anyone can report** a track, release, artist, playlist, or a piece of artwork on its own, signed in or not (with
  an email address so we can reply). Reasons: copyright infringement, offensive or illegal content, impersonation,
  and wrong AI label.
- **A copyright report is a notice.** It must include the claimant's name, postal address and email address, whether
  they own the rights or act for the owner, the original work, what on Trusic copies it, a good-faith statement, a
  statement that the notice is accurate, and a typed signature. The uploader sees the claimant's name and the work
  claimed, not their contact details.
- **Admins** take content down, reject the report, or ask the reporter for more (they answer from a link in the email).
  Every decision comes with a note that's emailed to the people involved.
- **Taken down** means: a track gets its own "taken down" status, is hidden everywhere, can't be played (even from
  links handed out earlier), and earns nothing in months that aren't finalised yet: its listeners' money goes to
  whatever else they played. Finalised months aren't reopened. A release takes its tracks down with it; an artist takes
  its releases and tracks; a playlist is hidden from everyone but its owner; artwork comes off every release or profile
  showing it.
- **Counter-notices.** The uploader is emailed the reason and can send one counter-notice per takedown. It goes, with
  their name and email address (with their consent), to the person who reported it, who is asked to reply within 10
  working days if they've started legal action. An admin then puts the content back or keeps it down.
- **Repeat infringers.** Each upheld copyright takedown is a **copyright strike**. Three suspend the account through
  the same suspension as AI strikes, and an admin can reinstate it. Putting content back withdraws its strike.
  Copyright strikes and strikes for false AI declarations are counted separately and shown separately everywhere.
- **Wrong AI labels** go to the score review next to appeals, not the takedown queue. An admin changes the score,
  changes it and issues an AI declaration strike, or leaves it.
- **Public pages:** the web app's Copyright page (`/legal/copyright`) explains how to send a notice. Its Terms page
  (`/legal/terms`) is a placeholder listing what a lawyer must write.

## 4. Decisions log

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
| 2026-10-06 | No free tier and no adverts. Non-subscribers can browse and hear 30-second previews.                                                 | Founder: no advertising on the platform. Previews let people discover music without free listening.                                        |
| 2026-10-06 | Labels are "Human-made", "Partly AI" and "AI Slop".                                                                                  | Founder's choice: plain about what fully generated music is.                                                                               |
| 2026-10-06 | AI assistance is free; only AI-generated parts raise the score.                                                                      | Light help can't be detected, so a penalty would only punish honest artists.                                                               |
| 2026-10-06 | False declarations get a strike and an exact clawback; three strikes suspends the account.                                           | Declarations are the main evidence for partial AI, so lying has to cost more than it can earn.                                             |
| 2026-10-06 | Months are finalised before payout; corrections after that are clawbacks.                                                            | A month can't be both recalculated and clawed back, which would charge an artist twice.                                                    |
| 2026-10-06 | Collect songwriting details at upload; keep 80/20 as is until PRS's terms are known.                                                 | Needed for a PRS licence either way; how songwriting royalties fit the split needs legal advice (open question 10).                        |
| 2026-10-21 | "Human-made only" hides Partly AI and AI Slop from browsing, search, recommendations and radio. What you open still plays in full.   | The switch is about what Trusic puts in front of you. Hiding tracks inside an album or a shared playlist would break them.                 |
| 2026-10-21 | Recommendations rank only by listening (streams and likes) and the Human-made only switch. No paid placement, no boost for a label.  | Transparency is the brand: nobody can buy a place, and every recommendation says why in plain English.                                     |
| 2026-10-21 | Artist stats count streams exactly as payouts do. Band members see all of the artist's listening but only their own money.           | Stats that disagree with the money would confuse artists. A band shares its audience, but each member's pay is their own.                  |
| 2026-10-21 | Apps say where each play started (an album, a playlist, radio…). It's optional, and an unknown value is kept as "other".             | Artists want to know how listeners find them, and a stats label must never cost a listener's play.                                         |
| 2026-10-21 | Uploading and payouts need a confirmed email address; listening doesn't.                                                             | People can start listening at once, but anyone we pay, or take music down from, can be reached.                                            |
| 2026-10-21 | A new email address only replaces the old one once it's confirmed, and the old one is warned.                                        | A typo can't lock anyone out, and someone using a stolen session can't quietly take over the account.                                      |
| 2026-10-21 | Deleting an account anonymises its plays and money records instead of deleting them.                                                 | Other listeners' statements and artists' payouts are built from them; deleting them would change what other people were paid.              |
| 2026-10-21 | A deleted account's share of band splits goes to the track's uploader. Money still owed to it is held, not paid out.                 | The band's track keeps paying out in full. There's nobody left to pay the deleted account (open question 12).                              |
| 2026-10-21 | A taken-down track earns nothing in months not yet finalised. Finalised months aren't reopened.                                      | Same rule as clawbacks: corrections never rewrite a finalised month. The listener's money goes to what else they played.                   |
| 2026-10-21 | Only upheld copyright takedowns are strikes. Three suspend, counted separately from AI declaration strikes.                          | A repeat-infringer policy is expected for the hosting defence. Keeping the two kinds apart makes each easy to explain and to appeal.       |
| 2026-10-21 | Putting content back withdraws its copyright strike, but doesn't lift a suspension by itself.                                        | An admin decides on reinstating, as with AI strikes, because the account may have other strikes too.                                       |
| 2026-10-21 | Wrong-label reports go to the score review with appeals, using the same tools.                                                       | One process for AI scores, and the same strikes and clawbacks for false declarations however they're found.                                |
| 2026-10-21 | Uploaders see a copyright claimant's name and the work claimed, not their contact details. Counter-notices go to the claimant.       | Uploaders need to know what's claimed to respond; claimants' addresses are private. Uploaders agree to their details being passed on.      |
| 2026-10-21 | Lyrics for covers are never shown. Lyrics for original songs are shown on the uploader's word.                                       | Showing lyrics needs the songwriters' permission. Trusic has none for covers; bands can give it for their own songs (question 17).         |
| 2026-10-21 | Only the uploader and the band split can edit a track's lyrics.                                                                      | The people who wrote and recorded the song; the same people who share its money.                                                           |
| 2026-10-21 | Embedded players play 30-second previews to everyone, never full tracks, and never count as plays.                                   | Nobody should sign in inside someone else's website, and only listening on Trusic moves money. Embeds send people to Trusic instead.       |
| 2026-10-21 | Link previews and share pictures never include private playlists or taken-down content.                                              | A preview is shown to everyone the link is sent to, so it must only show what anyone could see on Trusic.                                  |

## 5. Open questions

These need a decision from the founder. The current behaviour is in brackets.

1. **Rubric weights.** Are the weights right? For example, a song with human lyrics and vocals but an AI-generated
   melody and backing scores 55 and is labelled "Partly AI". Should it be higher? [weights above]
2. ~~"AI-assisted" penalty~~: decided, assistance is free.
3. ~~Penalties for lying~~: decided, strikes and clawbacks.
4. **Fully AI tracks.** Allowed, labelled, earn nothing. Should they also be hidden from default recommendations,
   or have their own section? [shown like any other track and ranked only by listening; listeners can turn on
   "Human-made only" to hide them, see section 7]
5. ~~Free tier~~: decided, subscribers only, with previews.
6. **Price and market.** UK-first in GBP at £10.99/month? [GBP, £10.99 incl. VAT]
7. **Score changes mid-month.** If an appeal changes a track's score on the 20th, should earlier streams use the
   old score? [the score at calculation time applies to the whole month. Each play now records the score it was
   played at, so switching to "score at play time" is a small change once decided]
8. **Who can upload.** Direct uploads from artists only, or also deliveries from distributors (DistroKid, CD Baby…)
   and labels? [direct uploads only]
9. **Payout timing.** How often are artists paid, and is £10 the right minimum? [Stripe Connect, paid by an admin
   after a month is finalised, £10 minimum]
10. **What "80% to artists" covers.** Songwriting royalties (PRS for Music, about 16% of revenue on its small-service
    licence) are normally paid out of the music makers' share. Does "80%" mean recording artists only (Trusic keeps
    about 4%), recording plus songwriting (recording artists get about 64%), or 80/20 of what's left after
    songwriters (67% / 17%)? See [research/uk-licensing.md](research/uk-licensing.md). [not modelled yet: the engine
    pays 80% to recording payees]
11. **How confident detection must be.** The research suggests only raising scores automatically when two signals
    agree that a whole track is generated, and sending partial-AI signals to a person. Adopt that? See
    [research/ai-detection.md](research/ai-detection.md). [one confident signal is enough]
12. **Money owed to deleted accounts.** Should it be paid out before an account can be deleted, kept in case the
    person asks for it, or go to the human pot after a while? [held, not paid out; the deletion page warns about it]
13. **Takedown rules, for a lawyer.** Are the notice and counter-notice contents right? Is waiting 10 working days
    after a counter-notice before putting content back right for the UK? Should offensive-content or impersonation
    takedowns also count as strikes? Should a taken-down track's earnings from finalised months be clawed back and held
    for the rights owner? [as built: no strikes for those, no clawback]
14. **A contact address for legal notices.** UK law expects a business website to show an email address, and some
    rights owners prefer to email notices. [none published; notices come through the report form]
15. **Repeat infringers who delete their account.** A suspended account can be deleted and its email address used to
    sign up again. Should Trusic keep a scrambled copy of suspended accounts' addresses to stop that? [no]
16. **"Human-made only" by default.** Should new accounts start with it switched on? [off: everything is shown, with
    its label]
17. **Showing lyrics.** Can Trusic show lyrics that bands wrote themselves without a lyric licence, including when a
    writer has a music publisher or belongs to PRS? And should Trusic pay for a lyric licence (LyricFind or
    Musixmatch) so covers can show lyrics too? See [research/uk-licensing.md](research/uk-licensing.md). [lyrics
    for original songs are shown on the uploader's word; lyrics for covers are never shown]

## 6. Research

- [Detecting AI-generated music](research/ai-detection.md): what detection can and can't do, vendors to trial, an
  evaluation plan, and what other platforms do.
- [Licensing and legal obligations in the UK](research/uk-licensing.md): recording versus songwriting rights, PRS for
  Music, how songwriting royalties affect the 80/20 split, showing lyrics, platform liability, online safety and AI
  labelling.

Both were compiled from web searches on 6 October 2026. Several primary sources couldn't be opened directly, so
figures marked unverified must be checked before they go into a financial model.

## 7. Discovery and artist stats

### "Human-made only"

- Any listener can switch it on, from the top of every page. Signed in, it's kept on their account, so it follows
  them to every device. Visitors keep it in their browser.
- When it's on, tracks labelled Partly AI and AI Slop are left out of browsing, search, the home page, "More like
  this", "Fans also like" and radio. New releases only shows releases where every track is Human-made.
- **Albums, playlists, artist pages and tracks the listener opens themselves still show and play everything**, with
  every track labelled, and a note says how many of them aren't Human-made. A radio started from a track plays that
  track first, because the listener chose it; everything after it is Human-made.
- It's off by default (open question 16).

### Recommendations

Trusic builds its own recommendations from listening on Trusic. No outside service is involved, and nothing is paid
for.

- **No secret favouring.** Ranking uses only what listeners do (streams, meaning plays of 30 seconds or more, and
  likes) and the "Human-made only" switch. Nobody can pay to be recommended. No label gets a boost either way: a
  Partly AI track that the same people love ranks exactly where it would if it were Human-made. The "Fresh
  human-made music" shelf is openly about the label, and is simply in date order.
- **Similar** means streamed and liked by the same people. Each person counts once per track (a like counts double),
  and tracks that everyone plays anyway count a little less, so a smaller artist with a loyal audience can still
  come first. When there isn't enough listening yet, Trusic falls back to the same artist, then the same genre, then
  what's popular.
- **Everything says why**, for example "8 listeners of “Chalk Paths” also play this", and every shelf has a "Why am I
  seeing this?" note.
- **The home page:** Jump back in (what you played last), Made for you (music new to you that people with your
  taste play), New from artists you follow, Because you liked…, then the same shelves for everyone: Popular on Trusic
  (the last four weeks), New releases, Fresh human-made music and Artists to discover. Visitors and new listeners also
  get the most played genres.
- **Radio** starts from a track, an artist or a playlist and never ends: more is added as it runs low. Artist and
  playlist radio play one of their own tracks every third track. Radio stays with related music and goes round
  again, rather than drifting into whatever is popular.
- Removed, suspended and taken-down tracks are never recommended. Listening by deleted accounts no longer shapes
  recommendations, though it still counts in stats and payouts.

### Artist stats ("Trusic for Artists", in Studio)

- **Who sees them:** the account that owns the artist, band members in any of its tracks' splits, and Trusic admins.
- **Streams are counted exactly as payouts count them:** plays of 30 seconds or more by subscribers, on UTC days, so
  a month of stats adds up to that month's payout run. Listeners are different subscribers who streamed. Previews
  never count. A track that has been taken down stops counting, as it does for payouts.
- **What's shown:** streams, listeners, followers and new likes for the last 7, 28 or 365 days, compared with the
  time just before; a chart by day (by week for 365 days); top tracks; where listeners pressed play; and the same
  for each track on its own page.
- **Followers over time** counts the people who follow now, by the day they followed. Unfollows aren't recorded yet.
- **Money is always the viewer's own:** their share of each track, month by month, from the payout runs, with any
  clawbacks from their balance. Band members see the whole band's listening but only their own money.
- **Where plays start:** the apps send it with each play: an album, EP or single; a playlist; the artist's page;
  search; Liked songs; radio; recommendations; the queue; or elsewhere. Plays from older apps say nothing and are shown
  as "not recorded".
