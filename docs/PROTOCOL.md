# ORBOUND — Multiplayer Wire Protocol

Authoritative WebSocket server. The server owns match state (terrain seed,
turn order, HP, wind) and validates every action; clients simulate physics
locally for smooth rendering but only APPLY results the server confirms.
This prevents a compromised/buggy client from cheating or desyncing the match.

## Design principle: server is a thin authority, not a full physics sim

Rather than reimplementing the entire projectile physics engine server-side
(duplicate code, hard to keep in sync with client tuning), the server's job
is narrower:
1. Own the canonical turn queue / whose turn it is / team rosters / HP.
2. Validate that an incoming "fire_shot" message comes from the currently
   active player, with a legal weapon slot for their mobile.
3. Relay the shot parameters (angle, power, weapon slot) to ALL clients in
   the room, including the sender.
4. Trust each client's LOCAL physics simulation to resolve the shot
   (terrain carve, damage, projectile behavior) using the exact same
   deterministic engine code (client/engine-core.js, mobiles.js, game.js)
   already proven correct in single-player — BUT the shooter's client
   computes the outcome (final HP deltas, terrain diff) and reports a
   "shot_result" back to the server, which the server then re-broadcasts
   as the authoritative outcome for all clients to apply.
5. This means: same deterministic terrain seed distributed at room creation
   + same physics constants (already shared code) => all clients who
   process the same "fire_shot" message independently should compute
   near-identical results. The shooter's authoritative "shot_result" is
   the tie-breaker if any float-precision drift occurs between clients.

This is a pragmatic middle ground for a casual game: cheat-resistant enough
(can't fire out of turn, can't fake being a different mobile) without the
engineering cost of a full server-side physics reimplementation.

## Connection

`wss://<host>:<port>` — client connects once per session, all room actions
happen over that one socket via JSON messages.

## Message envelope

All messages are JSON objects with a `type` field:
```json
{ "type": "<message_type>", ...payload }
```

## Client -> Server messages

### create_room
```json
{ "type": "create_room", "playerName": "string", "mode": "1v1|2v2|3v3|4v4" }
```
Server creates a room, assigns a 6-character join code, places the creator
into team 0 slot 0. Response: `room_created`.

### join_room
```json
{ "type": "join_room", "roomCode": "ABC123", "playerName": "string" }
```
Server assigns the joining player to the next open team slot (fills teams
in round-robin: t0, t1, t0, t1 for 2v2; t0,t1,t2,t3 for team-per-slot modes
— see server implementation for exact slot-fill order). Response:
`room_joined` or `join_error`.

### select_mobile
```json
{ "type": "select_mobile", "mobileId": "bastion" }
```
Player picks their mobile before the match starts. Server validates the
mobileId exists in the roster. Broadcasts `room_state` to all room members.

### start_match
```json
{ "type": "start_match" }
```
Only the room creator (team 0 slot 0) may send this. Server validates all
slots have a selected mobile, generates a random terrain seed, builds the
initial roster/turn-queue state, and broadcasts `match_started` with the
seed + full roster so every client can build identical local state.

