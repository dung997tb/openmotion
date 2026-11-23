> See [source and execution notes](../PROVENANCE.md).

# 2D Sprite Animation (video-to-spritesheet pipeline)

> **Asset reference for game-generation.** Use for ANY animated 2D asset —
> characters, objects, effects — delivered as a spritesheet. The pipeline:
> key-pose image → configured image-to-video model (discovered via `openmotion_media_use`,
> generated via `openmotion_assets_use` after stated cost and approval) → frame extraction
> (ffmpeg) → frame selection → per-frame background removal / chroma key → spritesheet
> assembly. Style: the key-pose prompt embeds the STYLE FORMULA per
> `game-stylization.md` — open it first, as for every asset.

Why video instead of generating frames directly: an image model drawing N
frames independently cannot hold the character identical across frames —
limbs, proportions and details drift, and the animation "boils". A video
model animates ONE image, so every frame is the same character by
construction. We then sample the video back into frames. This trades prompt
control for temporal coherence — the right trade for game sprites.

---

## Pipeline at a glance

| # | Stage | Tool | Output |
|---|---|---|---|
| 1 | Source image | manifest / user / `game-stylization.md` pipeline | character or object image |
| 2 | Key-pose image | `openmotion_media_use` (discover) → `openmotion_assets_use` (`action: "generate"`, `modality: "image"`, pinned `references`) | full-body pose at the action's mid/peak phase |
| 3 | Animation video | `openmotion_media_use` (discover I2V model with positive `maxInputImages`) → `openmotion_assets_use` (`action: "generate"`, `modality: "video"`, pinned key-pose `references`) | short clip (e.g. 4–5 s, 720p), matching key-pose aspect ratio per model schema |
| 4 | Raw frames | ffmpeg | every frame of the video as PNG |
| 5 | Frame selection | local script | `frame_count` frames (2–64, default 25), evenly spaced, first + last always kept |
| 6 | Alpha | configured transparent-background edit or local chroma-keying, per frame | transparent-background PNGs |
| 7 | Spritesheet | local assembly | grid PNG, metadata encoded in the filename |

Hard rules (each one is a known failure when violated):

- **The subject is NEVER cropped.** Full body in frame at every stage, with
  visible empty margin above the head and below the feet. A key pose, a video
  frame, or a sheet cell that clips the subject is a rejected asset —
  regenerate, do not "fix in post".
- **Discover the live video model before submitting.** Call `openmotion_media_use` (`action: "models"`, `modality: "video"`) to pick an available image-to-video model and inspect its supported duration, resolution, aspect ratio, and reference-image limits. Never invent a model ID or silently substitute an unapproved model.
- **Loop closure vs one-shot.** If the discovered video model supports both start and end frame references, pass the SAME key-pose image as start and end frame **only for looping actions** (never for one-shots like attack/death/hit/cast). When the active I2V model only accepts a single first-frame reference, describe an in-place cyclic motion returning to the starting stance and verify the wrap point during frame selection (or trim to the cleanest loop window).
- **First and last extracted frames are always kept** in the selection. For
  loops whose start and end match identically, drop the last frame at sheet
  assembly (see stage 7) — kept during selection, excluded from the sheet.
- **Background removal runs on FRAMES, one by one** — never on the video.

---

## Stage 1 — Source image

What goes in: the character/asset image from the manifest (generated per
`game-stylization.md`, FORMULA embedded) or supplied by the user. Character,
object, or both in one shot — the pipeline does not care what the subject is,
only that it is fully visible.

If the source already crops the subject (feet cut by the canvas, head at the
edge), it cannot enter stage 2 as-is — regenerate or outpaint it to full body
first. A cropped input guarantees a cropped animation.

## Stage 2 — Key-pose generation (configured reference-capable image model)

**What:** produce the subject in the *mid/peak phase* of the requested action.
The video model animates *around* the image it is given; starting from the
action's characteristic phase is what makes a short clip read as that
action.

- `idle` → slight lean / relaxed breathing stance
- `walk` / `run` → mid-stride, one leg forward
- `attack` → wind-up (weapon raised / fist drawn back)
- `jump` → crouched anticipation
- `cast` / `effect` → energy gathered at the hands / pre-release
- flames, water, props → the shape at its most typical, not its extreme

