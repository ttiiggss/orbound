// ORBOUND — Multiplayer network layer (WebSocket client)
// Handles room joining, mobile selection, shot sending, and result synchronization.
// Gracefully degrades if server is unavailable (single-player mode still works).

'use strict';

const NetworkLayer = {
  // Connection state
  ws: null,
  serverUrl: null,
  connected: false,

  // Room state
  roomCode: null,
  playerId: null,
  players: [],
  mode: null,
  roomStatus: 'waiting_for_players', // waiting_for_players | in_progress | finished

  // Match state (mirrored from server)
  terrainSeed: null,
  roster: null,
  activePlayerId: null,

  // Shot state
  shotInProgress: false,
  lastShotResult: null,

  // Callbacks for game.js integration
  onRoomCreated: null,
  onRoomJoined: null,
  onRoomStateUpdated: null,
  onMatchStarted: null,
  onShotFired: null,
  onResultConfirmed: null,
  onPlayerDisconnected: null,
  onGameOver: null,
  onError: null,

  // ============================================================
  // CONNECTION
  // ============================================================
  async connect(serverUrl) {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      try {
        this.serverUrl = serverUrl;
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          this.connected = true;
          console.log('NetworkLayer: connected to server');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data));
        };

        this.ws.onerror = (err) => {
          console.error('NetworkLayer: WebSocket error', err);
          this.connected = false;
          if (this.onError) this.onError(err);
          reject(err);
        };

        this.ws.onclose = () => {
          this.connected = false;
          console.log('NetworkLayer: disconnected from server');
        };

        // Timeout if connection takes too long
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      } catch (e) {
        reject(e);
      }
    });
  },

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.roomCode = null;
    this.playerId = null;
  },

  // ============================================================
  // ROOM MANAGEMENT
  // ============================================================
  async createRoom(playerName, mode) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }

    return new Promise((resolve, reject) => {
      const handler = (msg) => {
        if (msg.type === 'room_created') {
          this.roomCode = msg.roomCode;
          this.playerId = msg.yourPlayerId;
          this.mode = msg.mode;
          this.players = msg.roomState.players;
          if (this.onRoomCreated) this.onRoomCreated(msg);
          resolve(msg);
          this.ws.removeEventListener('message', wrappedHandler);
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
          this.ws.removeEventListener('message', wrappedHandler);
        }
      };

      const wrappedHandler = (event) => handler(JSON.parse(event.data));
      this.ws.addEventListener('message', wrappedHandler);

      this.send({
        type: 'create_room',
        playerName,
        mode,
      });

      setTimeout(() => {
        reject(new Error('create_room timeout'));
        this.ws.removeEventListener('message', wrappedHandler);
      }, 5000);
    });
  },

  async joinRoom(roomCode, playerName) {
    if (!this.connected) {
      throw new Error('Not connected to server');
    }

    return new Promise((resolve, reject) => {
      const handler = (msg) => {
        if (msg.type === 'room_joined') {
          this.roomCode = msg.roomCode;
          this.playerId = msg.yourPlayerId;
          this.mode = msg.mode;
          this.players = msg.roomState.players;
          if (this.onRoomJoined) this.onRoomJoined(msg);
          resolve(msg);
          this.ws.removeEventListener('message', wrappedHandler);
        } else if (msg.type === 'join_error') {
          reject(new Error(`join_error: ${msg.reason}`));
          this.ws.removeEventListener('message', wrappedHandler);
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
          this.ws.removeEventListener('message', wrappedHandler);
        }
      };

      const wrappedHandler = (event) => handler(JSON.parse(event.data));
      this.ws.addEventListener('message', wrappedHandler);

      this.send({
        type: 'join_room',
        roomCode,
        playerName,
      });

      setTimeout(() => {
        reject(new Error('join_room timeout'));
        this.ws.removeEventListener('message', wrappedHandler);
      }, 5000);
    });
  },

  selectMobile(mobileId) {
    this.send({
      type: 'select_mobile',
      mobileId,
    });
  },

  startMatch() {
    this.send({
      type: 'start_match',
    });
  },

  leaveRoom() {
    this.send({
      type: 'leave_room',
    });
  },

  // ============================================================
  // SHOT FIRING & RESULTS
  // ============================================================
  fireShot(angle, power, slot) {
    this.shotInProgress = true;
    this.send({
      type: 'fire_shot',
      angle,
      power,
      slot,
    });
  },

  sendShotResult(terrainDiff, playerHpDeltas, eliminated) {
    this.send({
      type: 'shot_result',
      terrainDiff,
      playerHpDeltas,
      eliminated: eliminated || [],
    });
    this.shotInProgress = false;
  },

  // ============================================================
  // MESSAGE HANDLING
  // ============================================================
  handleMessage(msg) {
    console.log('NetworkLayer: received', msg.type);

    switch (msg.type) {
      case 'room_state':
        this.players = msg.players;
        if (this.onRoomStateUpdated) this.onRoomStateUpdated(msg);
        break;

      case 'match_started':
        this.terrainSeed = msg.terrainSeed;
        this.roster = msg.roster;
        this.activePlayerId = msg.firstPlayerId;
        if (this.onMatchStarted) this.onMatchStarted(msg);
        break;

      case 'shot_fired':
        this.activePlayerId = msg.playerId;
        if (this.onShotFired) this.onShotFired(msg);
        break;

      case 'shot_rejected':
        this.shotInProgress = false;
        if (this.onError) this.onError(new Error(`shot_rejected: ${msg.reason}`));
        break;

      case 'result_confirmed':
        this.lastShotResult = msg;
        if (this.onResultConfirmed) this.onResultConfirmed(msg);
        break;

      case 'player_disconnected':
        if (this.onPlayerDisconnected) this.onPlayerDisconnected(msg);
        break;

      case 'game_over':
        if (this.onGameOver) this.onGameOver(msg);
        break;

      case 'error':
      case 'join_error':
      case 'shot_rejected':
        if (this.onError) this.onError(new Error(msg.message || msg.reason));
        break;
    }
  },

  // ============================================================
  // UTILITIES
  // ============================================================
  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('NetworkLayer: not connected, message dropped', msg.type);
    }
  },

  isConnected() {
    return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
  },

  isInRoom() {
    return this.connected && this.roomCode && this.playerId;
  },

  isInMatch() {
    return this.isInRoom() && this.roomStatus === 'in_progress';
  },
};

window.NetworkLayer = NetworkLayer;
