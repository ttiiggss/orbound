// ORBOUND — Nostr identity & social layer (NIP-07 login, relay picker, result posting, challenge broadcast)
// All features gracefully degrade if window.nostr is unavailable.

'use strict';

const CURATED_RELAYS = [
  // Default 3
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  // Additional curated public relays (47 more for 50 total)
  'wss://offchain.pub',
  'wss://nostr.band',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.mom',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.nostr.info',
  'wss://nostr.rocks',
  'wss://relay.nostr.vision',
  'wss://nostr.lu',
  'wss://nostr.oxtr.dev',
  'wss://nostr.h3z.jp',
  'wss://relay.mostr.pub',
  'wss://nostr.fmt.wiz.biz',
  'wss://relay.current.fyi',
  'wss://nostr.zbd.gg',
  'wss://nostr.slothy.win',
  'wss://nostr.plebstr.com',
  'wss://nostr.ronaldstoner.com',
  'wss://nostr.scam',
  'wss://nostr.semisol.dev',
  'wss://nostr.spore.ws',
  'wss://nostr.swede.se',
  'wss://nostr.sysop.host',
  'wss://nostr.tokyo',
  'wss://nostr-1.naddr.top',
  'wss://nostr-2.naddr.top',
  'wss://nostr.thegrommet.xyz',
  'wss://nostr.tomharding.uk',
  'wss://nostr.tyranny.club',
  'wss://nostr.utxo.club',
  'wss://nostr.validator.social',
  'wss://nostr.vanderwarped.com',
  'wss://nostr.veeck.net',
  'wss://nostr.walleye.xyz',
  'wss://nostr.world',
  'wss://nostr.wrla.ch',
  'wss://nostr.yokai.live',
  'wss://nostr.zeph.me',
  'wss://relay.archmage.social',
  'wss://relay.stoner.com',
  'wss://relay.minds.com',
  'wss://relay.orangepill.dev',
  'wss://relay.plebstr.com',
];

