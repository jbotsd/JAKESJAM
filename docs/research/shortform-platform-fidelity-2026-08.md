# Short-Form Platform Fidelity & Styling Research — 2026-08

Research date: 2026-08-10. Scope: what makes GAMING short-form video succeed on TikTok / YouTube Shorts / Instagram Reels in 2025-2026, specifically to inform visual-fidelity and styling decisions for the JAKESJAM daily shorts pipeline (1080x1920 30fps, CRF18 x264, letterboxed gameplay band between gold hairlines on obsidian, Space Grotesk hook, 52px word-timed captions, VO at -14 LUFS, 9-17s).

Confidence rubric:
- **[HIGH]** — platform documentation, named first-party case study (dev/community-manager postmortem, GDC talk), or mechanism that is verifiable by construction.
- **[MED]** — consistent multi-source creator/marketing consensus, or credible single-source data without independent replication.
- **[LOW]** — plausible but thinly sourced (SEO-blog claims, unreplicated numbers). Treat as "test, don't trust".

A general caveat: much of the "retention statistics" ecosystem is SEO content by caption/clip-tool vendors. Where a claim only exists in that ecosystem it is tagged MED at best, even when several such blogs agree (they copy each other). Platform docs, GameDiscoverCo, howtomarketagame.com (Chris Zukowski), Derek Lieu, and Victoria Tran are the highest-quality sources found.

---

## 1. ENCODING / FIDELITY — what survives the re-encode

### Findings

**All three platforms re-encode everything; your job is to hand them a clean, high-bitrate, correctly-tagged 1080x1920 source.** [HIGH]

- **YouTube (official docs):** MP4, H.264, moov atom at front ("Fast Start"), no edit lists. 1080p SDR: **8 Mbps at 24-30fps, 12 Mbps at 48-60fps**. Audio AAC-LC/Opus, 48 kHz, 384 kbps stereo. "Content should be encoded and uploaded in the same frame rate it was recorded." [HIGH]
  - https://support.google.com/youtube/answer/1722171
- **TikTok re-encode reality:** server-side transcode to H.264 at roughly **1,500-2,500 kbps for 1080p delivery** (800-1,200 kbps at 720p), with temporal noise reduction and 4:2:0 chroma subsampling. Desktop/browser uploads retain more quality than mobile-app uploads; keep clips **under 60s** to avoid the most aggressive CDN tier; enable the HD/high-quality upload toggle; 4K is accepted but always resized internally — **1080x1920 is TikTok's practical ceiling**. [MED — tikhub teardown + multi-source consensus, not official]
  - https://tikhub.eu/en/tiktok-video-quality
  - https://www.totalmedia.ai/en/resources/blog/fix-tiktok-video-compression-quality
  - https://store.hollyland.com/blogs/creator-hub/tiktok-video-quality-settings
- **Upload bitrate consensus for surviving re-encode:** export 1080x1920 at **10-20 Mbps H.264** (TikTok/Reels), 15-20 Mbps for Shorts. CRF18 x264 on neon-on-black content will typically land well inside this band, so **CRF18 is adequate but CRF16-17 with a maxrate cap is safer for dark gradient scenes** (see §2). [MED]
  - https://slidycreator.com/blog/tiktok-video-quality-after-upload/
  - https://www.mariosomedia.com/blog/youtubeshortsexportsettings
- **Instagram Reels:** 1080x1920, H.264 MP4, 30fps standard; third-party testing through 2025 found **8-12 Mbps** produced sharper post-re-encode results; AAC 256 kbps 48 kHz; max 4 GB. No useful official encoding page exists. [MED]
  - https://www.stayabundant.com/blog/best-instagram-reels-export-settings
  - https://blog.hootsuite.com/instagram-video-sizes/
