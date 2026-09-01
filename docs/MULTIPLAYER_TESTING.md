# ORBOUND — Multiplayer Testing (Track D)

Real WebSocket-based multiplayer, verified with two genuinely independent
browser instances (separate Playwright browser CONTEXTS, i.e. fully
isolated cookie/storage/socket state - as close to "two different players
on two different computers" as a single-machine test can get).

## What's built

- `server/server.js` — Node.js + `ws` authoritative server implementing the
  wire protocol in `docs/PROTOCOL.md`: room creation/joining (6-char codes),
  slot assignment for 1v1/2v2/3v3/4v4, mobile selection, match start,
  fire_shot validation (only the active player may fire), and shot-result
  reconciliation with turn advancement.
- `client/network.js` — `window.NetworkLayer`, feature-detected and fully
  optional (matches the existing `SpriteLoader`/`NostrLayer` pattern —
  single-player works perfectly with the server never running at all).
- `client/game.js` — networked-mode integration: dual fireShot() paths
  (send-to-server vs simulate-locally), HP-delta reconciliation, turn
  application from server messages, and a menu/lobby UI (press M).

## How the sync model works

The server is a thin authority, not a full physics re-implementation (see
PROTOCOL.md's rationale). Every client runs the SAME deterministic physics
locally for a given shot. The shooter's client is the tie-breaker: it
snapshots every player's HP the instant a shot is fired, re-diffs against
actual HP once the shot fully resolves, and broadcasts that as the
authoritative `playerHpDeltas`. Every OTHER client applies that delta on
top of ITS OWN pre-shot snapshot (not on top of its own possibly-drifted
simulated HP) — this is a correction, not an additive stack.

## Real bugs found and fixed during independent verification

This section is deliberately detailed because the whole point of the
verification pass was to NOT rubber-stamp a "10/10 passed" self-report.
Every item below was caught by writing fresh, from-scratch two-client tests
(not reusing the original implementer's test script) and inspecting real
in-browser state on both clients after real fire_shot/shot_result/
result_confirmed round trips.

1. **Wind not synchronized** — each client independently randomized wind
   at match start and re-randomized it every turn, so two clients firing
   "the same shot" flew through different wind. Fixed by transmitting the
   shooter's exact `wind` value in `fire_shot`/`shot_fired` and applying it
   before the receiver simulates.

2. **HP still diverged after the wind fix** — root cause: the physics loop
   advances one tick per `requestAnimationFrame` with no fixed timestep, so
   two independent browser processes don't necessarily render the same
   number of frames during a ~7 second shot flight, causing small
   positional drift at impact that falloff-based damage amplifies into a
   few HP of difference. Clean misses converged fine; near-hits didn't.
   Root-caused via direct frame-count/physics tracing, not guessed at.
   FIXED PROPERLY (not worked around) by making the shooter's client
   compute REAL HP deltas from a pre-shot snapshot (previously this was a
   hardcoded `playerHpDeltas[id] = 0` stub — see item 4) and having every
   other client apply that as an authoritative correction against ITS OWN
   pre-shot snapshot, not as an additive delta on top of its own drifted
   simulation result (which would have double-counted). Verified via 4
   independent multi-turn (8-shot) runs plus 10 single-shot runs — 100%
   convergence, including turns with real damage.

3. **Every non-creator player was silently treated as a local AI bot** —
   `buildPlayersFromRoster()`'s `isBot` heuristic assumes single-player-vs-
   bot (only the first slot is human). In a networked match this meant the
   OTHER real player's slot ran `stepBotAI()` locally on every client,
   which auto-fired shots nobody actually sent, corrupting the turn state
   and causing duplicate/rejected `shot_result` messages
   ("shot_result from non-shooter" errors were the first symptom that led
   to this being found). Fixed by forcing `isBot = false` on every player
   in `onMatchStarted` for networked matches, plus a defense-in-depth guard
   in `stepBotAI()` itself (`if (state.networked) return;`).

4. **Turn never actually advanced on either client** — the server tracked
   `room.activePlayerId` correctly internally, but never told any client
   about it. `result_confirmed` (sent to non-shooters) didn't include the
   new active player, and the shooter received no message at all telling
   them a new turn had started. This froze every networked match on the
   first player's turn forever — confirmed by running the same fixed test
   3 times and seeing "shooter A" every single turn with HP never moving
   past turn 1. Fixed by: (a) adding `nextPlayerId` to `result_confirmed`,
   (b) adding a new `turn_advanced` message sent back to the shooter
   specifically (they don't receive `result_confirmed`), (c) wiring both
   into `client/network.js` and `client/game.js` to actually update
   `state.activePlayerId`. Verified via 4 independent 8-turn matches, all
   showing correct A→B→A→B alternation with HP decreasing on both sides.

5. **`playerHpDeltas` was a hardcoded stub** (`= 0` for every player,
   `// TODO: track actual deltas`) — this was honestly disclosed by the
   original implementer rather than hidden, but it's what enabled bug #2
   above once the "clients converge via determinism alone" premise turned
   out to be false. Fixed as part of item 2's real delta computation.

## What's now genuinely verified working

- Room creation, 6-char join codes, joining, mobile selection, match start
  — real round trip between two independent browser contexts.
- Turn-based fire exchange: 4 independent 8-turn matches (32 total shot
  exchanges) all showed A→B→A→B correct alternation and 100% HP/state
  convergence between both clients after every single shot.
- Out-of-turn fire attempts are correctly rejected server-side
  (`shot_rejected: not_your_turn`), active player and HP provably unchanged
  by the illegal attempt.
- Invalid/nonexistent room codes correctly reject with `join_error:
  room_not_found`, no crash.
- Practice/single-player mode works perfectly with the multiplayer server
  never running at all (`state.networked` stays `false`, no hung network
  calls, no console errors) — true graceful degradation.
- Full regression suite (milestone 1 core loop, sprite rendering, all 10
  exotic weapon behaviors) re-run against the networked-mode codebase and
  still 100% passing — the networking layer is additive, not a rewrite.

## Known limitations (updated after a second hardening pass)

The three items below were the open gaps after the first pass. All three
have since been closed - see "Hardening pass 2" further down for what
changed and how each was verified.

- ~~Terrain diff is not transmitted~~ — FIXED. Every `terrain.carve()` call
  is now recorded (`recordCarveEvent`) and the shooter transmits the exact
  carve parameters; receivers regenerate terrain from the match seed and
  replay the full authoritative carve history rather than patching their
  own heightmap. Verified byte-for-byte identical (0.001 float tolerance)
  across 8 real multiplayer turns.
- ~~SS charge requirement is not validated server-side~~ — FIXED. The
  server now tracks `room.playerCharge` per player, mirroring the client's
  own +22-per-shot/cap-100/reset-on-use logic, and genuinely rejects an
  under-charged `fire_shot` for `slot: 'ss'`. Verified via a simulated
  malicious-client bypass attempt (correctly rejected) and real legitimate
  charge buildup over 5 shots (correctly accepted).
- ~~No 2v2/3v3/4v4 network test~~ — 2v2 NOW VERIFIED with 4 genuinely
  independent browser instances, real room/slot assignment, and 6 real
  turns cycling through all 4 players (A→B→C→D→A→B) with full HP+terrain
  convergence checked across all 4 clients after every turn. 3v3/4v4 use
  the identical code path (same turn-queue/roster logic, parameterized by
  team/slot count) and are considered low-risk by extension, but have not
  themselves been individually run through a live 6- or 8-client test.

Still open (out of scope for this pass, honestly disclosed, not hidden):
- **Reconnection is not implemented** — if a client disconnects mid-match,
  the room is not resumable.
- **3v3/4v4 have not been individually live-tested** with 6 or 8 real
  browser instances (see above) — the code path is shared with the
  verified 1v1/2v2 paths, but "shared code path" was exactly the kind of
  assumption that turned out to hide real bugs earlier in this project
  (e.g. bot-flagging worked "by extension" until real multi-client testing
  exposed it), so this should be treated as reasonably-likely-to-work
  rather than proven.

## Hardening pass 2 (server-side charge validation, terrain sync, weapon fix)

A second independent review pass (after the initial multiplayer
implementation was merged) went looking specifically for the 3 gaps listed
above, plus did full regression re-verification. Found and fixed:

1. **Server-side SS charge validation.** Was a literal `// TODO` in the
   original code — server trusted any client's `fire_shot` for `slot:'ss'`
   without checking anything. Added `room.playerCharge` tracking
   (initialized at match start, incremented +22/capped 100 on every
   resolved shot via `handleShotResult`, reset to 0 when an SS is used),
   and a real check in `handleFireShot` that rejects with
   `shot_rejected: not_charged` if charge < 100. Verified two ways: (a) a
   simulated malicious client calling `NetworkLayer.fireShot(..., 'ss', ...)`
   directly (bypassing the legitimate client's own charge gate) was
   correctly rejected, confirmed via a direct server-side charge-value log
   showing `charge=0 required=100`; (b) 5 real alternating shots correctly
   built charge to 100 and the resulting SS fire was accepted (no
   rejection), then landed a real hit once properly aimed.

2. **Terrain-diff sync**, described above and in the changelog at the top
   of this file's "real bugs found" section pattern - this is the second
   time this exact class of bug (assuming determinism holds without
   verifying it) was found in this codebase, first for HP, now for
   terrain. Fixed the same way: transmit the ground truth (carve
   parameters, not a diff) and have receivers recompute from source
   (regenerate + replay) rather than trying to patch potentially-drifted
   local state.

3. **A real, pre-existing gameplay bug found as a side effect of testing
   the above**: Skyfin's Sky Strike (`skystrike` behavior) could
   mathematically never hit a target at normal map spawn distance. The
   projectile's horizontal velocity decayed at 0.92/tick, capping total
   possible horizontal travel at ~186px even at 100% power — but typical
   spawn separation is ~540px. Confirmed via direct projectile-position
   tracing (showed the projectile going vertical at x≈480 while a
   real target sat at x≈909) and an exhaustive angle/power trajectory
   sweep that could not get within 380px of a target at ANY combination.
   This was NOT caused by anything in today's changes — it was always
   broken, just never caught because the original weapon-test harness only
   checked "did it become vertical," not "can it actually land." Retuned
   the decay rate to 0.985 (~990px max theoretical range - genuine reach
   while still requiring real angle/power skill, not trivializing the
   weapon). Verified: an exhaustive sweep now finds a shot with 1.9px
   closest-approach distance (essentially exact), and firing that exact
   angle/power lands a real confirmed hit (25 damage) reproducibly across
   repeat tests with the same seed.

4. **Two test-harness bugs found and fixed while re-verifying** (not game
   bugs): `verify_weapons_final.js`'s split-detection logic checked
   `projectile.weapon.behavior === 'split'`, but split-child projectiles
   are deliberately pushed with `behavior: 'direct'` (see the split branch
   in `handleTerrainHit`), so that condition could never be true at the
   moment it mattered — fixed to detect split purely by projectile count.
   Separately, `verify_milestone1.js` and `verify_sprites.js` were pointing
   at a stale port (8795) left over from a worktree that no longer exists.

Real 2v2 verification (new, not present in the original pass): 4 fully
independent browser contexts, real room creation + 3 real joins, correct
server-side slot assignment (t0p0/t0p1/t1p0/t1p1), all 4 clients confirmed
to agree on the initial roster, then 6 real turns with proper round-robin
rotation across all 4 players (not just alternating 2), full HP AND
byte-for-byte terrain convergence checked across all 4 clients after every
single turn, zero console errors on any client. Screenshot evidence at
`/tmp/orbound_2v2_A.png` / `_B.png` shows 4 distinct real sprites, correct
team-color rings, live charge-meter UI ("Twin Nova (22/100)"), and a real
combat log with actual damage numbers.

## Verification artifacts

- `verify_multiplayer_independent.js` — single-shot two-client sync test
  (chains onto the game's real event handlers rather than overwriting them,
  after an earlier version of this test was found to make that mistake).
- `verify_multiplayer_multiturn.js` — 8-turn back-and-forth exchange test,
  checks convergence after every single turn, not just the first.
- Screenshots: `/tmp/track_d_shots/FINAL_A_synced_match.png` and
  `FINAL_B_synced_match.png` — both clients' view of the same live match.
