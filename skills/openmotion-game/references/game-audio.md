> See [source and execution notes](../PROVENANCE.md).

# Game Audio

Use this reference for music, SFX, ambience, and spoken character lines. Discover configured audio models through `openmotion_media_use`, obtain explicit spend approval, generate through `openmotion_assets_use`, and normalize/mix locally for predictable in-game loudness.

## Discover and generate via OpenMotion

Run read-only discovery before the first audio job:

1. Call `openmotion_media_use` with `action: "inspect"` and `action: "models", modality: "audio"` to see configured providers, supported modes (`text-to-audio` for music/SFX/ambience, `text-to-speech` for spoken lines), voices, and parameter schemas.
2. Choose the best configured provider/model (OpenDesign account/Cloud first when available, then configured BYOK providers), state the planned clip count, provider/model, and cost (or that cost is unknown), and obtain explicit spending approval before submitting.
3. Submit each approved clip through `openmotion_assets_use` (`action: "generate"`, `modality: "audio"`, `mode: "text-to-audio"` or `"text-to-speech"`, full `model` ID, `prompt`, `requestId`, and only schema-supported `parameters`). Poll with `action: "status"` using the original `jobId` and inspect with `action: "read"` at the pinned `assetId`/`versionId`.

Example prompts (pass only fields documented by the discovered model):

- **SFX:** `"short isolated sword impact, dry studio recording, no music"`
- **Instrumental music loop:** `"instrumental cozy forest loop, warm marimba and soft strings, no vocals"`
- **Ambience:** `"soft night rain on wooden roof, steady seamless ambience, no music, no voice"`
- **Spoken line (TTS):** `"The gate is open. Move!"` with an exact voice value returned by model discovery.

If no audio generation model is configured or approved, fall back to clean procedural Web Audio synthesis in code and record that choice in `design/assets.csv`. Never invent model IDs, forward legacy CLI flags, or direct users to external audio sites/keys outside OpenMotion.

## Scope

- Music: at most two looping tracks for a small game; one per major scene is usually enough.
- SFX: prioritize the primary verb, damage/feedback, pickup/reward, important environment, then one ambience layer. Keep small games to roughly five essential effects.
- Voice: lock one voice per speaking entity and reuse it. Keep lines short enough not to block gameplay.
- Generate independent clips concurrently, but wait for every manifest row and save its result under the project `assets/` directory.

## Prompt rules

- Describe one sound per SFX prompt. Do not request a complete mixed scene.
- State `no music`, `no voice`, or `no ambience` when isolation matters.
- Music prompts specify mood, tempo, instrumentation, and `instrumental/no vocals` when lyrics are unwanted.
- Voice prompts contain the exact line; performance direction belongs in the model-supported prompt, not undocumented flags.
- Preserve the game's STYLE FORMULA conceptually through material, era, energy, and tonal language even though audio is not visual.

## Mix and ear safety

Normalize locally before wiring clips into the game:

- Voice around -6 dBFS.
- SFX around -10 to -12 dBFS.
- Music around -18 to -20 dBFS.
- Final true peak at or below -3 dBFS.

Voice stays above SFX; SFX stays above music. Loop ambience/music in playback code and add short fades at loop boundaries. Never stack raw model outputs at full gain.

## Verification

- Every audio manifest row resolves without a 404.
- Autoplay restrictions are handled: start/resume the audio context from a user gesture.
- Pause or mute audio when the page loses focus if that matches the game profile.
- The game remains playable with sound disabled.
- Test on phone speakers as well as headphones when mobile is in scope.