- **The 4K/VP9 trick is real on YouTube only:** uploads at 1440p+ get transcoded with VP9/AV1 instead of the ancient H.264 ladder, and the 1080p stream derived from a 4K master is visibly sharper — this is the single biggest fidelity lever available on Shorts, and it matters most for exactly our content class (thin bright lines, text). Sources conflict on whether *upscaled* 1080p sources benefit: creator-side consensus is that the codec assignment is resolution-triggered and upscales do benefit; one guide claims YouTube detects upscales. **Worth an A/B with our footage.** TikTok and Reels do NOT reward >1080p uploads. [MED]
  - https://techguides.yt/guides/how-to-force-vp9-on-youtube/
  - https://magichour.ai/blog/best-video-formats-for-youtube
  - https://www.nearstream.us/blog/upload-youtube-shorts-high-quality-4k-vertical
- **30 vs 60fps:** every gaming-specific guide recommends **60fps for gameplay/fast motion** ("anywhere smoothness is the content"); TikTok serves 60fps to capable devices; Reels sometimes serves 60fps content at 30. **No rigorous study ties fps to retention** — the claim "smoothness improves engagement" is directional, not measured. 60fps needs ~50% more bitrate at 1080p. For a 30fps-rendered wireframe game the honest answer: 60fps is the platform-native feel for shooter content and cheap insurance on Shorts/TikTok, but it is a MED-confidence gain, not a proven one. [MED]
  - https://www.clipspeed.ai/blog/video-resolution-guide-shorts-reels-tiktok.html
  - https://www.shortsgenerator.ai/blog/what-frame-rate-does-tiktok-use/
- **Color tagging is a silent killer:** untagged or mismatched colorspace/range metadata is the classic cause of "washed out / shifted after upload". Pixels must actually be BT.709 limited-range 4:2:0 AND tagged `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`. Canvas-rendered content is sRGB full-range by default — this pipeline is at real risk of a full→limited mismatch. [HIGH — mechanism verifiable]
  - https://www.canva.dev/blog/engineering/a-journey-through-colour-space-with-ffmpeg/
  - https://gist.github.com/drakemccabe/8a40984ebc3e3eb9cd00ef8bf912d093
- HDR: TikTok/Reels mangle HDR uploads unpredictably (the notorious iPhone-HDR "washed out" complaints); our pipeline is SDR — stay SDR. [MED]

### Verdict for our pipeline
1080x1920 CRF18 x264 30fps **holds up** as a baseline on TikTok/Reels. The wins available: correct BT.709 tagging (free), CRF16-17 + maxrate for dark scenes (cheap), a 2160x3840 upscaled master for Shorts (test), and a 60fps variant for gameplay-heavy clips (test).

---

## 2. DARK FOOTAGE — banding and phone legibility

### Findings

- **Banding comes from low-bitrate 8-bit gradients, not from darkness itself.** A *flat solid* near-black plate (our obsidian) is actually encoder-friendly — zero gradient, zero banding. The danger zone is **soft glow falloff around neon lines on dark background**: that is the textbook banding surface, and TikTok's 1.5-2.5 Mbps re-encode plus temporal noise reduction will posterize it. [HIGH for mechanism, MED for platform specifics]
  - https://www.totalmedia.ai/en/resources/blog/fix-tiktok-video-compression-quality
  - https://tikhub.eu/en/tiktok-video-quality
- **Debanding before upload has a trap:** ffmpeg `gradfun` is explicitly documented as a *playback* filter — "should not be used prior to lossy compression, because compression tends to lose the dither and bring back the bands." The `deband` filter + a small amount of **temporally-stable fine grain** (grain acts as natural dither and survives one generation of re-encode better than pure dither) is the standard pre-upload mitigation. Keep grain subtle — noise is also what encoders punish hardest. [HIGH for gradfun caveat (official ffmpeg docs), MED for grain tactic]
  - https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Video/gradfun.html
  - https://forum.doom9.org/archive/index.php/t-153589.html
- **Lift the floor before upload.** Consistent creator advice for dark footage: raise brightness/shadows pre-upload because (a) phones in bright rooms + auto-brightness crush shadows, (b) platform re-encodes crush them again, and (c) TikTok's app-side playback (Data Saver, secondary compression on app downloads) is worse than web. No one publishes a measured "lift by N%" — this is craft knowledge, not data. [MED]
  - https://slidycreator.com/blog/tiktok-video-quality-after-upload/
  - https://www.mediamedic.studio/how-to-make-dark-videos-visible/
