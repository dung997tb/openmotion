> Written for OpenMotion; see [source and execution notes](../PROVENANCE.md).

# Capability-Boundary External Lookup Protocol

LLMs routinely overestimate their accuracy on realtime 3D physics, feel constants, and constructive level generators — shipping plausible code that feels broken in play. When a brief hits a trigger below, **perform read-only design research via the host's web search or documentation tool (when available) before coding**, strictly inside OpenMotion's local runtime boundaries.

> **Clarification on `game-flow.md` safety boundary:** Lookup here means **read-only research** for algorithms, state machines, and parameter ranges — never download or execute remote scripts, install packages, call third-party generation APIs, or put external URLs in game files.

## 1. Mandatory Lookup Triggers

| Domain | Trigger Condition | Research Target (Never Copy Full Repos) |
|---|---|---|
| **3D Physics & 3C** | Capsule/sphere wall-sliding, slope handling, arcade kart steering & drift state machine, FPS pointer-lock / aim-assist magnetism / recoil damping | State transitions, tangent projection math, playtested damping/friction ranges (GDC talks, arcade racer/FPS feel breakdowns) |
| **2D Feel & Physics** | Platformer jump-arc gravity curves, 2D circle/rigid-body stacking & impulse resolution (e.g., merge physics), steering/Boids avoidance | Tuned gravity/coyote/buffer ms ranges, stable fixed-step impulse and positional correction formulas |
| **Constructive Generation** | Guaranteed-solvable puzzle dealing (tile-stack, parking jam, sokoban), WFC/BSP map generation, A* / flow-field pathfinding | Constructive reverse-dealing algorithms, lightweight grid/graph solvers |
| **Vendored Engine APIs** | Non-trivial Three.js camera, instancing, raycasting, animation mixing, or shader patterns | Official Three.js docs/examples matching the draft's vendored `vendor/LICENSE-three.txt` / `vendor/three.module.min.js` (or `templates/game-kits/vendor/` when repo read exists) |

Skip lookup for mechanics you author cleanly from first principles: turn/wave state machines, HUD layouts, card/item effect tables, WebAudio synth blips, or deterministic `pilot` bots.

## 2. Runtime-Safe Borrowing Priority

Every borrowed technique must execute cleanly inside OpenMotion's zero-CDN static bundle and deterministic `logic.js` VM (no `import`/`require`):

1. **P0 — Built-in OpenMotion primitives:** Reuse shipped starter kits (`arcade-2d`, `coop-3d`), vendored Three.js, and bundled CC0 models first.
2. **P1 — Mechanics breakdowns & parameter baselines (preferred):** Extract concise mathematical formulas, state machines, and tested parameter ranges; implement cleanly in pure JS.
3. **P2 — Minimal same-stack JS/TS references:** Inspect only isolated algorithm snippets from lightweight Web/Canvas/Three.js examples. Never port heavy Unity/Godot scaffolds blindly or copy external asset URLs.
4. **P3 — Author from scratch:** Core game rules, UI, balance curves, and synthesized audio.

## 3. Distill Before Coding (Technical Brief)

Before implementing a looked-up mechanic, write a 4–6 line note in `design/plan.md` (or working notes):
- **Mechanism:** Exact state machine or algorithm (e.g., 3-state kart drift: enter → hold → release mini-boost).
- **Parameter baseline:** Concrete starting numbers placed into `logic.js`'s top `config` block.
- **Runtime adaptation:** Coordinate axes, fixed-step `dt` normalization, and deterministic `ctx.random()` usage.

## 4. Offline / No-Search Fallback

If the connected host has no web search tool, never fabricate URLs or claim research occurred. Implement the cleanest proven mathematical approximation (e.g., tangent wall-slide projection, reverse-dealing puzzle generator, clamped spring-damped camera), expose every feel constant in `config`, and record the unverified baseline under `Known gaps (P2)` in `design/verification.md`.