**How:** after discovery via `openmotion_media_use` (`action: "models"`, `modality: "image"`) and spending approval, call `openmotion_assets_use` (`action: "generate"`, `modality: "image"`) with a configured image-edit model (`supportsImageReference: true`), the source image pinned in `references`, the STYLE FORMULA verbatim in the prompt, plus the pose instruction. The prompt MUST demand:

- *full body / full object in frame* — head to feet visible;
- *empty margin above and below the subject* — the motion needs headroom and
  footroom (a jump goes up, a stride extends down; without reserve space the
  video model crops);
- a *clean, uniform, uncluttered background* — it is removed per-frame later,
  and a busy background degrades the matte. **The background color must NOT
  appear anywhere on the subject** — pick it by looking at the subject's
  palette first (green character → magenta background, red/pink character →
  green, neutral subject → any saturated key color per `game-stylization.md`).
  A shared color is how the remover eats holes into the subject or leaves
  background patches stuck to it.

**Why a separate key pose at all:** feeding the neutral source straight into
video gives generic swaying. The key pose is the steering wheel — it is the
single biggest lever on what action the video actually performs.

Gate: subject fully inside the frame with visible margin top and bottom,
nothing clipped, style matches the FORMULA. Cropped or off-style → reroll
(regeneration budget per SKILL.md: 2 attempts, then best-of).

Prompt shape (pass only schema-supported parameters for the chosen model):

```text
<STYLE FORMULA>. <single key-pose instruction>. Full body in frame with empty margin above the head and below the feet. Clean uniform <key color> background.
```

## Stage 3 — Video generation (configured image-to-video model)