- **Chroma subsampling halves color resolution:** at 4:2:0, a 2px teal line on black keeps its luma edge but loses half its color detail. Thin colored wireframes must carry their contrast in **luminance**, not just hue — bright cores (near-white centers with colored glow) survive; dim saturated lines smear. [HIGH — mechanism]
- No dev-authored postmortem was found from Hades/Dead Cells/V Rising/Lethal Company teams specifically about dark-clip grading for shorts. Observationally, horror (very dark) clips thrive on Reels (see §8 platform notes), so darkness is not a reach penalty — it is purely a fidelity/legibility engineering problem. [LOW]

### Verdict for our pipeline
Our footage is *rendered*, i.e. noise-free — the best possible starting point. Do three things: keep the plate mathematically flat (single RGB value, no vignette), lift the in-game shadow floor slightly so nothing meaningful lives below ~16/255, and thicken/brighten glow cores so lines survive 2 Mbps H.264. Add faint grain only over gradient regions if banding is observed in a re-download test.

---

## 3. LETTERBOX vs FULL-BLEED

### Findings

- **Raw letterboxed 16:9 in a 9:16 frame underperforms — strong multi-source consensus, no controlled study.** Marketing-side sources uniformly report that black-bar uploads read as "repurposed YouTube content" and get less distribution; completion rate (the actual ranked metric) favors frames that fill the screen. [MED — directionally consistent, mechanism plausible via completion rate, but all evidence is observational]
  - https://admanage.ai/blog/tiktok-ad-specs
  - https://recurpost.com/tiktok-scheduler/tiktok-video-sizes/
- **Derek Lieu (professional game-trailer editor, TikTok-active):** widescreen trailers with letterboxing "just feel like they don't belong" and read as ads; his practice is **reframing every shot so the main subject is visible in 9:16**. This is the highest-credibility styling source found for game footage specifically. [HIGH as expert practice]
  - https://www.derek-lieu.com/blog/2022/6/6/tiktok-for-game-trailer-editors
- **Zukowski's counterweight — polish itself is a liability:** "the more production value/quality I put into the video the worse it actually performs"; homemade-feel phone-recordings-of-monitors outperform produced content; TikTok/Reels audiences punish anything that smells like an ad. A *designed plate* (branded hairlines, typeset hook, URL mark) sits closer to "ad" than "homemade" on this axis. [HIGH as sourced practitioner finding; MED as generalization]
  - https://howtomarketagame.com/2022/02/07/seven-great-tips-for-marketing-your-indie-game-on-tiktok/
- **Nuance that matters for us:** the algorithm penalty attaches to *non-native-feeling frames and low screen coverage*, not to the literal presence of design. Our upload IS a native 1080x1920 file; the risk is (a) a ~608px-tall gameplay band = only ~32% of frame given to the thing people came to watch, and (b) "ad smell". Successful gameplay accounts overwhelmingly ship full-bleed or near-full-bleed vertical crops with text *overlaid on* gameplay, not gameplay boxed between text zones. [MED — observational]

### Verdict for our pipeline
Keep the brand grammar, lose the band. Reframe/zoom the 1920x1080 render so the action fills **≥70% of frame height** (e.g., a 1080x1440+ active region — a punched-in crop, not a squeeze), hairlines pushed to the edges of that region, captions overlaid. Full 16:9 context is a trailer need, not a shorts need — per Lieu, shorts are "1-3 ideas", and a tight crop on the fight IS the idea.

---

## 4. CAPTIONS / TYPE

### Findings

- **Word-by-word (karaoke) captions are the dominant retention style** across every 2025-2026 caption study found (all vendor-published — OpusClip, EMAX, RenderCut, etc. — so MED ceiling): word-timed captions give the eye a new fixation point every 250-400 ms, which matters most in seconds 1.5-3.5 where drop-off concentrates; claimed watch-time lifts of 12-40% are unaudited vendor numbers. Phrase-chunks are preferred only for tutorial/explainer pacing. Our word-timed captions are the right call. [MED]
  - https://emax.studio/blog/word-by-word-ai-captions-vs-static-subtitles
  - https://www.opus.pro/blog/best-caption-presets-styles-boost-retention
  - https://rendercut.io/best-caption-styles-retention-engagement
