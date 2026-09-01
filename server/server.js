import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = process.env.PORT || 8081;

// ============================================================
// GAME STATE & ROOM MANAGEMENT
// ============================================================

// Generate a 6-character room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const rooms = new Map(); // roomCode -> room object
const clientToRoom = new Map(); // ws -> { roomCode, playerId }

// Room object structure:
// {
//   code: string,
//   creatorId: playerId,
//   mode: '1v1' | '2v2' | '3v3' | '4v4',
//   status: 'waiting_for_players' | 'in_progress' | 'finished',
//   terrainSeed: number | null,
//   players: { [playerId]: { id, name, mobileId, teamIdx, slotIdx, connected, ws } },
//   teams: 2 | 4,  // depends on mode
//   turnQueue: { playerId, readyTick }[],
//   currentTick: number,
//   activePlayerId: playerId,
//   playerHp: { playerId: hp },
//   terrain: { carves: [ { x, y, radius } ] },
// }

// Slot mapping per mode:
// 1v1: t0p0, t1p0 (2 slots, team size 1)
// 2v2: t0p0, t0p1, t1p0, t1p1 (4 slots, team size 2)
// 3v3: t0p0, t0p1, t0p2, t1p0, t1p1, t1p2 (6 slots, team size 3)
// 4v4: t0p0, t0p1, t0p2, t0p3, t1p0, t1p1, t1p2, t1p3 (8 slots, team size 4)

function getModeConfig(mode) {
  const configs = {
    '1v1': { teams: 2, playersPerTeam: 1 },
    '2v2': { teams: 2, playersPerTeam: 2 },
    '3v3': { teams: 2, playersPerTeam: 3 },
    '4v4': { teams: 2, playersPerTeam: 4 },
  };
  return configs[mode];
}

function createRoom(creatorId, creatorName, mode) {
  const config = getModeConfig(mode);
  if (!config) throw new Error('Invalid mode');

  const room = {
    code: generateRoomCode(),
    creatorId,
    mode,
    status: 'waiting_for_players',
    terrainSeed: null,
    players: {},
    teams: config.teams,
    playersPerTeam: config.playersPerTeam,
    turnQueue: [],
    currentTick: 0,
    activePlayerId: null,
    playerHp: {},
    terrain: { carves: [] },
    shotInProgress: null, // { playerId, angle, power, slot }
  };

  // Place creator in slot t0p0
  const creatorId_t0p0 = 't0p0';
  room.players[creatorId_t0p0] = {
    id: creatorId_t0p0,
    name: creatorName,
    mobileId: null,
    teamIdx: 0,
    slotIdx: 0,
    connected: true,
    ws: null, // will be set when joining
  };

  rooms.set(room.code, room);
  return room;
}

function findNextPlayerSlot(room) {
  const config = getModeConfig(room.mode);
  if (!config) return null;

  const { teams, playersPerTeam } = config;
  const totalSlots = teams * playersPerTeam;

  // Find first empty slot
  for (let t = 0; t < teams; t++) {
    for (let p = 0; p < playersPerTeam; p++) {
      const slotId = `t${t}p${p}`;
      if (!room.players[slotId]) {
        return { slotId, teamIdx: t, slotIdx: p };
      }
    }
  }
  return null;
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================

function handleCreateRoom(ws, msg, clientRoomInfo) {
  try {
    const { playerName, mode } = msg;
    if (!playerName || !mode) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing playerName or mode' }));
      return;
    }

    // Create a unique creator ID for this session
    const creatorId = `client_${Math.random().toString(36).substr(2, 9)}`;
    const room = createRoom(creatorId, playerName, mode);
    const slotId = 't0p0';

    // Track client -> room mapping
    clientToRoom.set(ws, { roomCode: room.code, playerId: slotId });
    room.players[slotId].ws = ws;

    ws.send(JSON.stringify({
      type: 'room_created',
      roomCode: room.code,
      yourPlayerId: slotId,
      mode,
      roomState: buildRoomState(room),
    }));

    // Broadcast to any other players in room (none yet, but good practice)
    broadcastToRoom(room, {
      type: 'room_state',
      players: buildRoomState(room).players,
    });
  } catch (e) {
    console.error('createRoom error:', e);
    ws.send(JSON.stringify({ type: 'error', message: e.message }));
  }
}