**Key parameters (map to the discovered video model's actual schema):**

| Param | Guidance |
|---|---|
| model | discovered video model from `openmotion_media_use` (`modality: "video"`) with positive `maxInputImages` (or `mode: "image-to-video"`; reserve `supportsImageReference: true` for image-model editing) |
| duration | shortest supported cycle (typically 4–5 s) |
| resolution | 720p (or model's clean standard tier) |
| ratio / aspect_ratio | follow the discovered model's first-frame ratio contract (see below: omit `parameters.ratio` or pass `"adaptive"` for first-frame-adaptive models; pass the key-pose ratio explicitly only when the model requires an explicit ratio) |
| start frame | pinned `assetId`/`versionId` of the stage-2 key pose in `references` — always |
| end frame | the SAME image **only if supported by the model AND the action is a loop** |

**Match the discovered model's first-frame ratio contract:**
- **First-frame-adaptive models** (such as Cloud/account `wan-2.7` or `doubao-seedance-2-5-260628`, whose schema derives output geometry from the input image): **omit `parameters.ratio` or set `parameters.ratio: "adaptive"`**. Passing a fixed ratio like `"16:9"` or `"1:1"` conflicts with the first-frame input and is rejected by parameter resolution.
- **Explicit-ratio models** (providers that do not derive geometry from the input image and expose a fixed aspect-ratio parameter): read the ratio off the key-pose image and pass it explicitly (a 1:1 pose → `"1:1"`) so the model does not fall back to a mismatched default ratio (such as 3:4) that reframes the input and crops top/bottom margins.

**Why start = end for loops:** the video model is forced to return to the
exact starting pose, so frame 1 and the final frame are identical and the
cycle closes seamlessly. Without it the loop visibly "jumps" at the wrap
point. **Why not for one-shots:** an attack that must end where it began
turns the strike into a rubber-band; one-shot actions get only the start
frame and play once (`once` in the filename, see stage 7).

**Prompt = ONE action + a mandatory negative block.** The positive part
describes the MOTION and nothing else — not the subject (the image already
is the subject), not the mood, not the scene: "smooth idle breathing cycle,
subtle weight shift", "full walk cycle in place", "single sword slash, fast
wind-up, sharp strike, follow-through". Exactly one action per video; any
second verb in the prompt is a defect.

**The negative block is NOT optional and is appended to EVERY animation
prompt**, because the model fills the fixed 4 seconds with improvisation
wherever the prompt leaves freedom — a positive instruction alone only says
what to do and stays silent about everything else. Two parts:

1. *Camera lock (always):* `camera locked, no camera movement, no zoom,
   subject stays fully in frame, plain static background` — camera drift and
   zoom are the top causes of unusable frames.
2. *Prop & action inertia (always; expand when the subject holds anything):*
   `the character performs ONLY this action, nothing else happens`. If the
   subject carries a prop with an obvious action of its own (weapon, tool,
   instrument), name the prop and freeze it explicitly: `the <prop> stays
   inert and is never used — no firing, no muzzle flash, no swinging, no
   raising it`. Props carry their own learned scenarios (a raised pistol
   "wants" to fire, a bat "wants" to swing); an unfilled cycle duration plus
   an unconstrained prop is exactly how a run cycle gains a gunshot
   mid-video. Shipped failure: a 4 s "run cycle in place" where the model
   fired the held pistol twice — the negative block above is what prevents
   it.
3. *Facing lock (always):* `the subject keeps facing the SAME direction for
   the entire video — never turns around, never rotates toward or away from
   the camera, no head turns past the shoulder`. Game sprites are generated
   facing ONE direction (the engine mirrors them for the other side); a
   mid-video turn poisons every frame after it — half the selected frames
   face the wrong way and the sheet is garbage. Turning is the model's
   favorite filler for loopable actions (idle "look around", walk "glance
   back"), so the lock is mandatory even when the action seems
direction-neutral. The ONLY exception: the requested action IS a turn —
   then it is a one-shot (start frame only, `once`), never a loop.

Prompt shape (submit via `openmotion_assets_use` `action: "generate"`, `modality: "video"`, pinning the key pose in `references`, setting `generate_audio: false` when supported, and following the discovered model's ratio contract — omitting `parameters.ratio` or using `"adaptive"` for first-frame-adaptive models, or passing the key-pose ratio explicitly only when the model requires one):

```text
<one action>. Camera locked, no camera movement, no zoom, subject stays fully in frame, plain static background. The character performs ONLY this action; nothing else happens. The subject keeps facing the same direction for the entire video.
```

Gate before moving on: scrub the video — subject never leaves the frame or
gets clipped, no camera motion, **facing direction is identical in the first
and last frame and never flips in between**, loop wrap is invisible (for
loops). Fail → regenerate the video (adjust the motion prompt) before
burning time on frames.

## Stage 4 — Frame extraction (ffmpeg)

Download the result video into the workspace, then dump every frame:

```bash
ffmpeg -i anim.mp4 -vsync 0 raw/%04d.png
```

4 s at native fps yields ~96–120 PNGs. Extract ALL of them — selection
happens in stage 5 on the full set, never via ffmpeg's own fps filter (it
cannot guarantee the exact first/last frames are kept).

## Stage 5 — Frame selection (`frame_count`)

**What:** pick `frame_count` frames, evenly spaced across the full range,
**always including the first and the last** extracted frame.

```python
import numpy as np
idx = np.unique(np.round(np.linspace(1, total, frame_count)).astype(int))
```

(`linspace` endpoints guarantee first + last; `unique` guards tiny counts.)

**Range:** 2–64. **Default: 25** when nothing in the context says otherwise.

**Choosing by context** — the question is "how much does the silhouette
change per beat of this action":

| Action / context | frame_count |
|---|---|
| idle, breathing, hover, flame flicker | 8–16 |
| walk / run cycle — pixel art | 8–12 |
| walk / run cycle — HD sprites | 16–24 |
| attack, hit, jump, one-shot actions | 10–20 |
| fluid motion: cape, water, fire burst, magic FX (HD) | 24–48 |
| unclear / no signal | 25 |

**Why fewer is often better:** every frame is a sheet cell — memory, texture
size, and background-removal calls all scale linearly with it. A walk cycle
reads perfectly at 8 frames (the entire 8/16-bit era proves it); 60 frames of
walk is waste. Spend frames only where the silhouette genuinely changes fast.

## Stage 6 — Background removal (per frame)

Because stage 2 placed the subject on a clean uniform key color absent from the
subject's palette, prefer **deterministic local chroma-keying** on each extracted
PNG frame (zero per-frame generation cost, fast, reproducible, and clears enclosed
key-colored holes such as gaps between limbs). When an image-level transparent-background
edit capability is configured and approved in OpenMotion, you may run it per frame
instead (via `openmotion_assets_use` after approval) for complex edges.

**Why per-frame and not the whole video:** the per-image matte is computed
independently and cleanly per frame; the video path optimizes for temporal
smoothness and smears edges across frames — on sprites that shows up as a
halo that flickers.

Process every selected frame to completion (fire-and-forget does
NOT apply — the sheet needs every frame). Gate: spot-check 3–4 frames at
2× zoom — no leftover background patches, no eaten thin parts (blades, hair,
flame tips). A bad matte on the same spot across frames means the stage-2
background was too busy or **shared a color with the subject** → fix there
(change the key color), not by hand-editing mattes.

## Stage 7 — Spritesheet assembly

All transparent frames are composed into ONE grid PNG:

1. **Union bounding box.** Compute the bounding box of non-transparent pixels
   across ALL frames, take the union, crop every frame to that SAME box. This
   anchors the subject identically in every cell — per-frame cropping makes
   the sprite jitter in-game.
2. **Uniform cell.** Pad the union box to a uniform cell size; anchor
   bottom-center (feet stay planted on the ground line across frames).
3. **Loop de-duplication.** For looping animations drop the LAST frame from
   the sheet — it is identical to frame 1 (start = end), and playing both
   makes the loop stall for one beat at the wrap. One-shot animations keep
   every frame.
4. **Grid, not strip.** Lay frames into a near-square grid (24 frames →
   5×5 with the tail row partial). A horizontal strip of 64 cells exceeds
   GPU texture limits. **Total sheet dimension ≤ 4096 px on either side** —
   if it does not fit, downscale the cells, never drop frames.
5. **PNG with alpha**, no compression artifacts.

**Metadata lives in the filename** — no sidecar JSON. The consumer (stage-3
game code) parses everything it needs from the name:

```
{asset}_{action}_f{count}_{cellW}x{cellH}_g{cols}x{rows}_fps{n}_{loop|once}.png

knight_idle_f15_192x256_g4x4_fps12_loop.png
slime_attack_f12_160x160_g4x3_fps14_once.png
torch_flame_f10_96x192_g4x3_fps10_loop.png
```

`f` = frames actually in the sheet (after loop de-dup); `g` = grid; cells
fill left-to-right, top-to-bottom; trailing cells of the last row are empty
and transparent.

**Playback fps** is a recommendation baked into the name: pixel art 8–12,
HD sprites 12–24, **default 12**. Note fps is decoupled from `frame_count` —
15 frames at 12 fps is a 1.25 s loop; pick fps for the feel of the motion,
not to "use up" the frames.

---

## Pixel-art sprites — the quality envelope

Small pixel sprites pass through the same pipeline but only look good
**inside these limits** — choose parameters from them, not from the HD
defaults:

- The video is still generated at 720p from a full-size key pose; the
  pixel-art look is applied at the END — downscale the assembled cells with
  **nearest-neighbor** (no smoothing, no anti-aliasing) to the target size
  from the manifest (e.g. 32/48/64 px).
- **frame_count 8–16, no more.** At small sizes extra frames add shimmer,
  not smoothness — sub-pixel drift between video frames turns into visible
  pixel crawl.
- **Subtle, readable motions** survive the downscale (sway, bob, stride,
  blink). Fine detail motion (fingers, facial expression, thin particles)
  dies below ~64 px — do not request it.
- fps 8–12. Higher framerates at small sizes read as noise.

If the manifest asks for a pixel sprite whose action violates this envelope
(e.g. a 32 px character with a 48-frame cloth simulation), simplify the
action to fit the envelope — that is a planning fix, not a generation fix.

---

## Failure recovery

| Symptom | Cause | Fix |
|---|---|---|
| Subject clipped in the video | key pose lacked top/bottom margin, or camera drifted | back to stage 2: more margin; add "camera locked" to the video prompt |
| Loop visibly jumps at wrap | end frame not passed, or model ignored it | re-check start=end were both set; regenerate video |
| One-shot looks rubber-banded | end frame was passed on a non-loop action | drop the end frame, regenerate |
| Sprite jitters in-game | per-frame cropping instead of union bbox | reassemble the sheet with the union box |
| Flickering halo around edges | busy key-pose background | back to stage 2: flat uniform background |
| Holes in the subject / background patches stuck to it | background color also present on the subject | back to stage 2: pick a key color absent from the subject's palette |
| Subject turns around / changes facing mid-video | facing lock missing from the negative block, or the action invites turning | regenerate with the facing lock; rephrase the action to be direction-neutral ("walk in place" not "walk around") |
| Pixel sprite shimmers | too many frames / AA downscale | cut frame_count to 8–12; nearest-neighbor only |
| Loop stalls one beat at wrap | duplicated last frame left in the sheet | drop the final frame (loops only) |

Regeneration budget per SKILL.md: 2 attempts per stage, then take the best
and compensate downstream.
