const { chromium } = require('playwright-core');
const EXE = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });

  // Two fully independent browser contexts = two independent "players"
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const errorsA = [], errorsB = [];
  pageA.on('pageerror', e => errorsA.push(e.message));
  pageB.on('pageerror', e => errorsB.push(e.message));

  await pageA.goto('http://localhost:8791/index.html', { waitUntil: 'load' });
  await pageB.goto('http://localhost:8791/index.html', { waitUntil: 'load' });
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);

  const hasNet = await pageA.evaluate(() => !!window.NetworkLayer);
  console.log('NetworkLayer present:', hasNet);
  if (!hasNet) { console.log('FAIL: no NetworkLayer, aborting'); await browser.close(); process.exit(1); }

  // --- A creates a room ---
  // IMPORTANT: do NOT overwrite window.NetworkLayer.onRoomCreated etc. — game.js
  // installs its own real handlers at load time (e.g. onMatchStarted calls the
  // real newMatch()). Clobbering them here would break the actual game the same
  // way a real second UI layer must not clobber them either. Instead, chain onto
  // the existing handler so both the game's real logic AND our test observer run.
  await pageA.evaluate(() => {
    window.__testEvents = [];
    for (const ev of ['onRoomCreated','onRoomJoined','onMatchStarted','onShotFired','onResultConfirmed','onShotRejected','onError']) {
      const prev = window.NetworkLayer[ev];
      window.NetworkLayer[ev] = (msg) => { window.__testEvents.push({ ev, msg }); if (prev) prev(msg); };
    }
  });
  await pageB.evaluate(() => {
    window.__testEvents = [];
    for (const ev of ['onRoomCreated','onRoomJoined','onMatchStarted','onShotFired','onResultConfirmed','onShotRejected','onError']) {
      const prev = window.NetworkLayer[ev];
      window.NetworkLayer[ev] = (msg) => { window.__testEvents.push({ ev, msg }); if (prev) prev(msg); };
    }
  });

  await pageA.evaluate(() => window.NetworkLayer.connect('ws://localhost:8081'));
  await pageA.waitForTimeout(400);
  await pageA.evaluate(() => window.NetworkLayer.createRoom('PlayerA', '1v1'));
  await pageA.waitForTimeout(500);
  const roomInfo = await pageA.evaluate(() => window.__testEvents.find(e => e.ev === 'onRoomCreated')?.msg);
  console.log('Room created:', JSON.stringify(roomInfo));
  const roomCode = roomInfo.roomCode;

  // --- B joins ---
  await pageB.evaluate(() => window.NetworkLayer.connect('ws://localhost:8081'));
  await pageB.waitForTimeout(400);
  await pageB.evaluate((code) => window.NetworkLayer.joinRoom(code, 'PlayerB'), roomCode);
  await pageB.waitForTimeout(500);
  const joinInfo = await pageB.evaluate(() => window.__testEvents.find(e => e.ev === 'onRoomJoined')?.msg);
  console.log('Join result:', JSON.stringify(joinInfo));

  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);

  // --- Both select mobiles ---
  await pageA.evaluate(() => window.NetworkLayer.selectMobile('bastion'));
  await pageB.evaluate(() => window.NetworkLayer.selectMobile('driller'));
  await pageA.waitForTimeout(400);
  await pageB.waitForTimeout(400);

  // --- A starts match ---
  await pageA.evaluate(() => window.NetworkLayer.startMatch());
  await pageA.waitForTimeout(600);
  await pageB.waitForTimeout(600);
  const matchStartedA = await pageA.evaluate(() => window.__testEvents.find(e => e.ev === 'onMatchStarted')?.msg);
  console.log('Match started (A view):', JSON.stringify(matchStartedA));

  const stateA1 = await pageA.evaluate(() => ({ players: window.ORBOUND_DEBUG.state.players.map(p=>({id:p.id,hp:p.hp})), active: window.ORBOUND_DEBUG.state.activePlayerId, phase: window.ORBOUND_DEBUG.state.phase }));
  const stateB1 = await pageB.evaluate(() => ({ players: window.ORBOUND_DEBUG.state.players.map(p=>({id:p.id,hp:p.hp})), active: window.ORBOUND_DEBUG.state.activePlayerId, phase: window.ORBOUND_DEBUG.state.phase }));
  console.log('State A after match_started:', JSON.stringify(stateA1));
  console.log('State B after match_started:', JSON.stringify(stateB1));
  const initialStatesMatch = JSON.stringify(stateA1.players) === JSON.stringify(stateB1.players);
  console.log('CHECK: initial player states identical across clients:', initialStatesMatch);

  await pageA.screenshot({ path: '/tmp/track_d_shots/independent_A_lobby.png' });
  await pageB.screenshot({ path: '/tmp/track_d_shots/independent_B_lobby.png' });

  // --- Who is active? Fire from whichever client is actually active ---
  const activeId = stateA1.active;
  const shooterPage = activeId === stateA1.players[0].id ? pageA : pageB;
  const shooterLabel = shooterPage === pageA ? 'A' : 'B';
  const targetIdx = activeId === stateA1.players[0].id ? 1 : 0;
  console.log('Active player is', activeId, '-> shooter is client', shooterLabel);

  // Compute an aimed shot toward the actual opponent using real physics constants
  const shotPlan = await shooterPage.evaluate((targetIdx) => {
    const C = window.ORBOUND_CORE;
    const s = window.ORBOUND_DEBUG.state;
    const shooter = s.players.find(p => p.id === s.activePlayerId);
    const target = s.players[targetIdx];
    const windForce = (s.wind / C.WIND_MAX) * 0.045;
    let bestAngle = 45, bestDist = 99999;
    for (let angle = 10; angle <= 85; angle += 1) {
      const rad = angle * Math.PI/180;
      const speed = 11 + 4;
      let x = shooter.x, y = shooter.y - 16, vx = Math.cos(rad)*(shooter.facing===1?speed:-speed)*(shooter.facing===1?1:-1), vy = -Math.sin(rad)*speed;
      // use shooter.facing to determine direction properly
      vx = Math.cos(rad) * speed * (shooter.facing || 1);
      for (let i=0;i<900;i++) {
        vy += C.GRAVITY; vx += windForce; x += vx; y += vy;
        const d = Math.hypot(x-target.x, y-(target.y-16));
        if (d < bestDist) { bestDist = d; bestAngle = angle; }
        if (x < -50 || x > C.CANVAS_W+50) break;
        if (y > s.terrain.heightAt(x)) break;
      }
    }
    return { bestAngle, bestDist, shooterFacing: shooter.facing };
  }, targetIdx);
  console.log('Computed shot plan:', JSON.stringify(shotPlan));

  const beforeHpA = await pageA.evaluate(() => window.ORBOUND_DEBUG.state.players.map(p=>p.hp));
  const beforeHpB = await pageB.evaluate(() => window.ORBOUND_DEBUG.state.players.map(p=>p.hp));
  console.log('HP before shot - A view:', beforeHpA, 'B view:', beforeHpB);

  // --- B attempts to fire OUT OF TURN first (edge case) ---
  const outOfTurnPage = shooterLabel === 'A' ? pageB : pageA;
  const outOfTurnLabel = shooterLabel === 'A' ? 'B' : 'A';
  await outOfTurnPage.evaluate(() => { window.__testEvents = window.__testEvents.filter(e => e.ev !== 'onShotRejected'); });
  await outOfTurnPage.evaluate(() => window.NetworkLayer.fireShot(30, 50, 's1'));
  await outOfTurnPage.waitForTimeout(1000);
  const rejection = await outOfTurnPage.evaluate(() => window.__testEvents.find(e => e.ev === 'onShotRejected')?.msg || { none: true });
  console.log(`Out-of-turn fire attempt by client ${outOfTurnLabel}:`, JSON.stringify(rejection));

  // --- Real shot from the actually-active client ---
  await shooterPage.evaluate((angle) => {
    const s = window.ORBOUND_DEBUG.state;
    const shooter = s.players.find(p => p.id === s.activePlayerId);
    shooter.angle = angle;
    shooter.power = 90;
    window.NetworkLayer.fireShot(angle, 90, 's1');
  }, shotPlan.bestAngle);

  // Wait for physics to resolve on BOTH clients
  await pageA.waitForTimeout(7000);
  await pageB.waitForTimeout(500);

  const afterHpA = await pageA.evaluate(() => window.ORBOUND_DEBUG.state.players.map(p=>({id:p.id,hp:p.hp})));
  const afterHpB = await pageB.evaluate(() => window.ORBOUND_DEBUG.state.players.map(p=>({id:p.id,hp:p.hp})));
  console.log('HP after shot - A view:', JSON.stringify(afterHpA));
  console.log('HP after shot - B view:', JSON.stringify(afterHpB));

  const terrainA = await pageA.evaluate(() => window.ORBOUND_DEBUG.state.terrain.heights.slice(0, 20));
  const terrainB = await pageB.evaluate(() => window.ORBOUND_DEBUG.state.terrain.heights.slice(0, 20));
  const terrainMatches = JSON.stringify(terrainA) === JSON.stringify(terrainB);
  console.log('CHECK: terrain identical across clients after shot:', terrainMatches);

  const hpConverged = JSON.stringify(afterHpA) === JSON.stringify(afterHpB);
  console.log('CHECK: HP states converged across both clients:', hpConverged);
  const someoneDamaged = afterHpA.some((p,i) => p.hp < beforeHpA[i]);
  console.log('CHECK: real damage occurred:', someoneDamaged);

  await pageA.screenshot({ path: '/tmp/track_d_shots/independent_A_after_shot.png' });
  await pageB.screenshot({ path: '/tmp/track_d_shots/independent_B_after_shot.png' });

  console.log('Errors A:', errorsA.length ? errorsA : 'NONE');
  console.log('Errors B:', errorsB.length ? errorsB : 'NONE');

  await browser.close();
})();
