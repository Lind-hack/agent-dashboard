# Core voice review — C-MVSNIWZR

Recovered OpenCode commit `aa5ea9f523d3b5d49e821f45d917d8b7003bc31c` from the
separate `/opt/agent-dashboard` Git repository. PR #8 (`e62f3a4`) had merged the other
worktree's version, omitting Piper and its language-aware server routes. Reviewed both
voice implementations and combined their useful changes without replacing the media-element
playback needed by phones.

Changes after review:

- Restored the local Albanian Piper engine, server route, types and native dependencies.
- Corrected per-phoneme padding against Piper's reference Python runtime. Limited ONNX threads
  and reserved queue slots before loading to bound concurrent cold-start requests.
- Preserved transcription retry/timeouts while adding Whisper's detected language to Core context.
- Requested the first spoken sentence before prefetching later ones to reduce startup latency.
- Reported device speech errors as failures. Hands-free pauses after failed playback, keeping the
  answer and any proposed action visible. An interrupted answer cannot clear a newer answer's pulse.
- Calibrated the microphone floor from quiet samples so immediate speech is not treated as noise.
- Required a complete affirmative before executing proposed work, including Albanian confirmation.

Validation: regression tests cover phoneme IDs, language routing, speech interruption, failed device
fallback and ambiguous confirmations. Typecheck and production build pass. No lint script is defined.
The build retains two existing filesystem tracing warnings in collector/memory code.
Authenticated candidate API checks generated WAV audio in English and Albanian, obtained Core replies
in both languages, and transcribed generated clips through Whisper. The Albanian short-clip transcript
was imperfect; this is not a guarantee of transcription accuracy or perceived voice quality.
A mobile Chromium check played real Piper audio and returned to microphone listening automatically,
with no page errors or horizontal overflow. Its Core text response and microphone were fixtures.
Real iOS/Android microphone, ringer/Bluetooth routing and Albanian pronunciation need a device check.

The production dependency audit reports three existing high advisories through sharp in
Kokoro/Transformers, with no automatic dependency fix available. The restored eSpeak package adds
no reported advisory. This work does not upgrade the existing speech dependency chain.

## Follow-up: user still receives text without speech

The earlier browser check used `--autoplay-policy=no-user-gesture-required` and a typed
request, so it could not prove that phone recording followed by ordinary playback worked.
A persisted `ad.voiceReplies=0` also suppressed synthesis with only an icon indicating mute.

- Talk now starts each session with a visible Voice on state; muting applies to that session.
- Starting a turn stops old media before priming it; previously begin() immediately paused the
  unlock play() that had just started. Audio priming now contains real silent PCM samples. Chromium accepted the previous empty WAV,
  so the old file is not a proven cause of the reported phone failure.
- A browser NotAllowedError preserves the loaded answer and exposes Hear reply. That button
  invokes play() synchronously from the user tap, then the same sentence queue continues.
- Albanian phonemization restores original clause punctuation, keeps word boundaries and uses
  Unicode NFD phonemes, following Piper's upstream phonemizer contract. It keeps the Albanian
  model rather than substituting English pronunciation.
- Regression checks cover a saved mute preference, autoplay recovery, nonempty priming audio,
  and Albanian punctuation. Device-specific sound routing still needs the user's phone/browser.

Archify was invoked to map the request sequence. The specification is retained in the deployment
review artifacts, but the installed skill lacks its core template and standalone validators;
its diagnostic is internal/unclassified. No validated HTML diagram is claimed.

## Continuous speech and latency follow-up

The old client split every answer into separate WAV requests/source changes. Under VPS contention,
rendering could run slower than playback, producing gaps between pieces. An uncached 147-character
Albanian sample took 23.3 seconds to produce 7.3 seconds of audio during the baseline check.

Core replies now prefer a matching native device voice, sent as one complete utterance with zero
TTS HTTP calls. Otherwise the voice API prepares one full clip in the turn response; the client
plays that clip without fetching or swapping sources between sentences. The caption is revealed
on the actual playback-start event. Blocked/muted/failed playback still leaves readable text and
the existing recovery controls. Core local synthesis skips a remote Orpheus probe, avoiding its
15-second timeout on an unavailable provider. Native speech that never starts is abandoned after
1.5 seconds so fallback is not held by the much longer utterance timeout.

Albanian uses eSpeak's phoneme-only buffer instead of synthesize_ipa(), which also synthesized
unneeded audio. In an isolated comparison, phonemization dropped from 1462 ms to 15 ms with matching
phonemes (the fast API uses clause separators, removed by the existing per-clause processing).
Full inference still shares CPU with the VPS's other jobs; this is not a claim of universal
subsecond end-to-end response time. Model generation, Whisper, network and Core inference remain
part of the first-audio latency. Unrelated running jobs were not stopped or reprioritized.

## Faster first audio (October 29)

Reviewed correctness, simplicity, module boundaries, authentication/credentials, cancellation and
latency. The old post-speech path could wait for remote context, slow model reasoning and CPU
speech sequentially. This change prefetches context, lowers silence detection to 650 ms, hedges
slow model replies after 250 ms, and uses existing NVIDIA credentials for GPU English speech.
Invalid/empty model responses cannot win the race. Provider failures fall back to existing speech;
no credential reaches the browser. Model-specific reasoning options remain compatible.

Albanian keeps its language-specific Piper model, now in a bounded worker thread so loading and
inference cannot stall unrelated web requests. No new dependency is added. Actions still require
confirmation; stale remote context is refreshed and jobs are read fresh.

Recorded microphone tests include real transcription, Core inference and audible WAV playback,
without an autoplay override. Candidate runs measured approximately 2.8–4.9 seconds from speech
ending to playback, with one 11-second outlier; the server measured only 2 seconds in that outlier.
These results demonstrate improvement but do not establish consistently human-speed conversation.
Albanian on the shared CPU and historical memory searches can still take longer. Deployment
evidence retains the live recorded-question measurement separately. No subsecond claim is made.

Regression checks cover provider WAV validation/cancellation/circuit behavior and prompt backup
model cancellation, plus the existing voice and confirmation checks. Production build and
typecheck are required before activation. No lint script exists.