- **Size: the consensus optimum at 1080x1920 is 60-75px (3.1-3.9% of frame height); ~44px is the floor for body text.** Our 52px is above floor but below optimum — on a 6" phone that's roughly 3.5mm x-height, readable but not glanceable. Bold weights (700-900) test ~31% better than light/medium at equal size; "60px Bold ≥ 75px Light". Keep lines to **24-28 characters**. [MED — consistent multi-source, no primary study]
  - https://blitzcutai.com/blog/best-caption-size-youtube-shorts-2026
  - https://www.itnavideo.com/blog/caption-font-size-guide-reels
  - https://vsubtitle.com/subtitle-font-size-and-reading-speed-2026/
- **Contrast treatment:** bone-white on our dark footage is high-contrast already, but captions overlaid on *gameplay* (post-§3 change) need a stroke or shadow; standard practice is a 2-4px soft black shadow/outline rather than boxed backgrounds. [MED]
- **Safe zones (2026, third-party overlay guides — platform UI shifts quarterly):**
  - TikTok: keep ~**140px clear at top, ~400px at bottom, 60px left, 180px right** (right rail = like/comment/share stack; bottom = caption/music/CTA rows; Jan-2026 added a bottom-right playlist button).
  - Reels: ~**220px top, 310-450px bottom** (audio-attribution row expanded late 2025).
  - Shorts: similar right-rail and bottom-band occlusion, slightly smaller.
  - Net cross-platform text-safe box: **y ∈ [220, 1470], x ∈ [60, 900]** on a 1080x1920 canvas.
  - "If your hook text sits in the bottom third, assume it's covered." Our bottom-aligned captions + teal URL mark are partially inside all three platforms' dead zones. [MED — third-party, but consistent]
  - https://kreatli.com/guides/safe-zone-guide
  - https://zeely.ai/blog/tiktok-safe-zones/
  - https://www.ignitesocialmedia.com/content-creation/what-are-the-safe-zones-for-tiktoks-and-instagram-reels/
- 85%-sound-off claims circulate widely but originate from a 2016-era Facebook-feed stat; for TikTok/Shorts sound-ON is the norm. Captions still matter for retention (see above), just don't design as if VO is unheard. [LOW for the 85% figure]

### Verdict for our pipeline
Bump captions to **64-68px Bold**, cap lines at ~26 chars, add soft shadow, and move the whole caption block so its lowest baseline sits **≥430px above bottom edge**. Space Grotesk Bold is fine — geometric grotesques are exactly what the platform-native caption tools use.

---

## 5. HOOK CONVENTIONS

### Findings

- **Speed:** Zukowski's rule — "You have 1 second to hook people." Vendor data claims a hook in the first 2s retains ~19% more viewers; Meta's old internal stat: 65% of 3-second watchers reach 10s, 45% reach 30s. Drop-off concentrates in the first 3s. First frame must already be mid-action — never a title card, never a fade-in. [HIGH for the practice, MED for the specific percentages]
  - https://howtomarketagame.com/2022/02/07/seven-great-tips-for-marketing-your-indie-game-on-tiktok/
  - https://virvid.ai/blog/first-3-seconds-hook-faceless-shorts-2026