### fire_shot
```json
{ "type": "fire_shot", "angle": 45.0, "power": 80, "slot": "s1" }
```
Server validates: sender is the room's currently active player, the slot
exists on their mobile, and (for SS) their charge meets chargeReq. If
invalid, responds with `shot_rejected` (message only to sender, no broadcast
— nothing happens client-side, they just re-aim). If valid, broadcasts
`shot_fired` to ALL clients (including a distinguishing flag for the
shooter's own client) so everyone starts local physics simulation.

### shot_result
```json
{
  "type": "shot_result",
  "terrainDiff": [ { "index": 120, "newHeight": 340.2 }, ... ],
  "playerHpDeltas": { "t0p0": -14, "t1p0": 0 },
  "eliminated": ["t1p1"]
}
```
Sent ONLY by the shooter's client once their local physics simulation for
the fired shot has fully resolved (projectile dead, all secondary explosions
resolved). Server validates the sender is indeed who fired the shot,
range-checks the deltas are physically plausible (reject wildly implausible
HP swings as a basic sanity check), then broadcasts `result_confirmed` to
all OTHER clients so their local state converges to match the shooter's.

### leave_room
```json
{ "type": "leave_room" }
```
Removes the player from the room; if all remaining players in a team leave,
that team is marked eliminated for scoring purposes but the match may
continue if other teams remain.

## Server -> Client messages

### room_created / room_joined
```json
{
  "type": "room_created",
  "roomCode": "ABC123",
  "yourPlayerId": "t0p0",
  "mode": "2v2",
  "roomState": { "players": [...], "teams": 2 }
}
```

### join_error
```json
{ "type": "join_error", "reason": "room_full|room_not_found|already_started" }
```

### room_state
Broadcast whenever roster/mobile-selection state changes (someone joins,
picks a mobile, etc.) so all clients' lobby UI stays in sync.
```json
{ "type": "room_state", "players": [ { "id": "t0p0", "name": "...", "mobileId": "bastion"|null, "connected": true }, ... ] }
```

### match_started
```json
{
  "type": "match_started",
  "terrainSeed": 123456789,
  "roster": { "teams": [ { "mobiles": ["bastion","twinsplit"] }, { "mobiles": ["driller","fortress"] } ] },
  "firstPlayerId": "t0p0"
}
```
Every client calls `newMatch(terrainSeed, roster)` locally with this exact
seed+roster so terrain and initial player layout are bit-identical across
all clients.

### shot_fired
```json
{ "type": "shot_fired", "playerId": "t0p0", "angle": 45.0, "power": 80, "slot": "s1", "isYourShot": true|false }
```
Every client (including the shooter) applies this by calling the client's
existing `fireShot(player, slot)` after setting `player.angle`/`player.power`
to the broadcast values — so all clients run the identical deterministic
physics step locally.

### shot_rejected
```json
{ "type": "shot_rejected", "reason": "not_your_turn|invalid_slot|not_charged" }
```
Sent only to the player who attempted the illegal action.

### result_confirmed
```json
{ "type": "result_confirmed", "terrainDiff": [...], "playerHpDeltas": {...}, "eliminated": [...] }
```
Non-shooter clients apply this as authoritative if their local simulation
diverged from the shooter's (rare, but float drift or a dropped frame could
cause it — this message is the correction mechanism).

### player_disconnected / player_reconnected
```json
{ "type": "player_disconnected", "playerId": "t1p0" }
```

### game_over
```json
{ "type": "game_over", "winningTeam": 0 }
```

## Room lifecycle

1. Room created (empty except creator) -> `waiting_for_players`
2. Players join and pick mobiles -> still `waiting_for_players` until all
   slots for the chosen mode are filled with a selected mobile
3. Creator sends `start_match` -> `in_progress`
4. Turns proceed via fire_shot/shot_fired/shot_result/result_confirmed
5. `game_over` broadcast when a team is fully eliminated -> room moves to
   `finished` state, remains joinable for a rematch (`start_match` again
   regenerates a new terrain seed and resets HP) or players can leave.

## Why this design over full server-side physics

Alternatives considered:
- **Full server-side simulation**: server independently runs the same
  physics as clients and is the sole authority, clients just render server
  state. More cheat-proof, but doubles the amount of physics code to
  maintain in two languages/runtimes (or forces Node.js to run the exact
  same JS physics — possible, but a bigger lift for a casual, non-competitive
  game where perfect anti-cheat isn't the priority).
- **Nostr-as-transport** (considered earlier in the project, see DESIGN.md):
  rejected for the core real-time gameplay loop due to latency/ordering
  concerns with public relay pub-sub; may still be layered in later as an
  alternate/stretch transport mode.

The chosen design (client-authoritative-per-shot + server validation) is a
pragmatic middle ground: legitimate players can't act out of turn or use
mobiles/weapons they don't have, and desyncs are self-correcting via
`result_confirmed`, without the cost of a parallel physics reimplementation.
