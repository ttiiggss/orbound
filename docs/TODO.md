# ORBOUND — Remaining Milestones TODO

Checkpoint commit: 3afdbc1 (milestone 1 core loop + 8 sprites integrated, verified working)

## Track A — Weapon behavior battle-testing (PARALLEL AGENT 1)
Status: pending
Scope: client/game.js weapon behavior functions only (bounce, burrow, split,
wallbounce, skystrike). Physics/combat only, no networking/UI/Nostr changes.
- [ ] Write a Playwright verification harness (node, playwright-core, same
      pattern as verify_milestone1.js) that fires each of the 8 mobiles'
      3 weapons (s1/s2/ss = 24 total shots) at a deliberately-aimed target
      and confirms: projectile behavior matches spec (bounces N times /
      burrows then detonates / splits into 2 sub-explosions / wall-bounces
      off screen edges / skystrike does its thing), damage registers,
      terrain deforms appropriately for each behavior type.
- [ ] Fix any bugs found (expect some — burrow/split/bounce/wallbounce were
      wired but never live-fire tested per the milestone 1 checkpoint notes).
- [ ] Verify SS ultimates require charge (chargeReq: 100) and cannot fire
      before charged — confirm the log message and that firing is blocked.
- [ ] Document actual verified behavior + any tuning changes in
      docs/WEAPON_TESTING.md.

## Track B — Nostr identity + results layer (PARALLEL AGENT 2)
Status: pending
Scope: new client/nostr.js + login/relay-picker UI additions to index.html
and game.js hooks only. Does not touch physics/combat/server code.
Requirements from user (locked, do not re-litigate):
  1. NIP-07 browser extension login only (no local nsec generation/storage)
  2. Match-result posting (kind 1) + challenge broadcast, both optional/skippable
  3. Curated 50-relay list, ZERO primal.net domains, default 3:
     wss://relay.damus.io, wss://nos.lol, wss://relay.snort.social
     (full 50-relay list must be hand-curated from reputable client-official/
     community relays — do NOT scrape an unranked list verbatim)
- [ ] Load nostr-tools v2.x from CDN per the nostr skill's browser API reference
      (references/nostr-tools-browser-api.md — use finalizeEvent not
      finishEvent, nip19.decode() not type-specific decoders, etc.)
- [ ] Build NIP-07 login flow: detect window.nostr, request pubkey via
      window.nostr.getPublicKey(), display npub in UI, store in a
      lightweight session object (no private key handling anywhere).
- [ ] Build relay picker UI: checkbox list of the 50 curated relays,
      3 checked by default, connect to selected set via WebSocket.
- [ ] On match end (state.phase === 'gameover'), offer a "Share result"
      button that builds and signs (via window.nostr.signEvent) a kind:1
      event summarizing the match outcome, publishes to selected relays.
      Must be skippable — game must fully function with no Nostr extension
      installed at all (graceful feature-detection, not a hard requirement).
- [ ] Build a "Broadcast challenge" button using a custom tagged event
      (e.g. kind 30078 parameterized replaceable, tag #orbound-challenge)
      publishing an open room code, and a listener that subscribes to
      #orbound-challenge on the selected relays to show open challenges.
- [ ] Verify with a real Playwright test: since headless Chromium has no
      NIP-07 extension, inject a mock `window.nostr` object implementing
      getPublicKey/signEvent (using nostr-tools to generate a real
      throwaway keypair) BEFORE page load via page.addInitScript, then
      confirm login flow, result posting, and challenge broadcast all work
      against real public relays (or gracefully handle relay connection
      failures without crashing).
- [ ] Document relay list + architecture in docs/NOSTR_INTEGRATION.md.

## Track C — Team modes 1v1/2v2/3v3/4v4 (SEQUENTIAL — orchestrator, i.e. me)
Status: pending, blocks Track D
Scope: client/game.js state shape + turn queue generalization.
- [ ] Generalize newMatch() to accept a roster config: N teams x M players,
      not hardcoded 2 players.
- [ ] Generalize spawn positioning for up to 8 total players across 2-4 teams
      spread across the terrain width without overlap.
- [ ] Verify delay-queue turn system already generalizes correctly for N>2
      players (it should per the design — confirm, don't assume).
- [ ] Verify checkWinCondition() already generalizes for N teams (it uses
      a Set of alive team indices — confirm this is correct for 3-4 teams).
- [ ] Add a team HP pool / team-elimination display to the HUD (which teams
      are still alive, not just individual HP bars).
- [ ] Verify with Playwright: run a full 4v4 (8 total mobiles) match to
      actual completion (one team fully eliminated), confirm win detection
      fires correctly and turn order cycled through all 8 players correctly.

## Track D — WebSocket multiplayer server (SEQUENTIAL — after Track C)
Status: blocked on Track C
Scope: new server/ directory (Node.js + ws), authoritative room/turn relay.
- [ ] Design and document the wire protocol (JSON messages: join_room,
      room_state, fire_shot, shot_result, turn_change, game_over) in
      docs/PROTOCOL.md before writing server code.
- [ ] Implement server/server.js: room creation with join codes, player
      slots (up to 8 per room for 4v4), authoritative turn validation
      (reject fire_shot from non-active player), state broadcast.
- [ ] Modify client/game.js to optionally run in "networked mode" — when
      connected to a room, shots are sent to server and only applied
      locally once the server confirms/broadcasts them, instead of
      resolving purely client-side.
- [ ] Verify with a REAL multi-client test: launch the server, launch TWO
      separate Playwright browser contexts, join the same room from both,
      play a real turn exchange (client A fires, client B's browser state
      updates to reflect it), confirm both clients stay in sync through
      several turns to a real match conclusion.

## Final integration pass
Status: blocked on A, B, C, D
- [ ] Merge all four tracks, resolve any conflicts.
- [ ] Full regression: run verify_milestone1.js + verify_sprites.js +
      all new verification harnesses from tracks A-D against the merged code.
- [ ] Update docs/DESIGN.md to reflect final implemented scope.
