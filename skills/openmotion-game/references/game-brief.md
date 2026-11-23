> Written for OpenMotion; see [source and execution notes](../PROVENANCE.md).

# Game brief standard

The brief is the source of truth for the whole run: build against it, check every gate against it, and correct it first when evidence says it is wrong. It lives in `design/plan.md`, with the style formula in `design/style.md` and the asset contract in `design/assets.csv`. Write it before game code, keep it to about one page, and revise it as the game teaches you.

## Three writing rules

- **Describe experience and constraints, not implementation.** Write what the player should feel and what must never happen, not which classes or functions to use.
- **Tag each decision.** `[locked]` the user said it explicitly; never change it without asking. `[target]` an experience goal; the means may change. `[assumption]` your default; change it freely when evidence disagrees. Untagged lines count as assumptions.
- **Every line needs a check.** If you cannot name how a line will be verified (simulation, playtest assertion, capture, user play), cut it.

## The nine sections

Use these headings in `design/plan.md` in any order. Keep the existing required content: numeric thresholds, the reference-win / idle-loss contract, the wave or difficulty plan and a `## Follow-up opportunities` list (publication turns it into next-step prompts).

| Section | Write | Why it matters | Check |
|---|---|---|---|
| **1. Pitch** | "X meets Y, plus one hook"; audience, platform, session length. Rewrite "make GTA / Pokémon / a copy of X" as X's core loop with an original theme, names and art; never ship third-party marks or characters | A pitch nobody can repeat does not spread; original framing avoids IP problems and host refusals | The user can repeat it after one read |
| **2. Experience target** | The experience formula ("The player feels ___ because the game constantly ___") and one or two feelings: thrill, tension, calm, comedy, cleverness | Derive mechanics from the feeling, not the other way round | Gate 1 user play, plus the gate 2 review for mood |
| **3. Core loop** | A 30-second loop: verb → feedback → reward. At most two core verbs. The first meaningful action within 10 seconds | Thirty seconds of fun repeated is the game; easy to learn, hard to master | The reference route performs a core verb in the first 10 s of simulated time |
| **4. Retention hooks** | Pick two or three: difficulty flow, variable rewards, near misses, unlocks, build combinations, collection, local best score | The reason for "one more run"; more than three dilute each other | Multi-tier simulation spread and session length (see [gates](game-gates.md)) |
| **5. Feel** | At least three feedback types for the core verb: hit-stop, shake, particles, floating numbers, flash, squash and stretch, synthesized sound | Feel decides the first 30 seconds | Named and counted in `design/verification.md` |
| **6. Share design** | One shareable moment (a highlight, surprise or absurd failure), an end screen that reads well as a screenshot with score and best, a meme or trend hook (never third-party IP), a striking first five seconds, and optional platform interaction | People share moments, results and comparisons | A 5-second highlight is capturable; the end screen states the result in one line |
| **7. Style** | The 60–90 word style formula, three keywords and references. When image generation is available and approved, one target image saved under `design/` | One visual anchor every agent shares | The gate 2 review against the formula or target image |
| **8. Scope and budget** | Must have / must not / not this time. Paid-asset tier (affects paid assets only, never iteration). Performance budget from [the numeric defaults](game-flow.md). Open-world or city requests start as one playable district or arena | Showcase scenes are fast; playable open worlds cost an order of magnitude more | — |
| **9. Asset manifest** | Every asset row in `design/assets.csv` with its source class (runtime procedural, offline procedural, bundled CC0, generated image, generated 3D, audio) and contract (size or ratio, anchor, format, polygon or texture budget, animation names). Hard-surface shapes (buildings, roads, props) come from code; organic shapes (characters, creatures, vehicles) come from bundled CC0 models or approved generation | The manifest lets work run in parallel and lets placeholders be swapped without code changes | Every row resolves to a real file or a procedural placeholder at load |

## Five questions before code

Can the pitch be said in one sentence? Is the core verb playable within 10 seconds? Is there a reason for one more run? Is there a moment worth sharing? Are locked decisions separated from assumptions?

## Correcting the brief

- **Review the brief at every gate.** Compare simulation, playtest and review evidence with sections 3–7.
- **Respond in three tiers.** A number is off: tune the config; the brief stays. A means fails: change the `[target]` or `[assumption]` line yourself and note it under `## Brief changes`. A target or `[locked]` decision cannot work: stop and ask the user, with the evidence and two alternatives.
- **Pivot instead of polishing.** If the core loop fails gate 1 twice, stop tuning it; propose two or three alternative core verbs and let the user choose.
- **The brief stays true.** When the user says "that's wrong", update the brief first, then the code.

## Tolerance

The brief is read by agents and people, not parsed by tools. Headings, order and tags may vary; missing sections are reminders, not errors. Only `design/assets.csv` is consumed by code, and that code must read it leniently: default missing columns, ignore unknown ones, skip a bad row with a note, and fall back to a procedural placeholder when a file is missing. Never let a malformed brief or manifest block a playable build.

## Skeleton

```markdown
# <Game title>

## Pitch
## Experience target
## Core loop
## Retention hooks
## Feel
## Share design
## Style
## Scope and budget
## Metrics and thresholds
## Reference-win / idle-loss contract
## Difficulty plan
## Brief changes
## Follow-up opportunities
```