function handleJoinRoom(ws, msg, clientRoomInfo) {
  try {
    const { roomCode, playerName } = msg;
    if (!roomCode || !playerName) {
      ws.send(JSON.stringify({ type: 'join_error', reason: 'Missing roomCode or playerName' }));
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      ws.send(JSON.stringify({ type: 'join_error', reason: 'room_not_found' }));
      return;
    }

    if (room.status !== 'waiting_for_players') {
      ws.send(JSON.stringify({ type: 'join_error', reason: 'already_started' }));
      return;
    }

    const slot = findNextPlayerSlot(room);
    if (!slot) {
      ws.send(JSON.stringify({ type: 'join_error', reason: 'room_full' }));
      return;
    }

    const slotId = slot.slotId;
    room.players[slotId] = {
      id: slotId,
      name: playerName,
      mobileId: null,
      teamIdx: slot.teamIdx,
      slotIdx: slot.slotIdx,
      connected: true,
      ws,
    };

    clientToRoom.set(ws, { roomCode, playerId: slotId });

    ws.send(JSON.stringify({
      type: 'room_joined',
      roomCode,
      yourPlayerId: slotId,
      mode: room.mode,
      roomState: buildRoomState(room),
    }));

    // Broadcast updated room state to all players
    broadcastToRoom(room, {
      type: 'room_state',
      players: buildRoomState(room).players,
    });
  } catch (e) {
    console.error('joinRoom error:', e);
    ws.send(JSON.stringify({ type: 'error', message: e.message }));
  }
}

function handleSelectMobile(ws, msg, clientRoomInfo) {
  try {
    const { mobileId } = msg;
    if (!clientRoomInfo || !mobileId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not in a room or missing mobileId' }));
      return;
    }

    const room = rooms.get(clientRoomInfo.roomCode);
    if (!room) return;

    const player = room.players[clientRoomInfo.playerId];
    if (!player) return;

    player.mobileId = mobileId;

    // Broadcast updated room state
    broadcastToRoom(room, {
      type: 'room_state',
      players: buildRoomState(room).players,
    });
  } catch (e) {
    console.error('selectMobile error:', e);
    ws.send(JSON.stringify({ type: 'error', message: e.message }));
  }
}

function handleStartMatch(ws, msg, clientRoomInfo) {
  try {
    if (!clientRoomInfo) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not in a room' }));
      return;
    }

    const room = rooms.get(clientRoomInfo.roomCode);
    if (!room) return;

    // Only room creator can start
    if (clientRoomInfo.playerId !== room.creatorId && room.players['t0p0'].ws !== ws) {
      ws.send(JSON.stringify({ type: 'error', message: 'Only room creator can start match' }));
      return;
    }

    // Check all slots have mobiles selected
    for (const playerId in room.players) {
      const player = room.players[playerId];
      if (!player.mobileId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not all players have selected a mobile' }));
        return;
      }
    }

    // Start match
    room.status = 'in_progress';
    room.terrainSeed = Math.floor(Math.random() * 0xffffffff);
    room.currentTick = 0;

    // Initialize turn queue
    const playerIds = Object.keys(room.players).sort(); // ensures consistent ordering
    room.turnQueue = playerIds.map(playerId => ({ playerId, readyTick: 0 }));
    room.activePlayerId = playerIds[0];

    // Initialize HP from roster
    for (const playerId of playerIds) {
      // In a real game, we'd look up max HP from MOBILE_DEFS
      // For now, use a reasonable default
      room.playerHp[playerId] = 100;
    }

    // Broadcast match started to all clients
    const rosterConfig = buildRosterFromRoom(room);
    broadcastToRoom(room, {
      type: 'match_started',
      terrainSeed: room.terrainSeed,
      roster: rosterConfig,
      firstPlayerId: room.activePlayerId,
    });
  } catch (e) {
    console.error('startMatch error:', e);
    ws.send(JSON.stringify({ type: 'error', message: e.message }));
  }
}

