> See [source and execution notes](../PROVENANCE.md).

# Texture Tile Factory

> **Asset reference for game-generation.** Use for any seamless / tileable texture
> with PBR maps (ground, walls, floors — from a reference image or a generated one).
> The pipeline may be entered at any phase (only the seam fix, or only maps from an
> existing tile). Discover configured image-edit models via `openmotion_media_use`
> (`action: "models"`, `modality: "image"`), obtain spending approval, and generate
> through `openmotion_assets_use` (`action: "generate"` with pinned `referenceAssets`
> imported via `action: "import"`). Embed the game's STYLE FORMULA
> (see `game-stylization.md`) in every generation prompt.
>
> **The upstream post-process scripts are optional external prerequisites, not bundled in this Skill.** Locate them once per run (see **Locating the scripts** below) and
> address them as `scripts/pipeline.py`.

Turn a reference image into an engine-ready texture in one pass: a
**seamless edit** with a configured reference-capable image model (`supportsImageReference: true`) that keeps the reference's
pixels (material, style and colors survive; only the edges are reconciled),
then a **deterministic post-process** — one Python command that restores the
reference's exact palette, guarantees the tiling mathematically and computes
the PBR map set in code.

The order matters: palette transfer and seam fix run **after** the image-edit pass, because
image-edit models slightly blur the outer border and drift the palette —
the deterministic post-process cancels those two artifacts.

Work language: mirror the user's language in chat; keep all generation
prompts in English.

The user may want only part of the pipeline — seam-fix an existing tile, or
maps from an already-seamless texture. Enter at the matching phase; don't
force the full chain.

## Prerequisites

- An available OpenMotion media provider configured and authorized — for Phase 1.
- Python with `numpy` and `pillow` — Phases 2–3 run fully offline
  (report the missing dependencies if absent; install only when authorized).
- The bundled scripts reachable on disk (next section). Never retype or
  "improve" them inline — they are deterministic on purpose.

## Locating the scripts

The upstream scripts named below are not shipped in OpenMotion; a separately supplied local implementation is required:
`pipeline.py` (the whole factory: seam fix, palette transfer, PBR maps,
masked-inpaint composite) and `seamless.py` (legacy standalone seam fix).

1. Run the separately supplied local scripts from this skill's directory; verify with
   `python3 scripts/pipeline.py --help`.
2. If the file is missing, **find the skill on disk before doing anything
   else** — never fall back to rewriting the script from memory:

   Use the path supplied by the active skill loader or search the agent's installed skills
   directory for `openmotion-game/SKILL.md`, then export its parent directory.
3. Still nothing → stop and report the exact path tried; a run without
   the separately supplied local scripts is a blocker, not a license to improvise.

## Phase 0 — Reference intake

Get the reference as a real file (chat previews don't always reach the
filesystem — if the file is missing, ask the user to drop it into the
working folder). Then:

- **Square-crop** to `textures/{id}_ref.png`. If the photo has perspective
  or depth of field, crop the sharpest square region — tilted detail and
  bokeh produce mush at the seam.
- **Measure before generating.** Run the seam check (Phase 3). If the tile
  is already seamless (ratio ≈ 1.0), skip Phase 1 and run Phase 2 with
  `--trim 0`.
- Pick `{id}`: short, lowercase, one per material (`sand`, `brick_red`).

## Phase 1 — Seamless edit (configured image-edit model)

- Import the cropped reference file into Workspace Assets with `openmotion_assets_use` (`action: "import"`), and discover a configured image model that reports `supportsImageReference: true` via `openmotion_media_use` (`action: "models"`, `modality: "image"`).
- Fill the EDIT prompt template from the **Prompt templates** section below.
  `{MATERIAL}` = 3–6 concrete words from the
  reference. For structured materials (bricks, planks, tiles) append the
  alignment add-on; for references that are already tiled previews append
  the anti-repetition add-on; for stock images append the watermark add-on.