// State
const NostrLayer = {
  // Nostr tools module (loaded dynamically)
  tools: null,
  toolsLoading: null,

  // Session state
  pubkey: null,
  selectedRelays: new Set(CURATED_RELAYS.slice(0, 3)), // default to first 3
  isAvailable: false,
  uiVisible: false,

  // UI elements
  uiContainer: null,
  loginBtn: null,
  npubDisplay: null,
  relayPickerPanel: null,
  shareResultBtn: null,

  // ============================================================
  // INIT
  // ============================================================
  async init() {
    // Check if Nostr is available
    this.isAvailable = typeof window.nostr !== 'undefined';
    if (this.isAvailable) {
      console.log('NostrLayer: window.nostr detected');
      // Load nostr-tools if Nostr is available
      await this.loadTools();
    } else {
      console.log('NostrLayer: window.nostr not detected, Nostr features disabled');
    }

    // Restore relay selection from localStorage
    this.restoreRelaySelection();

    // Always build UI (login button disabled if no Nostr, relays still selectable)
    this.buildUI();
    this.uiVisible = true;

    console.log('NostrLayer: initialized');
  },

  async loadTools() {
    if (this.tools) return;
    if (this.toolsLoading) return this.toolsLoading;

    this.toolsLoading = (async () => {
      try {
        const mod = await import('https://esm.run/nostr-tools@2.7.2');
        this.tools = mod;
        console.log('NostrLayer: nostr-tools loaded');
      } catch (e) {
        console.error('NostrLayer: failed to load nostr-tools', e);
        this.tools = null;
      }
    })();

    return this.toolsLoading;
  },

  // ============================================================
  // LOGIN / IDENTITY
  // ============================================================
  async login() {
    if (!this.isAvailable) {
      this.showMsg('Nostr extension not available');
      return false;
    }

    try {
      this.pubkey = await window.nostr.getPublicKey();
      console.log('NostrLayer: logged in with pubkey', this.pubkey);
      this.updateLoginUI();
      return true;
    } catch (e) {
      console.error('NostrLayer: login failed', e);
      this.showMsg('Login failed: ' + e.message);
      return false;
    }
  },

  logout() {
    this.pubkey = null;
    this.updateLoginUI();
    this.showMsg('Logged out');
  },

  updateLoginUI() {
    if (!this.loginBtn || !this.npubDisplay) return;

    if (this.pubkey) {
      const encoded = this.tools?.nip19?.npubEncode?.(this.pubkey) || this.pubkey;
      this.npubDisplay.textContent = encoded.substring(0, 16) + '...';
      this.loginBtn.textContent = 'Logout';
    } else {
      this.npubDisplay.textContent = '';
      this.loginBtn.textContent = 'Login (Nostr)';
    }
  },

  // ============================================================
  // RELAY MANAGEMENT
  // ============================================================
  saveRelaySelection() {
    const relays = Array.from(this.selectedRelays);
    localStorage.setItem('orbound_nostr_relays', JSON.stringify(relays));
  },

  restoreRelaySelection() {
    try {
      const saved = localStorage.getItem('orbound_nostr_relays');
      if (saved) {
        this.selectedRelays = new Set(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('NostrLayer: failed to restore relay selection', e);
    }
  },

  getSelectedRelays() {
    return Array.from(this.selectedRelays);
  },

  // ============================================================
  // EVENT SIGNING & PUBLISHING
  // ============================================================
  async signEvent(event) {
    if (!this.isAvailable || !this.pubkey) {
      throw new Error('Not logged in');
    }
    try {
      const signed = await window.nostr.signEvent(event);
      return signed;
    } catch (e) {
      console.error('NostrLayer: event signing failed', e);
      throw e;
    }
  },

  async publishEvent(event) {
    if (!this.tools?.finalizeEvent) {
      throw new Error('nostr-tools not loaded');
    }

    const relays = this.getSelectedRelays();
    if (relays.length === 0) {
      throw new Error('No relays selected');
    }

    const results = [];
    for (const relayUrl of relays) {
      const result = await this.publishToRelay(relayUrl, event).catch(e => ({
        relay: relayUrl,
        error: e.message,
        ok: false,
      }));
      results.push(result);
    }

    return results;
  },

  async publishToRelay(relayUrl, event) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Relay ${relayUrl} connection timeout`));
      }, 5000);

      try {
        const ws = new WebSocket(relayUrl);

        ws.onopen = async () => {
          try {
            // Sign event if not already signed
            if (!event.sig) {
              const signed = await this.signEvent(event);
              Object.assign(event, signed);
            }
            ws.send(JSON.stringify(['EVENT', event]));
          } catch (e) {
            clearTimeout(timeout);
            ws.close();
            reject(e);
          }
        };

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (Array.isArray(data)) {
              if (data[0] === 'OK') {
                clearTimeout(timeout);
                ws.close();
                resolve({ relay: relayUrl, ok: data[1], message: data[2] });
              }
            }
          } catch (e) {
            console.warn('NostrLayer: failed to parse relay message', e);
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timeout);
          reject(new Error(`Relay connection error: ${err}`));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
        };
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  },

  // ============================================================
  // MATCH RESULT POSTING
  // ============================================================
  async postMatchResult(winner, loser) {
    if (!this.isAvailable || !this.pubkey || !this.tools) {
      throw new Error('Nostr not available or not logged in');
    }

    const now = Math.floor(Date.now() / 1000);
    const teamWinner = typeof winner === 'number' ? winner + 1 : '?';
    const content = `⚔️ Just battled in ORBOUND — Team ${teamWinner} won! #orbound`;

    const event = {
      kind: 1,
      pubkey: this.pubkey,
      created_at: now,
      tags: [['t', 'orbound']],
      content,
    };

    try {
      const signed = await this.signEvent(event);
      const results = await this.publishEvent(signed);

      const okCount = results.filter(r => r.ok).length;
      console.log(
        `NostrLayer: posted result to ${okCount}/${results.length} relays`,
        results
      );

      return { success: true, results, event: signed };
    } catch (e) {
      console.error('NostrLayer: failed to post match result', e);
      throw e;
    }
  },

  // ============================================================
  // CHALLENGE BROADCASTING
  // ============================================================
  async broadcastChallenge(roomCode, openSlots) {
    if (!this.isAvailable || !this.pubkey || !this.tools) {
      throw new Error('Nostr not available or not logged in');
    }

    const now = Math.floor(Date.now() / 1000);
    const content = `🎮 Open ORBOUND match! Room: ${roomCode} | Slots: ${openSlots}`;

    const event = {
      kind: 30078, // parameterized replaceable event
      pubkey: this.pubkey,
      created_at: now,
      tags: [
        ['d', 'orbound-challenge-' + roomCode],
        ['t', 'orbound-challenge'],
      ],
      content,
    };

    try {
      const signed = await this.signEvent(event);
      const results = await this.publishEvent(signed);

      const okCount = results.filter(r => r.ok).length;
      console.log(
        `NostrLayer: broadcast challenge to ${okCount}/${results.length} relays`,
        results
      );

      return { success: true, results, event: signed };
    } catch (e) {
      console.error('NostrLayer: failed to broadcast challenge', e);
      throw e;
    }
  },

  // ============================================================
  // UI BUILDING
  // ============================================================
  buildUI() {
    const root = document.getElementById('ui-root');
    if (!root) return;

    this.uiContainer = document.createElement('div');
    this.uiContainer.id = 'nostr-ui-container';
    this.uiContainer.style.cssText = `
      position: fixed;
      top: 8px;
      left: 8px;
      z-index: 1000;
      font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
      pointer-events: auto;
    `;

    // Login button + npub display
    const loginContainer = document.createElement('div');
    loginContainer.style.cssText = `
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    `;

    this.loginBtn = document.createElement('button');
    this.loginBtn.textContent = 'Login (Nostr)';
    this.loginBtn.style.cssText = `
      padding: 6px 12px;
      background: #402c68;
      color: #fff8e7;
      border: 2px solid #ffcb3d;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.2s;
    `;
    this.loginBtn.onmouseover = () => {
      this.loginBtn.style.background = '#502d7a';
    };
    this.loginBtn.onmouseout = () => {
      this.loginBtn.style.background = '#402c68';
    };
    this.loginBtn.onclick = () => {
      if (this.pubkey) {
        this.logout();
      } else {
        this.login();
      }
    };

    this.npubDisplay = document.createElement('div');
    this.npubDisplay.style.cssText = `
      font-size: 11px;
      color: #ffcb3d;
      font-family: 'Courier New', monospace;
      min-width: 120px;
    `;

    loginContainer.appendChild(this.loginBtn);
    loginContainer.appendChild(this.npubDisplay);

    // Relay picker toggle button
    const relayToggleBtn = document.createElement('button');
    relayToggleBtn.textContent = '🔌 Relays';
    relayToggleBtn.style.cssText = `
      padding: 6px 12px;
      background: #402c68;
      color: #fff8e7;
      border: 2px solid #ffcb3d;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      cursor: pointer;
      transition: background 0.2s;
    `;
    relayToggleBtn.onmouseover = () => {
      relayToggleBtn.style.background = '#502d7a';
    };
    relayToggleBtn.onmouseout = () => {
      relayToggleBtn.style.background = '#402c68';
    };

    // Relay picker panel
    this.relayPickerPanel = document.createElement('div');
    this.relayPickerPanel.style.cssText = `
      position: fixed;
      top: 50px;
      left: 8px;
      width: 300px;
      max-height: 500px;
      background: rgba(44, 31, 74, 0.95);
      border: 2px solid #ffcb3d;
      border-radius: 4px;
      padding: 12px;
      z-index: 1001;
      overflow-y: auto;
      display: none;
      pointer-events: auto;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    `;

    const relayTitle = document.createElement('div');
    relayTitle.textContent = 'Select Relays';
    relayTitle.style.cssText = `
      font-weight: bold;
      color: #ffcb3d;
      margin-bottom: 8px;
      font-size: 14px;
    `;
    this.relayPickerPanel.appendChild(relayTitle);

    const relayList = document.createElement('div');
    for (const relay of CURATED_RELAYS) {
      const label = document.createElement('label');
      label.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        color: #fff8e7;
        font-size: 11px;
        cursor: pointer;
      `;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.selectedRelays.has(relay);
      checkbox.value = relay;
      checkbox.onchange = () => {
        if (checkbox.checked) {
          this.selectedRelays.add(relay);
        } else {
          this.selectedRelays.delete(relay);
        }
        this.saveRelaySelection();
      };

      const relayText = document.createElement('span');
      relayText.textContent = relay.replace('wss://', '').substring(0, 30) + '...';
      relayText.title = relay;

      label.appendChild(checkbox);
      label.appendChild(relayText);
      relayList.appendChild(label);
    }
    this.relayPickerPanel.appendChild(relayList);

    relayToggleBtn.onclick = () => {
      const isVisible = this.relayPickerPanel.style.display !== 'none';
      this.relayPickerPanel.style.display = isVisible ? 'none' : 'block';
    };

    this.uiContainer.appendChild(loginContainer);
    this.uiContainer.appendChild(relayToggleBtn);
    this.uiContainer.appendChild(this.relayPickerPanel);

    root.appendChild(this.uiContainer);
  },

  // ============================================================
  // SHARE RESULT BUTTON (added to gameover screen)
  // ============================================================
  createShareResultButton() {
    if (!this.shareResultBtn) {
      this.shareResultBtn = document.createElement('button');
      this.shareResultBtn.id = 'share-result-btn';
      this.shareResultBtn.textContent = '📢 Share to Nostr';
      this.shareResultBtn.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        padding: 10px 16px;
        background: #402c68;
        color: #fff8e7;
        border: 2px solid #ffcb3d;
        border-radius: 4px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        z-index: 999;
        transition: all 0.2s;
        pointer-events: auto;
      `;

      this.shareResultBtn.onmouseover = () => {
        this.shareResultBtn.style.background = '#502d7a';
        this.shareResultBtn.style.transform = 'scale(1.05)';
      };

      this.shareResultBtn.onmouseout = () => {
        this.shareResultBtn.style.background = '#402c68';
        this.shareResultBtn.style.transform = 'scale(1)';
      };

      this.shareResultBtn.onclick = () => {
        this.handleShareClick();
      };
    }

    // Add button to UI root
    const root = document.getElementById('ui-root');
    if (root && !root.contains(this.shareResultBtn)) {
      root.appendChild(this.shareResultBtn);
    }
  },

  hideShareResultButton() {
    if (this.shareResultBtn) {
      this.shareResultBtn.style.display = 'none';
    }
  },

  showShareResultButton() {
    if (!this.isAvailable || !this.pubkey) {
      return; // Don't show if no Nostr or not logged in
    }
    this.createShareResultButton();
    this.shareResultBtn.style.display = 'block';
  },

  async handleShareClick() {
    if (!window.ORBOUND_GAME_STATE) {
      this.showMsg('No game state available');
      return;
    }

    const state = window.ORBOUND_GAME_STATE;
    if (state.phase !== 'gameover') {
      this.showMsg('No match to share');
      return;
    }

    this.shareResultBtn.textContent = 'Posting...';
    this.shareResultBtn.disabled = true;

    try {
      await this.postMatchResult(state.winner, null);
      this.showMsg('✓ Posted to Nostr!');
      this.shareResultBtn.textContent = '📢 Share to Nostr';
    } catch (e) {
      this.showMsg('Failed: ' + e.message);
      this.shareResultBtn.textContent = '📢 Share to Nostr';
    } finally {
      this.shareResultBtn.disabled = false;
    }
  },

  // ============================================================
  // UTILITIES
  // ============================================================
  showMsg(msg) {
    const msgEl = document.createElement('div');
    msgEl.textContent = msg;
    msgEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: #2c1f4a;
      color: #fff8e7;
      border: 2px solid #ffcb3d;
      padding: 10px 16px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 2000;
      animation: fadeInOut 3s ease-in-out;
    `;

    const root = document.getElementById('ui-root') || document.body;
    root.appendChild(msgEl);

    setTimeout(() => msgEl.remove(), 3000);
  },
};

window.NostrLayer = NostrLayer;
