# Scenario Workflows

Scenario workflows guide end-to-end production from a single creative idea through web pages, visual assets, video and motion films, audio, multi-platform social copy, and one downloadable ZIP package. Instead of browsing disconnected templates or wiring a node-graph canvas, every workflow uses a structured form, non-linear step tabs, versioned iterations, and persistent **Shared assets** so outputs flow cleanly between steps.

## Scenario taxonomy

Workflows are organized into three categories under **Workflows** in the top navigation (`?page=scenarios`) and in the Explore hero carousel and highlights rail:

| Category | Scenario ID | Title | Ordered steps |
| --- | --- | --- | --- |
| **Topics** (`topic`) | `motion-full-chain` | Motion Studio | Brief → Storyboard → Motion film → Soundtrack → Social posts |
| **Topics** (`topic`) | `gemini-4-neon` | Gemini 4 Neon | Brief → Code animation → Key stills → Film & motion → Social posts |
| **Topics** (`topic`) | `design-full-chain` | Design Studio | Brief → Landing page → Page images → Embed images → Promo video → Social posts |
| **Campaigns** (`campaign`) | `black-friday` | Black Friday Sale | Brief → Product images → Detail page → 30s sales film → Social posts |
| **Roles** (`role`) | `ai-influencer` | AI Influencer | Brief & script → Persona visuals → Link-in-bio page → Voiceover & audio → Talking video → Social posts |

Existing Studio destinations (Motion Studio, Design Studio, Cinema Studio, Model Hub, Black Friday collection, Template library, Skills) remain directly reachable from both the navigation bar and context links inside each workflow.

## Workspace layout and shared assets

Opening any scenario navigates to `?page=scenario&scenario=<id>[&run=<uuid>][&step=<stepId>]`.

- **Run header:** displays the scenario cover, title, category chip, run switcher (create, rename or archive drafts), **Copy for Agent**, a desktop toggle to collapse/reopen **Shared assets**, and primary **Export all** button (builds and downloads a full ZIP bundle directly).
- **Non-linear stepper:** lets you jump to any step at any time. Upstream active outputs populate sensible default input bindings without locking downstream steps.
- **Step workbench:** combines a single guided brief/creation composer with bound input slots (**Choose assets** or drag-and-drop), a dual-track capability bar (**Generate image / video** directly via configured providers on non-media steps plus step-scoped **Copy MCP prompt** and **Sync**), live preview, per-step export actions, and **Version history** (`v1…vn` with compare, promote active output, reuse settings, notes, and retry/cancel on jobs).
- **Shared assets:** docked on the right at desktop widths (`>= 1100px`) with drag-to-resize (`240–520px`, persisted in local storage) and header collapse controls (auto-expanding when picking assets), a collapsible opaque drawer on medium widths (`768–1099px`), and a modal bottom sheet below `768px`. Supports single, multi-select, and bulk **Import** (panel drag-and-drop upload, workspace assets with `Select all` / `Import all`, Design pages, Motion projects) and **Export** (single-item download/ZIP per card, **Select** multi-select batch bar, filtered ZIP, or **Export all (ZIP)** with options). Every uploaded, imported, or generated asset lands here as a **pinned reference** (`assetId/versionId`, Design `projectId/revision`, Motion `projectId/sessionId`) without duplicating media bytes. Removing an item from shared assets removes only the workflow binding and never deletes the underlying workspace asset.
- **Automatic cross-tab sync:** window focus, tab `visibilitychange` back to `visible`, and manual **Sync** actions refresh the active run and highlight newly added items in **Shared assets**.

## Export and packaging

- **Per-step export:** every step header offers a menu for immediate deliverables (HTML/ZIP for Design pages, direct downloads for active media files, Markdown/JSON copy or download for social packs and briefs, editor links, and step-scoped ZIP packages).
- **Single, multi-select, filtered, and full bundle export:** **Shared assets** and top-bar **Export all** build validated ZIP archives via `openmotion_assets_use(action="scenario", scenario={ command: "export", poolItemIds?: [...], ... })` and stream them from `GET /motion-api/scenarios/bundles/:id/file`. A full bundle contains `manifest.json`, `README.md`, `brief/`, unpacked `web/<step-id>/` pages (with embedded local `assets/*` paths that open from disk), optional standalone HTML, pinned `media/` outputs, `social/` posts, `motion/` project links, and optional Motion source archives; passing `poolItemIds` packages only the chosen items alongside `manifest.json`.

