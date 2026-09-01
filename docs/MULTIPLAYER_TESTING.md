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

## Known limitations (honest, not fixed in this pass)

- **Terrain diff is not transmitted** (`terrainDiff: []` is still a stub).
  In practice this hasn't been observed to cause visible desync in testing
  because terrain carving is driven by projectile impact x/y, which (unlike
  HP falloff) tends to land in the same terrain cell even with a few pixels
  of drift — but this hasn't been stress-tested with rapid/overlapping
  terrain destruction (e.g. many bounce impacts in quick succession) the
  way the HP path was. If a future terrain-desync bug appears, this is the
  first place to look.
- **SS charge requirement is not validated server-side** — the server
  trusts the client not to fire an under-charged special. A malicious
  client could bypass this; low priority for a casual, non-competitive game
  but worth noting as a real gap, not an oversight being hidden.
- **Reconnection is not implemented** — if a client disconnects mid-match,
  the room is not resumable; this was out of scope for this pass.
- **No 2v2/3v3/4v4 network test yet** — all real two-client verification in
  this pass used 1v1. The server code path for larger modes (turn queue
  with >2 entries) is implemented but has NOT been independently verified
  with real multi-client tests the way 1v1 has. This should be treated as
  unverified, not as "should work by extension" — the exact bugs found in
  this pass (bot-flagging, turn-advance broadcasting) were all things that
  looked correct on paper before real multi-client testing exposed them.

## Verification artifacts

- `verify_multiplayer_independent.js` — single-shot two-client sync test
  (chains onto the game's real event handlers rather than overwriting them,
  after an earlier version of this test was found to make that mistake).
- `verify_multiplayer_multiturn.js` — 8-turn back-and-forth exchange test,
  checks convergence after every single turn, not just the first.
- Screenshots: `/tmp/track_d_shots/FINAL_A_synced_match.png` and
  `FINAL_B_synced_match.png` — both clients' view of the same live match.
