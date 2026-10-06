# Licensing and legal obligations for a direct-upload streaming service in the UK

Research note for the founder. Compiled 6 October 2026. **This is background research, not legal advice.** It is
meant to make the first conversation with a music lawyer and with PRS for Music faster and cheaper.

**How this was researched.** Web searches only. The research environment could not open PRS for Music's PDFs,
GOV.UK, legislation.gov.uk or arXiv directly. For those, figures come from search-engine summaries of the
documents, and the URL is given so they can be checked. Anything marked **unverified** must be confirmed against the
original before it is used in a financial model.

## Summary for the founder

- **Every track contains two separate copyrights:** the _recording_ (the actual audio) and the _song_ (the melody and
  lyrics). An artist uploading their own recording can license the first to Trusic. The second usually has to be
  licensed from PRS for Music, because most professional UK songwriters have already handed those rights to PRS.
- **PRS for Music publishes a ready-made licence for small UK-only services** (up to £500,000 revenue a year), in
  force since 1 October 2025. The headline rate is **16% of revenue (excluding VAT)**, or a per-stream minimum if that
  is higher, with a £193 + VAT annual minimum. Larger services, or services outside the UK, need a negotiated licence.
- **Across the industry, songwriting money comes out of the "rights-holder" share, not the platform's.** Typically
  roughly 30% goes to the platform, about 55% to recordings and about 15% to songwriting. If Trusic does the same,
  its "80% to artists" becomes roughly **64% recording + 16% songwriting**. Paying songwriting out of Trusic's own 20%
  would leave Trusic about 4%.
- **Two things could break the numbers.** First, the per-stream minimum: reported as 0.43p per stream but
  **unverified**. If that is right, it would cost more than 16% once listeners average more than about 340 streams a
  month, and free-tier streams may count too. Second, PRS pays songwriters by its own rules, so Trusic's user-centric
  and AI weighting cannot be applied to the songwriting share.
- **Liability for uploads differs between the UK and the EU.** The UK never adopted the EU's Article 17 "upload
  filter" rule; a UK host is protected if it removes infringing material promptly once told about it. If Trusic serves
  EU listeners, Article 17 probably applies there, as does the EU's Digital Services Act. Audio fingerprinting is
  needed either way.
- **The Online Safety Act very likely applies,** because users upload audio, artwork and text that other users see.
  That means risk assessments within three months of launch. Copyright infringement is _not_ covered by that Act.
- **AI rules mostly bind the generators, not Trusic.** The EU AI Act requires AI music generators to mark their
  output from August 2026. There is no UK AI-labelling law for music. PRS will not register songs with no human
  author, and the UK government proposes ending copyright for works made wholly by computer.
- **Next steps:** an hour with PRS for Music's online licensing team and a music-licensing lawyer. The checklist at
  the end lists what to ask.

## 1. Recording rights and songwriting rights, plainly