## MCP and Agent integration

Scenario workflows preserve the twenty-two registered phase-one MCP tool names and share one backend domain service (`gateway/scenario-runs.ts`) across Studio and external Agents:

- **Scenario orchestration:** `openmotion_assets_use` with `action="scenario"` exposes `catalog`, `list`, `get`, `create`, `update_run`, `update_brief`, `update_step`, `add_pool`, `update_pool`, `remove_pool`, `add_iteration`, `generate`, `sync`, `cancel`, `promote`, `create_page`, `embed_image`, `link_design`, `create_motion`, `link_motion`, and `export`. Mutations carry explicit `runId`, `expectedRevision`, and a stable `requestId`.
- **Binary image embedding into HTML projects:** `openmotion_design_edit` with `action="import_asset"` (and `POST /motion-api/design/projects/:id/import-asset`) copies a pinned workspace asset version into a Design Studio project via `DesignProjects.importBinaryFile()`, creating a new revision-checked `vN` snapshot and returning its project-relative path.
- **Step-scoped Agent write-back and handoff:** `scenarioAgentPrompt` and `scenarioRunAgentPrompt` in `shared/scenarios.ts` power Studio's **Copy for Agent**, per-step **Copy MCP prompt**, and the **MCP · Connect Agent** handbook. Copying an Agent prompt from a fresh draft creates and persists the run first so the prompt always carries `runId`, `expectedRevision`, `stepId`, the active step prompt, and exact write-back commands (`generate`, `add_pool`, `add_iteration`, `link_design`, `link_motion`, `update_brief`).

See [MCP Phase 1 tools](mcp-phase1-tools.md) and [Product architecture](product/architecture.md#scenario-workflows) for contract details.

## Capability boundaries

- **No built-in text or design LLM:** offline starter HTML pages, script outlines, and multi-platform social drafts are deterministic templates seeded from your brief. AI-authored HTML pages and copy come from your connected external Agent via the shared handoff prompt.
- **Provider-backed media generation:** image, video, speech, and music generation use your configured providers in **Model providers** (OpenDesign account or BYOK). When no compatible model is configured, steps show a setup panel alongside offline upload, workspace-asset import, and Agent handoff alternatives without fabricating results.
- **Export-only social packs:** social posts are drafted, edited, copied, and exported as Markdown/JSON/text files; OpenMotion does not publish directly to social platforms.
- **Distinct verification evidence:** automated unit/DOM checks, browser visual checks across light/dark themes and viewports, paid model generation, and human visual acceptance remain separate evidence.

## Adding a new Topic, Campaign or Role

Navigation, Explore, the Scenario Hub, the MCP catalog, and run persistence all read from the shared registry. Adding a new scenario requires four changes:

1. **Register the definition** in `shared/scenarios.ts` (`scenarioDefinitions`), specifying `id`, `category` (`topic | campaign | role`), `title`, `subtitle`, `description`, `icon`, `links`, `briefFields`, and ordered `steps` (referencing valid `studioScenes` IDs and `RemixIcon` names from `packages/design-system/icons.svg`).
2. **Add a local cover mapping** in `studio/src/scenario/scenarioCovers.ts`.
3. **Add translations across all 10 non-English locales** in `studio/src/i18n/scenario-ui.json` (preserving `{placeholders}`, `openmotion_*` names, and using `项目` rather than `工程` in `zh-CN`).
4. **Optionally add a starter page recipe** in `shared/scenario-content.ts` if the scenario introduces a new `PageRecipeId`.

Validate changes with:

```bash
npm run check
npm run design:check
npm run typecheck:backend
npm run typecheck:studio
npm run test:studio -- src/i18n src/motion/ScenarioNavigation.test.tsx src/motion/workspacePageRouting.test.ts
node --experimental-strip-types --test tests/mcp-onboarding.test.ts tests/scenario-runs.test.ts tests/scenario-content.test.ts tests/scenario-bundle.test.ts
```
