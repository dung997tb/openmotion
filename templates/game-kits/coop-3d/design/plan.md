# Crystal Guard design plan — starter draft

This is a starting brief to revise for the requested game, not evidence of human enjoyment. Tags: [locked] user decision, [target] experience goal, [assumption] default to revise.

## Pitch
[assumption] A wave-defense brawler meets co-op rescue: one to four casters protect a crystal while reviving each other under pressure. Desktop and mobile, five-minute sessions.

## Experience target
[target] Players feel responsible for the team because moving, timing a nova and rescuing an ally protect the same vulnerable crystal.

## Core loop
[target] Move to intercept → fire or nova a group → watch it burst and the crystal hold. The first enemy is in range within 10 seconds of start.

## Retention hooks
[assumption] Difficulty flow across five waves, a wave-clear heal as a breather, and a local best wave count.

## Feel
[target] Hit flash, enemy burst particles, camera shake on nova and synthesized hit/hurt/wave/win/lose sounds.

## Share design
[assumption] The last-second save of a downed ally is the shareable moment; the end screen shows waves cleared, crystal HP and the best run in one line.

## Style
[assumption] Use the existing animated caster and procedural enemies; record the 60–90 word style formula in style.md.

## Scope and budget
- One arena, five waves, one to four co-op players; keyboard/mouse and touch controls. Start alone; invite a teammate during play.
- [assumption] No paid assets; bundled CC0 characters and procedural geometry.
- Render target: 60 FPS desktop, 30 FPS weakest declared mobile device; at most 100 draw calls, 100,000 rendered triangles, four animated players, 64 visible enemies and 32 shot trails. SwiftShader timing does not establish hardware acceptance.

## Metrics and thresholds
- Downed allies revive after 40 consecutive nearby ticks; solo respawn takes 100 ticks (five seconds). Skills must respect server cooldowns.
- Identical seed, player count and input routes must produce identical summaries and final results.
- Headless browser checks: expected player count, active phase, scripted net movement greater than 0.5 world units, and no horizontal overflow at 390x844.

## Reference-win / idle-loss contract
- Reference route must win: all configured players finish five waves with objective HP above zero within 2,500 ticks. Run the game-provided reference through openmotion_game_simulate.
- Idle must lose: zero input must produce a loss with no winners and objective HP zero within 2,000 ticks. Automatic touch aiming still requires fresh input; it must not make zero-input play win.
- A weaker degraded route (reference inputs thinned or delayed) should struggle and often lose; if it wins as easily as the reference, the waves are too easy.

## Difficulty plan
Simulation runs at 20 Hz. The config block in logic.js owns the actual values: enemy count 4 + 2 per wave, HP 2 + floor(wave/3), speed 1.1 + 0.12 per wave. Hunters pressure living players; siege enemies threaten the crystal. First wave waits 40 ticks; cleared waves give a heal/repair and 80-tick breather. Nova timing and rescue create alternatives to standing still. Tune only after comparing reference, degraded and idle results, preserving the declared thresholds for that iteration.

## Art and delivery
Keep every asset source/license/cost in assets.csv. Cover capture and multi-client testing run only through server-owned headless tools; never operate the user's browser or desktop. Record measured results, unavailable checks and the P2 polish backlog in verification.md. Publication is local and needs authorization.

## Brief changes
- None yet.

## Follow-up opportunities
- Add a final boss with a clearly telegraphed crystal attack.
- Tune the hunter and siege mix while preserving reference-win and idle-loss thresholds.
- Add an ally-protection skill with a readable cooldown and touch button.
