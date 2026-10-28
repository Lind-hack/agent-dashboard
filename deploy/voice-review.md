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
