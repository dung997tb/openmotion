> Written for OpenMotion; see [source and execution notes](../PROVENANCE.md).

# Staged build, gates and stop-loss

Quality comes from a closed loop: a visible target, a build, a real playtest and a review, repeated. Spend the loop on what matters. Gates block on broken or off-brief work, never on polish.

## Stages

| Stage | Work | Exit |
|---|---|---|
| **1. Brief** | Write the [brief](game-brief.md), style formula and asset manifest. Optional target image with approved generation | The five questions answered. Confirm with the user only when a decision is missing or the style is unclear |
| **2. Graybox core** | One agent builds the core loop from the received kit with procedural or bundled placeholders that honour the manifest contract. In parallel, collect cheap assets: bundled CC0 models, procedural audio and approved style-defining 2D images | Gate 1 |
| **Gate 1: is it a game?** | Simulate the reference, idle and degraded tiers; playtest; count the feel feedback; review the brief | No P0 issues, gameplay P1 issues fixed. In an interactive chat, share the playable link and ask one question ("Is this the game you want?") before costly work. In an unattended or one-shot run, record the result and continue |
| **3. Vertical slice** | Bring one complete scene or level to final quality: real art, feel and sound. Start costly or gameplay-dependent assets here (generated 3D, rigging, large batches), after approval | Gate 2 |
| **Gate 2: does it look right?** | Capture the slice and get an independent review against the style formula or target image | No P0 issues, visual P1 issues fixed. The slice can now feed a trailer (`openmotion_game_trailer` needs status `ready`) |
| **4. Content expansion** | Grow levels, enemy types, items, UI screens and audio to the slice standard. Parallelize with sub-agents where the host supports them | Smoke playtest per item |
| **5. Assemble and deliver** | Swap placeholders through the manifest, smoke-playtest after each batch, validate, capture the cover, set metadata, publish when authorized | Final message |

**Parallel work and file ownership.** Parallelize content, not the core: player control, rules, camera and state are coupled, so one agent owns them. `logic.js` runs as one self-contained file in the bounded runtime, so it always has a single owner. The orchestrating agent also owns `design/*`, `index.html` and `assets.csv`. Content sub-agents write separate files (drawing, audio, UI screens, level data loaded by the client) and hand rule changes back to the owner. Without sub-agents, do the same work in sequence.

## Balance with three simulation tiers

Use `openmotion_game_simulate` with explicit routes when needed:

- **Skilled**: `scripts:"reference"` must win with margin.
- **Weak**: a degraded route, for example the reference with inputs thinned or delayed. It should struggle, progress part of the way and often lose.
- **Idle**: `scripts:"idle"` must lose terminally; a timeout is not a loss.

Read the spread, not a single number. Weak winning as easily as skilled means too easy; skilled barely winning means too hard. Tune one value at a time in the config. Simulated players are not people: the gate 1 user play has the final say on difficulty.

## Independent review

Give a fresh-context sub-agent only the brief, the style formula or target image and the captures. It returns pass or fail and at most the three highest-impact issues, each labelled P0 or P1. Without sub-agents, run the review as a separate step that reads only those inputs. Never let the builder grade its own work from memory.

## Stop-loss rules

- **Three issue levels.** **P0 blocking**: errors, freezes, an unwinnable or unlosable loop, a collapsed frame rate. **P1 experience**: issues inside the current gate's scope, such as feel and difficulty at gate 1 or style drift and covered UI at gate 2. **P2 polish**: details and edge cases. Fix P0 and P1; log P2 and do not fix it inside the loop.
- **Each gate checks only its own scope.** Gate 1 ignores visuals, gate 2 ignores numbers, content items get a smoke playtest only.
- **Stop when it passes.** Once a review passes, its remaining notes no longer trigger changes. Stop after two rounds that barely improve the result.
- **Rank by frequency.** An issue that rarely appears across simulation and playtest runs and does not block play is P2.
- **Round limits.** At most three P1 rounds per gate, then hand the remaining P1 issues to the user. Fix P0 until it passes; if P0 keeps returning, the core design is wrong, so apply the brief pivot rule.
- **No token cap.** Quality comes first. Cut waste, not effort.

Record the P2 backlog under `## Known gaps (P2)` in `design/verification.md`.

## Reporting P2 to the user

In the final message, after what works and how to play, list the P2 issues as a numbered list: at most five, highest impact first, one sentence each saying what the issue is and what it affects. If there are more, add one line: "N more details are recorded." Close with one question, for example: "Want me to fix any of these? Reply with the numbers, say all, or leave them." Fix only the chosen items, then playtest again.