- **"No TikTok video should ever require context"** (Zukowski) — the clip must be self-contained; the hook line supplies all needed framing. [HIGH — sourced practitioner rule]
- **Wording patterns that recur in gaming:** challenge ("can YOU beat this"), setup/payoff punchline, "you're doing X wrong", "the game where [absurd premise]", POV framing, and premise-with-stakes. The Acorn Games 2025 case (Schrodinger's Cat Burglar, 100k+ views → 2k+ wishlists overnight) used: premise with stakes → show the unique mechanic immediately, matter-of-factly → explain while leaving a strategic question open → CTA; they measured 40% of viewers continuing after the mechanic demo. [MED-HIGH — first-party case]
  - https://acorngames.gg/blog/2025/8/10/the-indie-devs-guide-to-mastering-tiktok-in-2025
- **On-screen duration:** no measured standard; practice is the hook text persists ~3s (long enough for two reads), and Zukowski's parallel CTA rule ("BIG, clear, on screen for 3 seconds") anchors 3s as the floor for any must-read text. Our 2.6s fade is marginally fast. [MED]
- **Payoff-tease-rewind cold opens** (show the climax frame, then "wait for it" rebuild) are a general short-form convention with no gaming-specific measurement found; use when a clip has a genuine spectacle moment. [LOW]
- Lieu: "get to the point AS SOON AS POSSIBLE"; each video carries 1-3 ideas max; a dozen tiny videos beat one comprehensive one. [HIGH as expert practice]
  - https://www.derek-lieu.com/blog/2022/6/6/tiktok-for-game-trailer-editors

### Verdict for our pipeline
Keep the top hook but hold it to **3.0-3.5s**, ≤8 words, positioned below the 220px top dead zone. First frame = peak action. Adopt the premise-with-stakes formula for VO scripts and end each script leaving one question open.

---

## 6. LENGTH / LOOP

### Findings

- **Per-platform completion sweet spots (2025-2026 vendor aggregations, consistent across sources):**
  - TikTok: **21-34s** highest completion (~62% avg vs 48% for >60s); viral ceiling <60s (also avoids the harsher CDN compression tier).
  - YouTube Shorts: **15-30s** highest retention (often >80%).
  - Instagram Reels: **7-15s** highest completion (60-80%) — the shortest-attention platform.
  - [MED — no platform publishes this; multiple independent aggregators agree]
  - https://www.shortimize.com/blog/video-length-sweet-spots-tiktok-reels-shorts
  - https://www.opus.pro/blog/tiktok-length-format-retention-data
  - https://scrollscript.ai/blog/how-long-should-a-tiktok-reel-youtube-short-be
- **Loops count as separate views and completion >100% is the strongest algorithm signal.** Zukowski: aim "as short as possible, period"; "seamless satisfying loops" are underrated. Short loopable clips (9-17s) can out-earn longer clips in effective watch time. [HIGH for the practice via Zukowski; MED for mechanism details]
  - https://howtomarketagame.com/2022/02/07/seven-great-tips-for-marketing-your-indie-game-on-tiktok/
- **Loop-seam construction:** no measured study; craft consensus is (a) final frame state ≈ first frame state, (b) VO/caption sentence that grammatically wraps into the opening line, (c) no end-card dead air — end mid-energy. An end-card or fading CTA kills the loop. [MED]
- Counterpoint: Acorn Games found 1min+ videos outperformed 15s clips for *their* explainer-style content in 2025 (halfway-point signal). Length should follow content type: loop-bait stays short, mechanic-explainers can run 30-60s. [MED — single first-party case]

### Verdict for our pipeline
9-17s is correct for Reels and for loop-play everywhere. Add two variants to the weekly mix: a 21-34s TikTok-optimized cut and an occasional 45-60s mechanic-explainer. Engineer the seam: last-frame arena state matches first-frame, VO final clause hands off to the hook line, CTA lives mid-clip or as the persistent URL mark — never as an outro.

---

## 7. AUDIO

### Findings

- **VO narration is a proven conversion format for game marketing.** GameDiscoverCo's creator taxonomy identifies "Showcase Creators" (existing footage + voiceover commentary) as one of three winning archetypes, effective across genres; narrated premise-stakes clips are what produced the documented wishlist spikes in §5/§8. Raw-gameplay-audio clips win in the "Gameplay Creator" lane (friendslop/horror, streamer-adjacent). Trending-sound clips maximize *reach*, not *conversion*. [HIGH — GameDiscoverCo]
  - https://newsletter.gamediscover.co/p/everything-you-want-to-know-about
- **Trending audio has an algorithmic effect even when muted:** Zukowski reports TikTok detects trending songs and boosts the video "even when you mute the song" — i.e., attach a trending sound in-app at post time at near-zero volume under the VO. [MED — single practitioner source, widely repeated]
  - https://howtomarketagame.com/2022/02/07/seven-great-tips-for-marketing-your-indie-game-on-tiktok/
- **Voice-only is leaving value on the table:** game *sound design* is itself a documented hook — Unpacking's foley/ASMR satisfaction was central to its TikTok success (14,000+ foley effects; satisfaction-loop content). A game-SFX bed under VO adds texture and "real gameplay" authenticity. [HIGH for Unpacking case; MED as generalization]
  - https://www.victoriatran.com/writing/unpacking-tiktok-strategy
  - https://en.wikipedia.org/wiki/Unpacking_(video_game)
- **Loudness: -14 LUFS integrated with -1.0 dBTP ceiling is the 2026 cross-platform safe target.** YouTube normalizes to -14; TikTok/IG favor -10 to -12 but now scale hot masters down by *more* than the loudness gap — a -8 LUFS master ends up perceptibly quieter on TikTok than a -14 one. Our current target is correct; just confirm true-peak ceiling. [MED — consistent multi-source engineering consensus]
  - https://mrvocal.com/posts/loudness-for-shorts
  - https://apu.software/tiktok-instagram-reels-loudness/
  - https://mixinggpt.com/blog/mixing-mastering-streaming-loudness-2026
- What converts to wishlists (vs views): conversion evidence attaches to *clarity of premise + CTA + comment velocity*, not audio class. Benchmark: ~0.5% views→wishlists on a good viral clip (Zukowski: 571k views → 2,900 wishlists); Acorn: 100k views → 2k wishlists (2%) with a strong premise-stakes VO format. [MED-HIGH — two first-party datapoints]

### Verdict for our pipeline
Keep VO at -14 LUFS / -1 dBTP. Add a game-SFX bed at roughly -8 to -12 dB under the voice. On TikTok, attach a low-volume trending sound in-app at post time (never bake it — and per house rule, any baked meme SFX must be canonical recordings).

---

## 8. INDIE CASE STUDIES

**Choo-Choo Charles (Two Star Games, 2021)** — announcement trailer clip → 1.5M TikTok views, 298k likes; ~11M hashtag views; **85-90k wishlists in 2 weeks** (peak ~14k/day). What the dev credited: the *concept itself* was designed for virality (Thomas-the-Tank-Engine horror gap in meme space); Zukowski's meta-lesson: "80-90% of success depends on the type of game, not the platform tactics." Clips were straightforward gameplay/trailer footage — concept did the work, not styling. [HIGH — first-party quotes via howtomarketagame + GameDiscoverCo]
- https://howtomarketagame.com/2021/10/17/how-choo-choo-charles-earned-wishlists/
- https://www.gamedeveloper.com/game-platforms/designing-for-virality-choo-choo-charles-edition

**Unpacking (Witch Beam / Victoria Tran, 2021)** — 120k TikTok followers in 5 months; toilet-paper video 1.3M views in a week. Styling: raw-feel gameplay of item-reveals ("a new (un)familiar item appears in frame within the first few seconds"), keyword-led captions ("organize", "calming", "puzzle"), foley/ASMR satisfaction as the retention engine. Key lessons: trends were NOT the driver ("not some sort of TikTok silver bullet"); re-using the same core idea/imagery repeatedly is fine because the algorithm keeps finding new audiences. [HIGH — community strategist's own writeup]
- https://www.victoriatran.com/writing/unpacking-tiktok-strategy

**Cult of the Lamb (Massive Monster / Devolver, 2022)** — GDC 2023 talk "Growing an Internet Cult"; community grew 13k → 180k organically; 1M copies in 10 days. Credited: **meme-able moments and an iconic, instantly-readable art style planned from the start of development**; social content built on analytics + creative meme participation, cute/cursed contrast as the shareable unit. [HIGH — GDC talk + strategist thread]
- https://gdcvault.com/play/1029153/Growing-an-Internet-Cult-Cult
- https://x.com/EhJaredJ/status/1590497221149327361

**Secret Shuffle (Adriaan de Jongh)** — single TikTok: 6.9M views (+1.3M on Reels with the identical clip) → 130k installs, 2.3k purchases, zero paid spend. Credited: native meme/trend participation, native sound library, "thumbstopper" first seconds, deliberately *lower* production quality, game name integrated subtly rather than ad-styled. [HIGH — GameDiscoverCo interview with dev data]
- https://newsletter.gamediscover.co/p/winning-at-game-discovery-on-tiktok

**Schrodinger's Cat Burglar (via Acorn Games, 2025)** — first hit video 100k+ views → 2k+ wishlists overnight, repeated with fast follow-ups. Credited: premise-with-stakes structure, showing the unique mechanic immediately and matter-of-factly, longer (1min+) explainers outperforming 15s clips, rapid comment response, next-day follow-up posts. [MED-HIGH — agency writeup of own campaign]
- https://acorngames.gg/blog/2025/8/10/the-indie-devs-guide-to-mastering-tiktok-in-2025

**Cross-case pattern:** none of the documented wins credit *fidelity or styling polish* — every one credits **concept legibility, an instantly-graspable hook, native-feeling presentation, and repetition**. Styling's job is to not lose the viewer the concept earned (legible captions, filled frame, clean loop) — it is a hygiene factor, not a growth factor. [HIGH — consistent across all five cases]

**Platform-fit notes for a neon arena shooter (GameDiscoverCo):** TikTok = youngest/mainstream, friendslop & co-op thrive (lean on multiplayer chaos clips); Reels = older, visual, "cozy and/or horror does great — hugely underrated for gaming", uniquely prioritizes *shares*; Shorts = most hardcore/niche audience, comments reference other games (lean on mechanic-depth and skill-ceiling clips). Gamescom 2025 survey: 25% of players discover games on TikTok, 32% on Instagram; short-form drives awareness more than final purchase decisions. [HIGH for GameDiscoverCo characterization; MED for survey]
- https://newsletter.gamediscover.co/p/everything-you-want-to-know-about
- https://www.disobey.gg/blog/gamescom-2025-player-survey-insights

---

## CHANGES OUR PIPELINE SHOULD MAKE

Prioritized. Items 1-5 are mechanical and low-risk; 6-9 are structural; 10-12 are test programs.

1. **Tag and convert color correctly (free, do first).** Ensure the encode is genuinely BT.709 limited-range and tagged: `-vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -movflags +faststart`. Canvas renders are sRGB full-range; an untagged full→limited mismatch is the classic "washed out after upload" bug. [HIGH]
2. **Caption spec: 52px → 66px, Bold, ≤26 chars/line, +soft shadow.** Keep word-timed karaoke. Add a 3px soft black drop shadow (needed once captions sit over gameplay). Optimum band is 60-75px at 1080x1920. [MED]
3. **Enforce the cross-platform safe box: text only inside y ∈ [220, 1470], x ∈ [60, 900].** Move the caption block's lowest baseline to ≥430px above bottom; move the teal `play.elyad.io` mark up with it (bottom ~400px is occluded by platform UI on TikTok and Reels). Hook text top edge ≥220px from top. [MED]
4. **Hook hold time 2.6s → 3.2s,** ≤8 words, first frame mid-action (no fade-in from black). Script hooks as premise-with-stakes; leave one question unanswered at the end. [MED-HIGH]
5. **Encoder settings:** x264 High@4.2, CRF 16 with `-maxrate 16M -bufsize 32M`, keyint 2s (`-g 60`), AAC-LC 256-384k 48 kHz, keep every deliverable <60s. (CRF18 was adequate; CRF16 buys headroom in glow gradients for ~free at these durations.) [MED]
6. **Kill the letterband: gameplay must fill ≥70% of frame height.** Replace the 1080x608 band with a punched-in reframe (crop the 1920x1080 render to a ~900x1440-equivalent action window, scaled to 1080-wide, subject-tracked per shot à la Derek Lieu). Keep the gold hairlines as edge accents on the enlarged region — brand survives, "repurposed widescreen" signal dies. [MED directional evidence, HIGH expert practice]
7. **Dark-footage armor:** (a) keep the obsidian plate one flat RGB value — no vignette/gradient; (b) lift the in-game shadow floor so nothing meaningful sits below ~16/255 (e.g. `curves=all='0/0.02 0.5/0.52 1/1'` or an in-engine lift); (c) render wireframe lines ≥3px at 1080p with bright (near-white) cores — luma contrast survives 4:2:0, hue-only contrast doesn't; (d) if a re-download test shows banding in glow falloff, add faint temporally-varying grain (`noise=alls=2:allf=t+u`) — do NOT use gradfun pre-encode (its dither dies in re-compression). [HIGH mechanism / MED tactics]
8. **Audio: keep -14 LUFS integrated, enforce -1.0 dBTP ceiling** (`loudnorm=I=-14:TP=-1.0:LRA=11`). Add a game-SFX bed 8-12 dB under the VO — voice-only wastes the game's sound design, and foley-satisfaction is a documented retention driver. On TikTok, attach a trending sound in-app at post time at minimal volume (never baked). [MED-HIGH]
9. **Loop-seam spec:** final frame state ≈ first frame state; VO's last clause must read into the opening hook line; no outro card, no fading CTA — the persistent URL mark is the CTA. End mid-energy. [MED, cheap]
10. **Per-platform masters:** TikTok/Reels stay 1080x1920 (desktop upload + HD toggle on TikTok). For YouTube Shorts, A/B a lanczos-upscaled 2160x3840 master (`scale=2160:3840:flags=lanczos`, CRF 16, ~35-45 Mbps equivalent) to trigger the VP9/AV1 transcode — the single biggest Shorts fidelity lever for thin-line content; evidence is mixed on upscaled sources, so verify by re-downloading both versions. [MED — test]
11. **60fps A/B for gameplay-heavy clips** (Shorts + TikTok first; Reels may serve 30 regardless): render at 60, encode at CRF16 `-maxrate 20M`. Directional consensus favors 60 for shooter motion; no measured retention proof — let our own analytics decide. [MED — test]
12. **Length mix:** keep 9-17s loopers as the daily core (ideal for Reels + loop-play); add ~2/week 21-34s TikTok-optimized cuts and ~1/week 45-60s mechanic-explainer (the 2025-documented wishlist-converter format for Shorts/TikTok's more patient viewers). Platform-fit the *content*: multiplayer chaos → TikTok, visual spectacle → Reels (optimize for shares), mechanic depth/skill ceiling → Shorts. [MED-HIGH]

**Meta-finding to keep on the wall:** every documented indie shorts win credits concept legibility, instant hooks, native feel, and repetition — never fidelity polish. Items above stop us *losing* viewers the clip earned; the hook and the game's own weirdness are what earn them. Re-using the same strong idea repeatedly is explicitly fine (Unpacking).

---

## Source quality appendix

First-party / expert (weight heavily): support.google.com (YouTube encoding), howtomarketagame.com (Zukowski, 2 articles), newsletter.gamediscover.co (3 articles), victoriatran.com (Unpacking), derek-lieu.com, acorngames.gg, gdcvault.com (Cult of the Lamb), gamedeveloper.com, disobey.gg (Gamescom 2025 survey), ffmpeg filter docs, canva.dev engineering blog.

Vendor/SEO consensus (weight lightly, MED ceiling): tikhub.eu, totalmedia.ai, slidycreator.com, store.hollyland.com, stayabundant.com, blog.hootsuite.com, techguides.yt, magichour.ai, nearstream.us, blitzcutai.com, itnavideo.com, vsubtitle.com, emax.studio, opus.pro, rendercut.io, shortimize.com, scrollscript.ai, virvid.ai, kreatli.com, zeely.ai, ignitesocialmedia.com, mrvocal.com, apu.software, mixinggpt.com, clipspeed.ai, shortsgenerator.ai, mediamedic.studio.