function handleFireShot(ws, msg, clientRoomInfo) {
  try {
    const { angle, power, slot } = msg;
    if (!clientRoomInfo || angle === undefined || power === undefined || !slot) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid fire_shot message' }));
      return;
    }

    const room = rooms.get(clientRoomInfo.roomCode);
    if (!room || room.status !== 'in_progress') {
      ws.send(JSON.stringify({ type: 'shot_rejected', reason: 'match_not_in_progress' }));
      return;
    }

    const playerId = clientRoomInfo.playerId;
    if (playerId !== room.activePlayerId) {
      ws.send(JSON.stringify({ type: 'shot_rejected', reason: 'not_your_turn' }));
      return;
    }

    // Validate the slot exists for the player's mobile
    // (In a full implementation, check MOBILE_DEFS)
    const validSlots = ['s1', 's2', 'ss'];
    if (!validSlots.includes(slot)) {
      ws.send(JSON.stringify({ type: 'shot_rejected', reason: 'invalid_slot' }));
      return;
    }

    // TODO: Check charge requirement for SS

    // Broadcast shot fired to all clients
    room.shotInProgress = { playerId, angle, power, slot, shooterWs: ws };
    for (const player of Object.values(room.players)) {
      if (!player.ws || !player.connected) continue;
      player.ws.send(JSON.stringify({
        type: 'shot_fired',
        playerId,
        angle,
        power,
        slot,
        isYourShot: player.ws === ws,
      }));
    }
  } catch (e) {
    console.error('fireShot error:', e);
    ws.send(JSON.stringify({ type: 'error', message: e.message }));
  }
}

function handleShotResult(ws, msg, clientRoomInfo) {
  try {
    const { terrainDiff, playerHpDeltas, eliminated } = msg;
    if (!clientRoomInfo || !terrainDiff || !playerHpDeltas) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid shot_result message' }));
      return;
    }

    const room = rooms.get(clientRoomInfo.roomCode);
    if (!room || room.status !== 'in_progress') return;

    // Verify sender is the one who just fired
    if (!room.shotInProgress || room.shotInProgress.playerId !== clientRoomInfo.playerId) {
      ws.send(JSON.stringify({ type: 'error', message: 'shot_result from non-shooter' }));
      return;
    }

    // Apply terrain changes
    room.terrain.carves.push(...terrainDiff);

    // Apply HP deltas
    for (const playerId in playerHpDeltas) {
      room.playerHp[playerId] = Math.max(0, (room.playerHp[playerId] || 100) + playerHpDeltas[playerId]);
    }

    // Broadcast result to all other clients
    const otherClients = Object.values(room.players).filter(p => p.ws !== ws);
    const resultMsg = {
      type: 'result_confirmed',
      terrainDiff,
      playerHpDeltas,
      eliminated: eliminated || [],
    };
    for (const player of otherClients) {
      if (player.ws && player.connected) {
        player.ws.send(JSON.stringify(resultMsg));
      }
    }

    // Check win condition
    const playersAlive = Object.keys(room.players).filter(
      pid => !(eliminated && eliminated.includes(pid))
    );
    const teamsAlive = new Set(
      playersAlive.map(pid => room.players[pid].teamIdx)
    );

    if (teamsAlive.size <= 1) {
      room.status = 'finished';
      const winningTeam = teamsAlive.size === 1 ? [...teamsAlive][0] : null;
      broadcastToRoom(room, {
        type: 'game_over',
        winningTeam,
      });
    } else {
      // Advance turn: schedule next player
      const currentPlayer = room.players[clientRoomInfo.playerId];
      const weaponDelays = { s1: 18, s2: 30, ss: 55 }; // default delays
      const delay = weaponDelays[room.shotInProgress.slot] || 20;
      room.currentTick = Math.max(room.currentTick, room.activePlayerId ? 0 : 0) + delay;

      // Find next alive player
      let nextIdx = -1;
      for (let i = 0; i < room.turnQueue.length; i++) {
        if (room.turnQueue[i].playerId === clientRoomInfo.playerId) {
          nextIdx = i;
          break;
        }
      }

      if (nextIdx !== -1) {
        // Move this player to back of queue with new ready tick
        const entry = room.turnQueue.splice(nextIdx, 1)[0];
        entry.readyTick = room.currentTick + delay;
        room.turnQueue.push(entry);

        // Sort and find next active player
        room.turnQueue.sort((a, b) => a.readyTick - b.readyTick);
        room.activePlayerId = room.turnQueue[0].playerId;
      }
    }

    room.shotInProgress = null;
  } catch (e) {
    console.error('shotResult error:', e);
    ws.send(JSON.stringify({ type: 'error', message: e.message }));
  }
}