| Right                                                     | What it covers                                                                                                                                                                                                                                                                                      | Usually owned by                                  | Who licenses it to a streaming service                                                                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sound recording copyright** (the "master")              | The specific recorded audio                                                                                                                                                                                                                                                                         | The record label, or the artist if self-releasing | The owner, directly. PPL, the UK body for recordings, does **not** handle on-demand streaming ([PPL](https://www.ppluk.com/licensing/playing-music-online/other-online-licences/))                      |
| **Performers' rights**                                    | Each musician's right to control on-demand access to recordings of their performance ("making available right", section 182CA of the Copyright, Designs and Patents Act 1988) ([legislation.gov.uk](https://www.legislation.gov.uk/ukpga/1988/48/part/II/chapter/2/crossheading/performers-rights)) | Each performer, including session players         | Normally passed on by contract to whoever owns the recording                                                                                                                                            |
| **Musical work and lyrics** (the "song" or "composition") | The melody, harmony and words, however they are recorded                                                                                                                                                                                                                                            | Songwriters and their music publishers            | **PRS for Music**, which combines PRS (performing and "communication to the public" rights) and MCPS (mechanical, or copying, rights) ([PRS](https://www2.prsformusic.com/licences/using-music-online)) |
| **Lyrics display** (showing the words on screen)          | The lyrics as text                                                                                                                                                                                                                                                                                  | Publishers                                        | Separate licences, usually through lyric aggregators such as LyricFind or Musixmatch ([LyricFind on Wikipedia](https://en.wikipedia.org/wiki/LyricFind))                                                |
| **Artwork**                                               | Cover images                                                                                                                                                                                                                                                                                        | Whoever made them                                 | The uploader, via Trusic's terms                                                                                                                                                                        |

### What a direct upload does and doesn't cover

| Situation                                                                 | Recording                                                                                                                                       | Song                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Band wrote and recorded it; no member belongs to PRS or a similar society | Licensed by the uploader through Trusic's artist agreement                                                                                      | Can also be licensed directly by the writers, **if all co-writers agree**                                                                                                                                                                                                                                           |
| Band wrote it, but a writer is a PRS member                               | Licensed by the uploader                                                                                                                        | **Not** the uploader's to license. PRS members assign these rights to PRS, which says it "is the owner of the rights in your works" ([PRS](https://www.prsformusic.com/-/media/files/prs-for-music/royalties/live-performance-royalties/explanatory-notes-and-faq.ashx)). Covered by Trusic's PRS for Music licence |
| A cover of someone else's song                                            | Licensed by the uploader                                                                                                                        | Needs Trusic's PRS for Music licence (and permission from the publisher for changed lyrics or arrangements; a lawyer should confirm)                                                                                                                                                                                |
| A track that samples another recording                                    | The uploader's part only                                                                                                                        | Needs clearance from both the sampled recording's owner and the sampled song's owner. Blanket licences are not designed for this; a lawyer should confirm                                                                                                                                                           |
| Artist signed to a label or exclusive distributor                         | Probably **not** the uploader's to license                                                                                                      | As above                                                                                                                                                                                                                                                                                                            |
| Session musicians played on it                                            | Needs their making-available consent ([s.182CA](https://www.legislation.gov.uk/ukpga/1988/48/part/II/chapter/2/crossheading/performers-rights)) | No change                                                                                                                                                                                                                                                                                                           |
| Fully AI-generated                                                        | Copyright status is uncertain (see section 5)                                                                                                   | PRS will not register works with no human author ([PRS AI policy](https://www.prsformusic.com/-/media/files/prs-for-music/works/prs-for-music-and-artificial-intelligence-policy.pdf))                                                                                                                              |

**Practical upshot.** Trusic's artist agreement should:

- grant Trusic a licence to the recording;
- confirm that every performer has consented;
- confirm that samples are cleared;
- confirm that the uploader isn't bound by a label deal that prevents this;
- declare the songwriters, their society memberships and their IPI numbers (the ID number each songwriter has at a
  collecting society);
- confirm the AI declaration;
- include an indemnity (a promise to cover Trusic's losses if any of this turns out to be untrue).

## 2. PRS for Music and MCPS

### Which licence

- **Small UK-only services:** the **Digital Music Services Licence** started on 1 October 2025. It replaced the older
  Limited Online Music Licences (LOML and LOML+). It covers UK-only download stores, on-demand and interactive
  streaming services, and karaoke services with **up to £500,000 a year of revenue**
  ([PRS consultation response](https://www.prsformusic.com/-/media/files/prs-for-music/consultations/digital-music-services-licence-consultation-response-summary.pdf),
  [commercial terms](https://www2.prsformusic.com/-/media/files/prs-for-music/licensing/online-licensing/2025/digital-music-services-licence-commercial-terms.pdf)).
  At £9.16 net a month, £500,000 a year is about 4,550 paying subscribers on average.
- **Above £500,000, or outside the UK:** a bespoke licence negotiated with PRS for Music
  ([PRS, digital platforms](https://www.prsformusic.com/get-a-music-licence/digital-platforms-and-streaming)).
- **For the EU and other territories:** song rights are licensed across several countries through hubs. ICE is a joint
  venture of PRS, STIM and GEMA (the UK, Swedish and German societies), which also works with major publishers'
  catalogue hubs such as SOLAR and PEDL ([ICE](https://www.iceservices.com/services/licensing/)). EU law sets the
  rules for this kind of multi-country licensing ([Directive 2014/26/EU, Title III](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:32014L0026)).

### How the published tariff works

| Item                    | Digital Music Services Licence                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basis                   | "Applicable revenue": all revenue from the service **less VAT**, including subscriptions, advertising and sponsorship                                                                                                                                       |
| Rate for music services | **16%** of applicable revenue (25% for karaoke)                                                                                                                                                                                                             |
| Minimum per stream      | The fee is the **greater** of the 16% and a per-stream minimum multiplied by the total streams in the licence year. Search summaries of the PDF give **0.43p per on-demand stream** (45,000 streams for the £193 minimum). **Unverified**: confirm with PRS |
| Annual minimum          | **£193 + VAT** per type of service (for example, downloads and streaming each pay one); this applies to a streaming service with under £1,206.25 of revenue                                                                                                 |
| PRS/MCPS split          | PRS for Music splits streaming income 50/50 between PRS and MCPS internally ([PRS online licensing policy](https://www2.prsformusic.com/-/media/files/prs-for-music/royalties/mcps-updates/5-online-licensing-policyupdated062024))                         |

Sources: [commercial terms PDF](https://www2.prsformusic.com/-/media/files/prs-for-music/licensing/online-licensing/2025/digital-music-services-licence-commercial-terms.pdf),
[consultation response](https://www.prsformusic.com/-/media/files/prs-for-music/consultations/digital-music-services-licence-consultation-response-summary.pdf).

**For comparison:** PRS's 2009 online streaming tariff was 10.5% of revenue with a 0.085p per-stream minimum
([MBW](https://www.musicbusinessworldwide.com/prs-negotiates-10-5-streaming-royalty-rate-for-members/)). The rates
in big services' bespoke deals are confidential.

**Two definitions to check:**

- PRS deducts only VAT from revenue, while Trusic's "net revenue" also deducts payment and app-store fees. On
  app-store subscriptions, songwriters' 16% may therefore be a larger share of what Trusic actually keeps.
- PRS's definition of a "stream" may not match Trusic's 30-second rule.

### Reporting

PRS consulted on requiring "financial and detailed music usage information" and on how often it should be reported
([consultation response](https://www.prsformusic.com/-/media/files/prs-for-music/consultations/digital-music-services-licence-consultation-response-summary.pdf)).
I could not see the final reporting schedule. Expect to send a regular revenue statement plus a usage report listing
each track, its identifiers and its stream count.

The industry format for these reports is DDEX's Digital Sales Report (DSR), which DSPs use to report usage to
collecting societies and publishers ([DDEX](https://dsr3.ddex.net/digital-sales-report-message-suite:-part-3-basic-audio-profile/1-introduction/)).
The identifiers are:

- **ISRC**, which identifies a recording;
- **ISWC**, which identifies a song.

Trusic's upload form should collect both, plus songwriter names and splits. PRS can only pay writers whose songs it
can match.

## 3. How songwriting royalties fit with the 80/20 split

### What the rest of the industry does

- Spotify says it pays out about 70% of revenue to rights holders
  ([Spotify Loud & Clear](https://loudandclear.byspotify.com/faq/)).
- MIDiA Research estimated the split as 30% to the platform, 56% to the recording side and 14% to the songwriting
  side ([Variety](https://variety.com/2025/digital/news/spotify-paid-4-billion-music-songwriters-struggling-1236334752/)).
- The UK competition regulator (CMA) found the songwriting share of streaming rose from 8% in 2008 to about 15% in
  2021 ([CMA final report](https://assets.publishing.service.gov.uk/media/6384f43ee90e077898ccb48e/Music_and_streaming_final_report.pdf)).

In other words, songwriting money is normally **inside** the share that goes to music makers, alongside the
recording share. It is not paid on top.

### The options, with a £9.16 subscription

£10.99 including 20% VAT is £9.16 before VAT ([GOV.UK VAT rates](https://www.gov.uk/guidance/rates-of-vat-on-different-goods-and-services)).
The table uses PRS's published 16%. All amounts are per subscriber per month, in whole pence.

| Option                                            | Songwriting (PRS) | Recording artists | Trusic      | Comment                                                                                                                                                                                         |
| ------------------------------------------------- | ----------------- | ----------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Inside the artists' 80%**                    | £1.47 (16%)       | £5.86 (64%)       | £1.83 (20%) | Matches industry practice; Trusic's 20% is untouched. "80% to music makers" stays true, but recording artists see 64%                                                                           |
| **B. Off the top, then 80/20**                    | £1.47 (16%)       | £6.15 (67%)       | £1.54 (17%) | Shares the cost; simple to explain: "80/20 of what's left after songwriters are paid"                                                                                                           |
| **C. Out of Trusic's 20%**                        | £1.47 (16%)       | £7.33 (80%)       | £0.36 (4%)  | Keeps the 80% promise literally, but leaves Trusic about 36p per subscriber to run the business                                                                                                 |
| **D. Charge it to the tracks that use PRS songs** | Depends           | Depends           | 20%         | Fairest in principle: a non-member writing their own songs isn't charged for covers they don't play. Only works if PRS agrees to scale its fee to the share of streams that are its songs (ask) |

A useful point for artists: if the uploader **wrote** the song and is a PRS member, much of the songwriting share
comes back to them through PRS (minus PRS's costs and any publisher's cut). Under option A, a self-writing artist
loses less than the table suggests.

### The per-stream minimum risk (unverified figure)

If the per-stream minimum really is 0.43p, PRS's fee is the greater of 16% of revenue and 0.43p × streams, worked out
over the year for the whole service:

| Average streams per paying subscriber per month | 200   | 340   | 500   | 1,000 |
| ----------------------------------------------- | ----- | ----- | ----- | ----- |
| 0.43p × streams                                 | £0.86 | £1.46 | £2.15 | £4.30 |
| Fee payable (greater of that and £1.47)         | £1.47 | £1.47 | £2.15 | £4.30 |
| As a share of £9.16                             | 16%   | 16%   | 23%   | 47%   |

**Free listening makes this worse.** Free-tier streams would probably count towards the total but bring in no revenue.
Model Trusic's own expected listening against the confirmed figure before setting prices or launching a free tier.

### Clashes with Trusic's payout rules

- **PRS pays songwriters by its own rules,** based on the usage reports. Trusic's user-centric and human-weighted
  logic cannot reach the songwriting share.
- **AI-scored songs still collect from PRS.** An AI-assisted song registered with PRS collects songwriting royalties
  at the full rate, whatever its Trusic score.
- **Fully AI songs can't be registered,** so they collect nothing from PRS
  ([PRS AI policy](https://www.prsformusic.com/-/media/files/prs-for-music/works/prs-for-music-and-artificial-intelligence-policy.pdf)).
  But under a flat 16% licence Trusic may still pay the fee on the revenue those streams generate. Ask whether the
  fee can be scaled down for streams of works PRS doesn't represent.
- **The 80/20 promise.** Decide whether "80% to artists" means "80% to music makers (recording plus songwriting)",
  and update `PRODUCT.md` and the public copy so listeners aren't misled.

## 4. Other UK and EU obligations

### Copyright takedowns and liability for uploads: UK

- **The UK did not adopt Article 17** of the EU's 2019 Copyright in the Digital Single Market (DSM) Directive. The
  minister said so in January 2020 ([Lexology](https://www.lexology.com/library/detail.aspx?g=9e1a5448-d128-4902-9420-4bf89a154d59)).
- **The UK "hosting defence".** A platform storing users' content is protected from copyright claims if it doesn't
  know about the infringement and removes it "expeditiously" once it does. This is regulation 19 of the Electronic
  Commerce (EC Directive) Regulations 2002 ([Pinsent Masons](https://www.pinsentmasons.com/out-law/guides/the-uks-e-commerce-regulations)).
- **Two conditions could weaken that protection.** It doesn't apply where uploaders act "under the authority or
  control" of the platform, and it can be lost where the platform plays an "active role"
  ([Lexology](https://www.lexology.com/library/detail.aspx?g=80ecb013-521f-4903-a5b1-fa3f614d42d0)). Trusic
  curates, recommends and pays uploaders, so ask a lawyer how that affects its position.
- **What to build:** a takedown form, a counter-notice and appeal route, a repeat-infringer policy, and audio
  fingerprinting at upload (Audible Magic, Pex/Vobile and ACRCloud all offer it; see
  [ai-detection.md](ai-detection.md)).

### Liability for uploads: EU listeners

- **Article 17 applies, through each EU country's own law, to "online content-sharing service providers".** These are
  services whose main purpose includes storing and giving the public access to large amounts of copyright works
  uploaded by users, organised and promoted for profit
  ([European Commission guidance](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A52021DC0288)).
  Trusic probably fits that description for its EU listeners; a lawyer should confirm.
- **What it requires:** such services are directly liable unless they make best efforts to get licences, and best
  efforts to keep notified works off the service. They must also remove infringing works quickly and keep them down.
- **A lighter regime for new, small services:** under three years in the EU and under €10 million turnover. They
  don't have to keep works off the service ("staydown") unless they pass 5 million unique monthly visitors
  ([Commission guidance](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A52021DC0288)).
- **The EU's top court upheld Article 17 in April 2022,** subject to safeguards for lawful uploads
  ([Bird & Bird on C-401/19](https://www.twobirds.com/en/insights/2022/poland/the-cjeu-judgment-in-the-polish-challenge-case)).
- **The Digital Services Act (DSA)** applies to any online intermediary serving EU users, wherever it is based. A
  hosting service needs a notice-and-action system, must give reasons when it removes content, and needs an EU legal
  representative if it has no EU establishment. Micro and small companies are exempt from some of the heavier platform
  duties ([European Commission Q&A](https://digital-strategy.ec.europa.eu/en/faqs/digital-services-act-questions-and-answers),
  [Ropes & Gray](https://www.ropesgray.com/en/insights/viewpoints/102j0f0/reminder-eu-digital-services-act-applies-beyond-very-large-online-service-prov)).
- **Songs:** serving the EU also needs multi-territory song licences (see section 2).

### Online Safety Act 2023 (UK)

- **Trusic is very likely in scope.** The Act covers "user-to-user services": services where content uploaded by one
  user can be encountered by others. The definition expressly includes music ([Travers Smith](https://www.traverssmith.com/knowledge/knowledge-container/navigating-the-online-safety-act/)).
  Uploaded tracks, artwork, lyrics, profiles and any comments all count.
- **Main duties:**
  - an **illegal content risk assessment**. Existing services had to finish theirs by 16 March 2025; a new service
    must complete it within three months of launch ([Lewis Silkin](https://www.lewissilkin.com/insights/2025/03/03/illegal-harms-assessments-ofcom-launches-enforcement-programme-102k2ia));
  - a **children's access assessment**;
  - if children are likely to use Trusic, a **children's risk assessment** and protections ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/08/the-online-safety-act-enters-phase-2)).
- **What the Act doesn't cover:** copyright infringement is excluded from its definition of illegal content
  ([section 59](https://www.legislation.gov.uk/ukpga/2023/50/section/59)), so it doesn't replace the takedown process
  above.
- **First step:** use Ofcom's [Regulation Checker](https://www.ofcom.org.uk/os-toolkit/regulation-checker/regulation-checker)
  and its [guidance for small services](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/helping-small-services-navigate-the-online-safety-act).

### AI-content labelling

- **EU AI Act, Article 50.** Since 2 August 2026, providers of generative AI must mark synthetic audio in a
  machine-readable, detectable way. People who publish "deepfakes" (realistic imitations of real people) must disclose
  them; for evidently artistic works this is a lighter duty
  ([AI Act Article 50](https://artificialintelligenceact.eu/article/50/)).
- **Later deadline for existing generators.** The EU's "digital omnibus" amendment (adopted June 2026) gives systems
  already on the market until 2 December 2026 to add marking
  ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/),
  [Cloud Security Alliance](https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-article50-watermarking-deadline/)).
  The Commission published a voluntary Code of Practice on marking and labelling on 10 June 2026
  ([European Commission](https://digital-strategy.ec.europa.eu/en/news/commission-publishes-code-practice-marking-and-labelling-ai-generated-content)).
- **What this means for Trusic.** Trusic is neither the AI provider nor, normally, the deployer, so these duties fall
  on generators and artists. Two exceptions:
  - if Trusic adds its own AI features (for example, an AI DJ voice), it becomes a provider or deployer itself;
  - Trusic's labels help EU artists meet their own disclosure duty, and the generators' marks give Trusic's detector
    something to read.
- **UK:** I found no UK law requiring AI-generated music to be labelled. The government's March 2026 report proposed
  to "work with industry" on transparency rather than legislate ([Reed Smith](https://www.reedsmith.com/articles/uk-copyright-and-ai-report-the-opt-out-is-dead-but-what-comes-next/)).
  Whether a wrong "Human-made" label could break consumer protection law is a question for the lawyer.

### Also on the horizon

The UK's new consumer subscription rules (renewal reminders, easy cancellation, a 14-day cooling-off period on
renewal) are due in January 2027 ([Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2026/04/subscription-contracts),
[Wiggin](https://wiggin.co.uk/insight/digital-markets-competition-and-consumer-act-tracker/)).

## 5. UK policy context (briefly)

### Streaming pay

- **2021:** a Commons committee called for a "complete reset" of streaming
  ([UK Parliament](https://committees.parliament.uk/committee/378/digital-culture-media-and-sport-committee/news/156593/mps-call-for-a-complete-reset-of-music-streaming-to-fairly-reward-performers-and-creators/)).
- **2022:** the CMA declined a full market investigation
  ([CMA](https://assets.publishing.service.gov.uk/media/6384f43ee90e077898ccb48e/Music_and_streaming_final_report.pdf)).
- **2024:** the government ruled out broadcast-style "equitable remuneration" for on-demand streaming
  ([Music Ally](https://musically.com/2024/02/20/uk-government-rules-out-broadcast-style-equitable-remuneration-for-music/)).
  "Equitable remuneration" means a guaranteed share for performers, collected for them by a collecting society, as
  happens with radio.
- **July 2024:** a voluntary transparency code took effect, with a formal review due in 2026
  ([Music Ally](https://musically.com/2024/08/01/uk-music-industrys-streaming-transparency-code-takes-effect/)).
- **July 2025:** the government's creator remuneration working group produced voluntary label commitments: ignoring
  unpaid advances for pre-2000 signings, £75 per-day payments for songwriters at label sessions, and higher session
  fees ([Hansard](https://hansard.parliament.uk/commons/2025-07-22/debates/25072227000013/CreatorRemunerationFromMusicStreamingLabel-LedPrinciples),
  [Music Ally](https://musically.com/2025/07/22/uk-government-reveals-streaming-reforms-focusing-on-label-commitments/)).

There is no legislation on streaming pay. Trusic's user-centric, transparent model fits the direction of this debate.

### AI and copyright

- **December 2024:** a consultation proposed letting AI firms train on copyright works unless owners opt out.
- **2025:** the Data (Use and Access) Act 2025 required the government to report.
- **18 March 2026:** the report dropped the opt-out as the preferred option. It now has **no preferred option** and
  will gather more evidence. It also proposed removing copyright protection for works generated wholly by computer
  (section 9(3) of the 1988 Act), keeping it for AI-assisted works
  ([Lewis Silkin](https://www.lewissilkin.com/insights/2026/03/19/unfinished-works-uk-government-kicks-ai-copyright-reform-down-the-road-102mnep),
  [HSF Kramer](https://www.hsfkramer.com/notes/ip/2026-03/uk-government-report-on-copyright-and-ai-concludes-more-evidence-is-needed-although-s9-3-cdpa-could-go)).

If that change happens, a score-100 track may have no copyright at all. That strengthens the case for paying it
nothing.

## 6. Questions to take to a music lawyer

**Rights and the artist agreement**

1. What must the artist agreement include? For example: the recording licence, performer consents, sample clearance,
   no conflicting label deal, songwriter and society details, the AI declaration, an indemnity, and the penalties for
   a false declaration.
2. Can we take direct song licences from writers who aren't in any collecting society? How do we check that they
   aren't?
3. How should we handle covers, changed lyrics, samples and remixes?
4. Can we show lyrics that artists wrote themselves without a lyric-aggregator licence?

**PRS for Music**

5. Is the Digital Music Services Licence right for launch? What is the confirmed per-stream minimum, and do free-tier
   streams count?
6. Does PRS's "stream" match our 30-second rule? Is "applicable revenue" before or after app-store and payment fees?
7. Can the fee be scaled down for streams of works PRS doesn't represent, including fully AI works it won't register?
8. What usage reporting format and schedule are required? What happens to money for unmatched works?
9. What happens when we pass £500,000 a year, or add EU listeners (ICE, publisher hubs)?

**The 80/20 promise**

10. Can we describe the split as "80% to music makers" if songwriting comes out of it? What wording avoids misleading
    consumers or artists?

**Platform liability**

11. Do we keep the UK hosting defence, given we curate, recommend and pay uploaders?
12. For EU listeners, are we an "online content-sharing service provider" under Article 17? Which EU country's rules
    apply? Do we need an EU representative under the DSA?
13. What should our takedown, counter-notice and repeat-infringer policy say? Do we need a US DMCA agent if we
    serve US listeners?

**Online safety, AI and consumer law**

14. Which Online Safety Act assessments do we need, and when? Must we check users' ages?
15. Could a wrong AI label, or a detection-driven score change, expose us to claims from artists or consumers? What
    must our appeal process guarantee?
16. Do any of our own planned AI features bring us under the EU AI Act?

**Money**

17. VAT on subscriptions sold in the UK and EU; self-billing invoices and tax forms for artist payouts; and the
    January 2027 subscription rules.

### Specialists to look for

- **Music-industry lawyer with streaming-service (DSP) licensing experience:** someone who has negotiated with PRS for
  Music, ICE, labels and distributors. This is the most important hire.
- **Copyright and platform-liability lawyer:** hosting defence, Article 17, the DSA and takedown processes. Often the
  same firm's technology, media and telecoms team.
- **Online safety or regulatory specialist:** Online Safety Act and Ofcom compliance.
- **Data protection advisor:** GDPR for listening data and artist identity checks (KYC).
- **Tax and payments advisor:** VAT, app-store billing and paying artists.
- **Royalty administration or metadata consultant:** DDEX reporting, ISRC/ISWC matching and PRS reporting
  operations.

## Sources

PRS for Music and collective licensing

- PRS, Digital Music Services Licence commercial terms (October 2025): https://www2.prsformusic.com/-/media/files/prs-for-music/licensing/online-licensing/2025/digital-music-services-licence-commercial-terms.pdf
- PRS, Digital Music Services Licence consultation response: https://www.prsformusic.com/-/media/files/prs-for-music/consultations/digital-music-services-licence-consultation-response-summary.pdf
- PRS, Digital platforms and streaming licences: https://www.prsformusic.com/get-a-music-licence/digital-platforms-and-streaming
- PRS, Licences for using music online: https://www2.prsformusic.com/licences/using-music-online
- PRS, Online licensing policy (PRS/MCPS split): https://www2.prsformusic.com/-/media/files/prs-for-music/royalties/mcps-updates/5-online-licensing-policyupdated062024
- PRS, explanatory notes on members' rights: https://www.prsformusic.com/-/media/files/prs-for-music/royalties/live-performance-royalties/explanatory-notes-and-faq.ashx
- PRS, PRS for Music and Artificial Intelligence (October 2025): https://www.prsformusic.com/-/media/files/prs-for-music/works/prs-for-music-and-artificial-intelligence-policy.pdf
- MBW, PRS 10.5% streaming rate (2009): https://www.musicbusinessworldwide.com/prs-negotiates-10-5-streaming-royalty-rate-for-members/
- ICE online licensing: https://www.iceservices.com/services/licensing/
- Directive 2014/26/EU (collective rights management): https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:32014L0026
- PPL, other online licences: https://www.ppluk.com/licensing/playing-music-online/other-online-licences/
- DDEX, Digital Sales Report standard: https://dsr3.ddex.net/digital-sales-report-message-suite:-part-3-basic-audio-profile/1-introduction/
- LyricFind (Wikipedia): https://en.wikipedia.org/wiki/LyricFind

Revenue splits

- CMA, Music and streaming final report (November 2022): https://assets.publishing.service.gov.uk/media/6384f43ee90e077898ccb48e/Music_and_streaming_final_report.pdf
- Spotify Loud & Clear FAQ: https://loudandclear.byspotify.com/faq/
- Variety, Spotify payments to publishers (MIDiA split): https://variety.com/2025/digital/news/spotify-paid-4-billion-music-songwriters-struggling-1236334752/
- GOV.UK, VAT rates: https://www.gov.uk/guidance/rates-of-vat-on-different-goods-and-services

Legislation and liability

- Copyright, Designs and Patents Act 1988, performers' rights: https://www.legislation.gov.uk/ukpga/1988/48/part/II/chapter/2/crossheading/performers-rights
- Lexology, UK will not implement the Copyright Directive: https://www.lexology.com/library/detail.aspx?g=9e1a5448-d128-4902-9420-4bf89a154d59
- Pinsent Masons, UK E-Commerce Regulations: https://www.pinsentmasons.com/out-law/guides/the-uks-e-commerce-regulations
- Lexology, High Court on the hosting defence: https://www.lexology.com/library/detail.aspx?g=80ecb013-521f-4903-a5b1-fa3f614d42d0
- European Commission, guidance on Article 17: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A52021DC0288
- Bird & Bird, CJEU C-401/19: https://www.twobirds.com/en/insights/2022/poland/the-cjeu-judgment-in-the-polish-challenge-case
- European Commission, DSA Q&A: https://digital-strategy.ec.europa.eu/en/faqs/digital-services-act-questions-and-answers
- Ropes & Gray, DSA applies beyond very large platforms: https://www.ropesgray.com/en/insights/viewpoints/102j0f0/reminder-eu-digital-services-act-applies-beyond-very-large-online-service-prov
- Online Safety Act 2023, section 59: https://www.legislation.gov.uk/ukpga/2023/50/section/59
- Travers Smith, navigating the Online Safety Act: https://www.traverssmith.com/knowledge/knowledge-container/navigating-the-online-safety-act/
- Lewis Silkin, illegal harms assessments: https://www.lewissilkin.com/insights/2025/03/03/illegal-harms-assessments-ofcom-launches-enforcement-programme-102k2ia
- Mayer Brown, Online Safety Act phase 2: https://www.mayerbrown.com/en/insights/publications/2025/08/the-online-safety-act-enters-phase-2
- Ofcom, Regulation Checker: https://www.ofcom.org.uk/os-toolkit/regulation-checker/regulation-checker
- Ofcom, helping small services: https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/helping-small-services-navigate-the-online-safety-act
- EU AI Act, Article 50: https://artificialintelligenceact.eu/article/50/
- Gibson Dunn, AI Act omnibus agreement: https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/
- Cloud Security Alliance, Article 50 watermarking deadline: https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-article50-watermarking-deadline/
- European Commission, Code of Practice on marking and labelling AI content: https://digital-strategy.ec.europa.eu/en/news/commission-publishes-code-practice-marking-and-labelling-ai-generated-content
- Taylor Wessing, subscription contracts regime: https://www.taylorwessing.com/en/insights-and-events/insights/2026/04/subscription-contracts
- Wiggin, DMCC Act tracker: https://wiggin.co.uk/insight/digital-markets-competition-and-consumer-act-tracker/

UK policy

- UK Parliament, "complete reset" of streaming (2021): https://committees.parliament.uk/committee/378/digital-culture-media-and-sport-committee/news/156593/mps-call-for-a-complete-reset-of-music-streaming-to-fairly-reward-performers-and-creators/
- Music Ally, equitable remuneration ruled out (February 2024): https://musically.com/2024/02/20/uk-government-rules-out-broadcast-style-equitable-remuneration-for-music/
- Music Ally, transparency code takes effect (August 2024): https://musically.com/2024/08/01/uk-music-industrys-streaming-transparency-code-takes-effect/
- Hansard, creator remuneration statement (22 July 2025): https://hansard.parliament.uk/commons/2025-07-22/debates/25072227000013/CreatorRemunerationFromMusicStreamingLabel-LedPrinciples
- Music Ally, UK streaming reforms (July 2025): https://musically.com/2025/07/22/uk-government-reveals-streaming-reforms-focusing-on-label-commitments/
- Lewis Silkin, UK AI copyright report (March 2026): https://www.lewissilkin.com/insights/2026/03/19/unfinished-works-uk-government-kicks-ai-copyright-reform-down-the-road-102mnep
- HSF Kramer, report and section 9(3): https://www.hsfkramer.com/notes/ip/2026-03/uk-government-report-on-copyright-and-ai-concludes-more-evidence-is-needed-although-s9-3-cdpa-could-go
- Reed Smith, UK copyright and AI report: https://www.reedsmith.com/articles/uk-copyright-and-ai-report-the-opt-out-is-dead-but-what-comes-next/