- Obtain spending approval, then submit via `openmotion_assets_use` (`action: "generate"`, `modality: "image"`, full discovered `model` ID, `prompt` containing the EDIT template + STYLE FORMULA, `referenceAssets: [{ assetId, versionId }]`, square `1:1` aspect ratio per the model's supported schema, and a stable `requestId`). Poll with `action: "status"` until complete and inspect with `action: "read"`.
- Inspect the result **next to the reference**. Check: same material, same colors, nothing added or removed,
  no restyle. If the model restyled — one retry with a stronger "do not restyle"
  clause. If a structured seam survives the retry, switch to the
  offset-inpaint pass (Prompt templates §2 below) instead of rolling
  the seed again: two identical failures mean the approach is wrong, not
  the seed.

Don't fight the border blur or palette drift in the prompt — Phase 2
cancels both deterministically.

## Phase 2 — Post-process and PBR maps

One command per material:

```bash
python3 "scripts/pipeline.py" gpt_output.png \
    -o textures/{id} --ref textures/{id}_ref.png
```

In order: trims the blurred 4% border (`--trim`, set `0` for non-GPT
input), transfers the reference's exact palette via per-channel histogram
matching (`--ref` — the color-identity guarantee), fixes the seam
mathematically (Moisan FFT periodic decomposition + 50% offset blend +
luminance flatten against tile-grid banding), then computes the PBR set
with wrap-around filters so tileability survives every map.

Writes: `{id}_seamless.png`, `{id}_basecolor.png`, `{id}_normal.png`,
`{id}_roughness.png`, `{id}_height.png`.

The seam fix has two modes (`--blend`, default `cut`):

- **`cut` (default)** — a hard minimal-error cut: the junction is covered
  by a thin donor tube whose boundaries are cyclic min-cost paths that
  dodge detailed features (stones, planks) and run through low-detail
  zones (mortar, moss). Fully sharp — no averaging anywhere except a
  3-px feather along the cut line itself. `--overlap` (default `0.25`)
  is the corridor the paths may wander in; wider gives the cut more room
  to avoid features at zero blur cost.
- **`feather`** — the legacy cross-fade. Guarantees the wrap but averages
  the band, which smears structured materials; if used there, narrow the
  band with `--overlap 0.08`.

Partial-pipeline entries map to flags of the same command:

- **Seam-fix an existing tile** (no GPT step): `--trim 0`.
- **Maps only, from an already-seamless tile**: `--trim 0 --no-seam`
  (the seam fix is skipped entirely so a verified tile is never touched).
- **Residual interior line** (a faint tone step where a §2 inpaint cross
  used to be, or a wrap ratio that stays above ~1.3): run the **double
  pass** — `np.roll` the produced `{id}_seamless.png` by 50% on both axes
  and run the same Phase 2 command again with `--trim 0`. The interior
  line lands on the wrap junction and gets cut away; the already-clean
  edges move to the interior. The script picks the donor strip
  automatically from the cleanest region of the tile, so the pass is safe
  to repeat.

## Phase 3 — Verify and package

For every produced material:

- Tile the basecolor 2×2 and **inspect with the Read tool**: features wrap,
  no grid banding, no brightness step at the joints.
- **Inspect at 1:1**: full-resolution crops of both wrap junctions (paste
  the two opposite edge strips side by side) and of the tile center.
  Downscaled previews hide translucent smears and ghost elements.
- Seam ratio (≈ 1.0 = seamless; flag anything above 1.3 and consider the
  offset-inpaint pass):

```bash
python3 - <<'EOF'
import numpy as np; from PIL import Image
a = np.asarray(Image.open("textures/{id}_basecolor.png").convert("RGB")).astype(float)
seam = abs(a[0]-a[-1]).mean() + abs(a[:,0]-a[:,-1]).mean()
base = abs(np.diff(a,axis=0)).mean() + abs(np.diff(a,axis=1)).mean()
print(round(seam/base, 2))
EOF
```

Assemble the final structure and write `textures/texture_manifest.json`
mapping each id → files produced:

```
textures/
├── texture_manifest.json   # id → {ref, seamless, maps[], seam_ratio}
├── {id}_ref.png            # square crop of the user's reference
├── {id}_seamless.png       # the tile itself
├── {id}_basecolor.png      # PBR set — drops into Unity/UE/Godot as-is
├── {id}_normal.png
├── {id}_roughness.png
└── {id}_height.png
```

Finish with a short summary table for the user: material, seam ratio,
files. Offer the natural next steps without launching them: more tile
variants against visible repetition on large areas, transition tiles
between two materials, or running the next reference through the same
pipeline.

---

## Prompt templates

All prompts go to the discovered reference-capable image model (`1:1` square ratio), with the
reference attached as a pinned Workspace Asset (`referenceAssets`, never a raw external URL).

## 1. Seamless edit (Phase 1)

```
Reproduce the attached image as faithfully as possible: the SAME {MATERIAL},
same colors, same lighting, same shapes and detail, pixel-level similarity
everywhere possible. Only make the MINIMAL adjustments needed so the image
becomes a perfectly seamless tileable texture: the left edge must continue
into the right edge and the top edge into the bottom edge with no visible
seam when tiled. Do not restyle, do not add or remove elements, do not
change colors or scale. Square 1:1.
```

`{MATERIAL}` — 3–6 concrete words from the reference
("hand-painted cracked dry earth with small grey stones").

Add-ons, appended as extra sentences when they apply:

- structured materials (bricks, planks, tiles):
  `The repeating units must be aligned so rows continue across the tile
  borders: unit boundaries at the left edge continue into the right edge
  and across top/bottom.`
- the reference is itself a tiled preview (visible periodic repetition):
  `Reduce the visible periodic repetition of distinctive features so the
  pattern feels organic.`
- stock image: `Remove any watermark text.`

## 2. Offset-inpaint pass — structured seams that survive Phase 1

Move the seam to the center and have GPT repaint only the cross:

1. `np.roll` the tile by 50% on both axes (the seam becomes a center cross).
2. Import the rolled PNG into Workspace Assets and send it to the configured image-edit model via `openmotion_assets_use` (`action: "generate"`):

```
This {MATERIAL} game texture is damaged along a vertical line and a
horizontal line through the center: some pattern elements there are faded,
semi-transparent, streaky or cut in half. Replace every damaged element
with a brand-new complete one painted in the exact same crisp style: fully
opaque, sharp confident strokes, same element size, same colors. No blur,
no soft transparent elements, no smoothing - the repaired area must be
indistinguishable in sharpness and detail from the rest of the image. Keep
everything outside the damaged lines unchanged. The final image must be a
perfectly seamless tileable texture: the left edge continues into the
right edge and the top edge continues into the bottom edge with no visible
seam when tiled. Flat even lighting, no shadows, no vignette.
```

Wording matters (live failed-run history): "repair the seam" biases the
model toward smoothing and produces blurry ghost elements along the line —
say "replace damaged elements with new complete ones" and explicitly
forbid faded/semi-transparent results. Asking the model to "keep the
borders unchanged" alone is NOT reliable — it usually repaints globally —
so the prompt also demands the whole output stay tileable.

3. **Never trust the model's full output** — it repaints the whole image
   regardless of "keep the borders unchanged", and its repaint outside the
   cross carries drift, ghosts and translucent smears (live failed runs of
   this skill). Finish with the **masked composite** built into the
   script — one command:

```bash
python3 "scripts/pipeline.py" {id}_rolled.png \
    --inpaint gpt_cross_output.png -o textures/{id} --ref textures/{id}_ref.png
```

   It takes from the model's output **only the center cross**, bounded by
   cyclic min-cut paths laid where original and repaint agree (the SD
   seamless-tile extensions do the same with a real inpaint mask — this
   emulates it for models without mask support); ~70% of the tile stays
   the untouched original. The composite is unrolled (the repaired cross
   becomes the wrap), then the normal post-process runs.

The edge-seam ratio alone can look perfect while an interior defect hides
in the patched zone — Phase 3 inspection must include **1:1 (100% zoom)
crops** of the wrap areas and the tile center; a downscaled 2×2 preview
hides translucent smears (a live failed run of this skill).
