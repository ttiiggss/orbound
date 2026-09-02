# ORBOUND

A GunBound-inspired turn-based multiplayer artillery game. Vanilla
Canvas + JavaScript on the client (no build step, no framework), a
lightweight Node.js WebSocket server for real-time multiplayer, and
optional Nostr integration for identity and match sharing.

8 unique mobiles (vehicles), each with 3 weapons and a distinct behavior
(direct-hit, bounce, burrow, split, wallbounce, orbital skystrike),
destructible terrain, wind, and 1v1 / 2v2 / 3v3 / 4v4 team modes.

## Quick start (local play, single machine)

Requires Node.js and Python 3 (for the simple static file server).

```bash
# Terminal 1 — serve the client
cd client
python3 -m http.server 8791

# Terminal 2 — run the multiplayer server (only needed for Multiplayer mode;
# Practice vs Bot works without it)
cd server
npm install
node server.js
```

Then open **http://localhost:8791** in a browser.

- **ENTER** — Practice vs Bot
- **M** — Multiplayer (create or join a room by code)
- **?** — How to Play
- Arrow keys to aim, hold SPACE (or click) to charge power, release to fire
- 1 / 2 / 3 to switch weapons (S1 / S2 / SS — the SS special requires a full
  charge meter, built up by landing/firing shots)

To play multiplayer with a friend, both of you need to be able to reach the
same `server.js` instance (same LAN, or expose port 8081 publicly / via a
tunnel like `ngrok`/`cloudflared`) and load the same client URL.

## Project layout

```
client/       Game client — pure Canvas + vanilla JS, no build step
  engine-core.js   Terrain generation/destruction, physics constants
  mobiles.js       8-mobile roster: stats, weapons, armor types
  sprites.js       Loads the generated character art (client/sprites/*.png)
  network.js       WebSocket client for multiplayer (optional, graceful
                    degradation to single-player if no server is running)
  nostr.js         NIP-07 login, relay picker, match-result sharing
                    (optional, graceful degradation if no extension present)
  audio.js         Synthesized Web Audio SFX (no external audio files)
  game.js          Main game: rendering, physics, turn logic, HUD, menus

server/       Node.js + `ws` authoritative multiplayer server
  server.js        Room creation/joining, turn validation, charge/HP/
                    terrain sync

assets/       Source art (ComfyUI-generated mobile portraits, Blender scene)
tools/        Art-generation and asset-processing scripts (ComfyUI workflow,
              background removal, sprite resizing)
docs/         Design doc, wire protocol spec, and testing notes
verify_*.js   Playwright-based regression tests (see below)
```

## Multiplayer architecture

The server is a thin authority, not a full physics re-implementation:
clients run the same deterministic physics locally, and the shooter's
client is the tie-breaker — it snapshots state before firing, computes the
real outcome (HP deltas, exact terrain carve events) once a shot resolves,
and broadcasts that as ground truth for every other client to converge on.
See `docs/PROTOCOL.md` for the full wire protocol and `docs/
MULTIPLAYER_TESTING.md` for a detailed account of real bugs found and fixed
during development (wind desync, frame-count-driven HP/terrain drift,
turn-advance broadcasting, server-side charge validation) — kept as an
honest record rather than pruned after the fact.

## Running the regression tests

The tests drive a real headless Chromium via `playwright-core` (not the
Playwright MCP tool, which doesn't have a working Chrome binary path on
every machine) and assert on actual in-game state, not just "no crash".
On a fresh clone/machine you'll need Playwright's own Chromium installed
once (`npx playwright install chromium`) and the `executablePath` at the
top of each `verify_*.js` script updated to match wherever that installs
to on your system (the committed scripts point at the specific path used
during development).

```bash
npm install   # installs playwright-core + ws at the repo root
npx playwright install chromium   # one-time, fresh machines only
# with client/ served on :8791 and server/server.js running on :8081:
node verify_milestone1.js            # core physics/turn/terrain loop
node verify_sprites.js               # sprite rendering + real combat
node verify_weapons_final.js         # all 10 exotic weapon behaviors
node verify_multiplayer_multiturn.js # 8-turn 1v1 sync (HP + terrain)
node verify_multiplayer_2v2.js       # 6-turn 2v2 sync, 4 independent clients
node verify_nostr.js                 # Nostr login/relay-picker/sharing
```

## Known limitations

- Reconnection isn't implemented — a mid-match disconnect ends the room.
- SS charge is validated server-side; terrain and HP are synced via
  authoritative replay from the match seed. 3v3/4v4 network modes share the
  same code path as the verified 1v1/2v2 modes but haven't themselves been
  put through a live 6/8-client test yet.
- No persistent accounts/leaderboards — Nostr integration covers identity
  (NIP-07 login) and optional match-result sharing to relays, not full
  ranked matchmaking.

See `docs/MULTIPLAYER_TESTING.md` for the full, honest list.