function handleLeaveRoom(ws, msg, clientRoomInfo) {
  try {
    if (!clientRoomInfo) return;
    const room = rooms.get(clientRoomInfo.roomCode);
    if (!room) return;

    const player = room.players[clientRoomInfo.playerId];
    if (player) {
      player.connected = false;
      player.ws = null;
    }

    clientToRoom.delete(ws);

    // If all players disconnected, delete room
    const anyConnected = Object.values(room.players).some(p => p.connected);
    if (!anyConnected) {
      rooms.delete(clientRoomInfo.roomCode);
    } else {
      // Notify remaining players
      broadcastToRoom(room, {
        type: 'player_disconnected',
        playerId: clientRoomInfo.playerId,
      });
    }
  } catch (e) {
    console.error('leaveRoom error:', e);
  }
}

// ============================================================
// UTILITIES
// ============================================================

function buildRoomState(room) {
  return {
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      mobileId: p.mobileId,
      connected: p.connected,
    })),
    teams: room.teams,
  };
}

function buildRosterFromRoom(room) {
  const rosterByTeam = {};
  for (let i = 0; i < room.teams; i++) {
    rosterByTeam[i] = [];
  }

  const playerIds = Object.keys(room.players).sort();
  for (const playerId of playerIds) {
    const player = room.players[playerId];
    if (!rosterByTeam[player.teamIdx]) {
      rosterByTeam[player.teamIdx] = [];
    }
    rosterByTeam[player.teamIdx].push(player.mobileId);
  }

  const teams = [];
  for (let i = 0; i < room.teams; i++) {
    teams.push({ mobiles: rosterByTeam[i] || [] });
  }

  return { teams };
}

function broadcastToRoom(room, msg) {
  for (const player of Object.values(room.players)) {
    if (player.ws && player.connected) {
      player.ws.send(JSON.stringify(msg));
    }
  }
}

// ============================================================
// WEBSOCKET SERVER
// ============================================================

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const clientRoomInfo = clientToRoom.get(ws);

      console.log('Received message:', msg.type, clientRoomInfo?.roomCode);

      switch (msg.type) {
        case 'create_room':
          handleCreateRoom(ws, msg, clientRoomInfo);
          break;
        case 'join_room':
          handleJoinRoom(ws, msg, clientRoomInfo);
          break;
        case 'select_mobile':
          handleSelectMobile(ws, msg, clientRoomInfo);
          break;
        case 'start_match':
          handleStartMatch(ws, msg, clientRoomInfo);
          break;
        case 'fire_shot':
          handleFireShot(ws, msg, clientRoomInfo);
          break;
        case 'shot_result':
          handleShotResult(ws, msg, clientRoomInfo);
          break;
        case 'leave_room':
          handleLeaveRoom(ws, msg, clientRoomInfo);
          break;
        default:
          console.warn('Unknown message type:', msg.type);
      }
    } catch (e) {
      console.error('Message handling error:', e);
      ws.send(JSON.stringify({ type: 'error', message: 'Server error' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    const clientRoomInfo = clientToRoom.get(ws);
    if (clientRoomInfo) {
      handleLeaveRoom(ws, {}, clientRoomInfo);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

server.listen(PORT, () => {
  console.log(`ORBOUND multiplayer server listening on ws://localhost:${PORT}`);
});
