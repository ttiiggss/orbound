# ORBOUND — Design Doc

Turn-based multiplayer artillery game inspired by GunBound/DragonBound.
Vibrant, bold, Super-Paper-Mario-flavored visual style. Browser-based,
no build step for the client. Nostr identity + result/challenge broadcasting.

## Scope (v1)

- Modes: 1v1, 2v2, 3v3, 4v4 (team HP pools, delay-based turn queue)
- Roster: 8 mobiles (Bastion, Driller, Twinsplit, Bouncer, Fortress, Skyfin, Ricochet, Voltaic)
- Core loop: angle+power aiming, wind, destructible terrain, HP + bunge (fall-death) win conditions
- Multiplayer: authoritative Node.js + ws server (rooms, turn validation, state broadcast)
- Nostr: NIP-07 extension login (identity only, no key handling in our code),
  match-result posting (kind 1, optional/skippable), challenge broadcast (custom tag),
  curated 50-relay picker (zero primal.net domains), default 3: damus, nos.lol, snort

## Non-goals (v1)

- No server-side physics simulation authority (client simulates, server validates turn legality + relays)
- No Nostr-as-transport for realtime gameplay (WebSocket server is authoritative transport)
- No avatar/cosmetic stat meta from original GunBound (skip pay-to-win layer entirely)

## Armor triangle (light version)

Mechanical > Bionic > Shield > Mechanical is TOO complex for v1; instead:
Voltaic's electric damage type does +50% vs "Mechanical" tagged mobiles (Bastion, Fortress),
-25% vs "Bionic" tagged mobiles (Bouncer, Driller). Everything else deals flat damage.
Simple enough to explain in one tooltip.

## Turn model

Delay queue, not strict alternation. Each mobile action posts a "ready at tick"
based on delay cost of the shot used. Server holds a min-heap of {playerId, readyTick}.
Lowest readyTick acts next. Ties broken by join order. This allows a player who uses
a low-delay Shot 1 twice to potentially act again before a high-delay opponent's next turn.

## Milestones

1. Single-player-vs-bot core loop: aiming, physics, terrain destruction, one map, 2 mobiles. VERIFY IN BROWSER.
2. Full 8-mobile roster with distinct weapons.
3. WebSocket server: rooms, join codes, delay-queue turns, state sync. VERIFY 2 BROWSER TABS DUELING.
4. Team modes (2v2/3v3/4v4) generalization.
5. Nostr: NIP-07 login, relay picker (50 curated, no primal.net), match result posting, challenge broadcast.
6. Polish: screen shake, particles, SFX via Web Audio, HUD, menus.
