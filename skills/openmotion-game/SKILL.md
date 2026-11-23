---
name: openmotion-game
description: Build, remix, validate and locally publish playable browser games through the OpenMotion game tools, including deterministic server-authoritative multiplayer rooms and consistent art direction.
---

# OpenMotion Game Studio

Turn a brief into a verified local browser game. Resume an explicit game id; otherwise call `openmotion_game_create` (**always pass `style: "3d"` on any 3D brief** so vendored Three.js is scaffolded) and read `openmotion_game_get` before editing. Local templates are read-only (use Remix). Starter drafts (`plan.md`/`verification.md`) are inputs to revise, never completed acceptance evidence. OpenMotion has no internal game Agent.

## Hard Boundaries

- **Self-contained local runtime:** Relative paths only; never add external CDNs, remote fonts, unbundled npm/WASM packages, or third-party asset URLs.
- **Deterministic `logic.js`:** Follow the 6-export VM contract in [game-flow.md](references/game-flow.md) (no `import`/`require`, `Math.random()`, or `Date.now()`). Keep all feel and balance tunables in one top `config` block. Preserve the received kit's loop, input layer, `window.__omGame` hook, `?debug` overlay, and `pilot`/`referenceRoute` pattern ([kits](references/game-genres.md#2-starter-kits)).
- **Media & spend:** Prefer bundled CC0 and procedural art. Paid media requires live model discovery (`openmotion_media_use` `inspect`/`models`), stated cost (or unknown), and user spending approval before `openmotion_assets_use` (`generate`/`status`/`read`). No automatic paid retry. Place approved binaries into `assets/` via authorized local file ops (never text/base64), or fall back to procedural art and state the limit. Never invent tool names, prices, or direct users to external provider APIs.
- **Browser safety:** Never operate, attach to, or capture the user's visible browser, Chrome profile, or desktop. Use only server-owned `openmotion_game_playtest` and `openmotion_game_capture_cover`.

## Intake and Routing

Ask **at most two short questions** only when missing: solo/co-op/versus mode and local publication consent. Pick the routing tuple before `design/plan.md`:

| Dimension | Selection Rule | Reference |
|---|---|---|
| **3C & Visuals** | Pick 1: `discrete-ui` / `realtime-2d` / `realtime-3d` | [game-3c-modules.md](references/game-3c-modules.md) (apply your section) |
| **Core Loop** | Pick 1 primary (+ ≤ 1 secondary): `puzzle-pressure` / `strategy-combo` / `skill-flow` / `progression-rng` | [game-genres.md](references/game-genres.md) |
| **Track** | **`Full Track`** if ANY of: `realtime-3d`, `puzzle-pressure`, `strategy-combo`, multiplayer, multi-level (including playable ads), or paid media. **`Fast Track`** otherwise. | [game-gates.md](references/game-gates.md) |
| **Playable Ad** | When brief says **Format: playable ad**: overrides title, session, end-card, no-storage ban, single-file inline `index.html`, and §10/§11 QA/delivery | [game-playable-ad.md](references/game-playable-ad.md) |
| **Blind-Spot Lookup** | When hitting 3D physics/drift, FPS aim/recoil, solvable puzzle dealing, or WFC/A* triggers | [game-lookup.md](references/game-lookup.md) |

**Precedence:** Track routing here and in `game-gates.md` governs the run; **Fast Track** supersedes the 5-stage flow in `game-design-system.md` (optional on Fast Track) and starter instructions.

Load on demand only: [brief](references/game-brief.md), [stylization](references/game-stylization.md) (art direction/generation), [flow](references/game-flow.md) (multiplayer, 3D budgets, exact tool contracts), [design system](references/game-design-system.md), [rubric](references/review-rubric.md), and media guides ([textures](references/game-textures.md), [2D](references/game-2d-animation.md), [3D](references/game-3d-animation.md), [procedural](references/game-procedural-animation.md), [audio](references/game-audio.md)).

## Workflow

1. **Brief & Lookup.** Write `design/plan.md` (routing tuple + 3–5 concrete Hard Fails), `design/style.md` (60–90 w formula), and `design/assets.csv` per [game-brief.md](references/game-brief.md). Run [game-lookup.md](references/game-lookup.md) if triggered.
2. **Build (`set_status("building")`, `write_files`).** Execute your Track in [game-gates.md](references/game-gates.md). Keep `logic.js`, `design/*`, `index.html`, and `assets.csv` single-owner.
3. **Verify.** Run `validate`, 3-tier `simulate`, `playtest` (checking 3C Hard Fails, `window.__omGame`, 390×844 layout, console/network), and Gate 2 independent visual review on Full Track. Log evidence and `Known gaps (P2)` in `design/verification.md`.
4. **Deliver (strict order — `write_files` demotes `ready` to `building`).** `capture_cover` (inspect 1280×720 canvas PNG) → final `design/verification.md` → `validate` → `update_meta` (with `zh-CN`) → `set_status("ready")` → authorized `publish` (show returned `nextSteps` as optional prompts).
5. **Final reply** (plain user language; no tool names, raw JSON, or internal ids): bold status ("playable first version" if limits remain) + play link; play/controls/invite + 3–5 top `config` tuning levers; verified vs unverified (human fun, real devices, sound), cost note, cover path; then the P2 list per [game-gates.md](references/game-gates.md#reporting-p2-to-the-user).

MCP-only hosts start at `openmotion://workflow/game/start`. If media tools are absent, explain the boundary and use bundled CC0 or procedural art.

## Optional Gameplay Trailer

Offer after Gate 2 or publication (`ready` required). On user request only, run `openmotion_game_trailer` (`start` → poll `status`), inspect clips and MP4, and report `projectId` and `videoUrl` (silent, server-owned; details in [game-flow.md](references/game-flow.md#gameplay-trailer-jobs)).

## Mandatory Multiplayer Entry Acceptance

Auto-join on load from `new URL(location.href).searchParams.get('room')` (generate a short id if missing; handle opaque iframe origins). Never render a room-code input or "Join room" button.

- [ ] Auto-joins within 5 s with zero clicks or typing.
- [ ] Lobby shows room code, Copy invite link (current room), and one Start button (1 player can start).
- [ ] `openmotion_game_validate` passes with zero room-code input / Join-button diagnostics.
- [ ] `openmotion_game_playtest` passes `autoJoin` on every client before Start or scripts run.

See [PROVENANCE.md](PROVENANCE.md) and [LICENSE-HIGGSFIELD](LICENSE-HIGGSFIELD).
