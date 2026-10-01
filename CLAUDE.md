# Cart Jockey

Small browser game. You are a grocery store cart attendant. Pull shopping carts from parking-lot return bins and stray spots, latch them into a train, and dock them at the store corral before the shift ends.

## Stack

- Vanilla HTML, CSS, JS. One canvas.
- No npm, no Phaser, no build step, no accounts, no APIs.
- No extra libraries unless the user approves.
- Art: placeholder shapes only for now.
- Sound: none until the user asks.
- Persistence: `localStorage` only, and not until the scoring checkpoint.

## DEFINITION OF DONE

1. You ran or opened the game and the current checkpoint works end to end.
2. High score survives reload once that feature exists.
3. Keyboard and touch call the same actions once touch exists.
4. Do not add a dependency unless the user approves it.
5. Game rules live in game state, not only in draw code.
6. Debug collision boxes can be toggled.
7. After each task, report commands you actually ran and anything unverified.

## SCOPE

- One lot.
- One 3-minute shift.
- Max train length 6.

Do not add extra lots, upgrades, indoor shopping, multiplayer, or a service worker until the user asks.

Ideas that fall outside scope go in `ideas-later.md`, not in code.
