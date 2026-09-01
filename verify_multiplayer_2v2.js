const { chromium } = require('playwright-core');
const EXE = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

// Real 2v2 multiplayer test: FOUR genuinely independent browser contexts
// (four separate "players"), one real room, real turn rotation across 4
// players, real HP/terrain convergence checked across ALL FOUR clients
// after every shot (not just 2, unlike the 1v1 tests). This mode's server
// code path (turn queue with >2 entries, team-based win condition) has
// never been exercised by a real multi-client test before this - it looked
// correct on paper the same way 1v1 did before real testing found 4 bugs.
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctxs = [await browser.newContext(), await browser.newContext(), await browser.newContext(), await browser.newContext()];
  const pages = [];
  for (const ctx of ctxs) pages.push(await ctx.newPage());
  const [pA, pB, pC, pD] = pages; // A,C = team0 (t0p0,t0p1); B,D = team1 (t1p0,t1p1)
  const labels = ['A', 'B', 'C', 'D'];
  const errors = {};
  pages.forEach((p, i) => {
    errors[labels[i]] = [];
    p.on('pageerror', e => errors[labels[i]].push(e.message));
  });

  for (const p of pages) {
    await p.goto('http://localhost:8791/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(300);
  }

  // A creates a 2v2 room
  await pA.evaluate(() => window.NetworkLayer.connect('ws://localhost:8081'));
  await pA.waitForTimeout(300);
  const room = await pA.evaluate(() => new Promise(r => {
    const prev = window.NetworkLayer.onRoomCreated;
    window.NetworkLayer.onRoomCreated = (m) => { r(m); if (prev) prev(m); };
    window.NetworkLayer.createRoom('PlayerA', '2v2');
  }));
  console.log('Room created:', JSON.stringify(room));
  const roomCode = room.roomCode;

  // B, C, D join in order - server should assign t1p0, t0p1, t1p1 per its
  // round-robin slot-fill logic (findNextPlayerSlot)
  const joinResults = {};
  for (const [label, page] of [['B', pB], ['C', pC], ['D', pD]]) {
    await page.evaluate(() => window.NetworkLayer.connect('ws://localhost:8081'));
    await page.waitForTimeout(300);
    const res = await page.evaluate((code, name) => window.NetworkLayer.joinRoom(code, name), roomCode, `Player${label}`);
    joinResults[label] = res;
    await page.waitForTimeout(200);
  }
  console.log('Join results:', JSON.stringify(joinResults, null, 2));

  // All 4 select mobiles
  const mobiles = { pA: 'bastion', pB: 'driller', pC: 'twinsplit', pD: 'fortress' };
  await pA.evaluate((m) => window.NetworkLayer.selectMobile(m), mobiles.pA);
  await pB.evaluate((m) => window.NetworkLayer.selectMobile(m), mobiles.pB);
  await pC.evaluate((m) => window.NetworkLayer.selectMobile(m), mobiles.pC);
  await pD.evaluate((m) => window.NetworkLayer.selectMobile(m), mobiles.pD);
  for (const p of pages) await p.waitForTimeout(300);

  // A (creator) starts the match
  await pA.evaluate(() => window.NetworkLayer.startMatch());
  for (const p of pages) await p.waitForTimeout(700);

  // Confirm all 4 clients see the SAME initial roster/state
  const states = {};
  for (let i = 0; i < 4; i++) {
    states[labels[i]] = await pages[i].evaluate(() => ({
      players: window.ORBOUND_DEBUG.state.players.map(p => ({ id: p.id, mobile: p.mobileId, hp: p.hp, team: p.teamIdx })),
      active: window.ORBOUND_DEBUG.state.activePlayerId,
      phase: window.ORBOUND_DEBUG.state.phase,
    }));
  }
  console.log('\nInitial states across all 4 clients:');
  for (const l of labels) console.log(` ${l}:`, JSON.stringify(states[l]));
  const allInitialMatch = labels.every(l => JSON.stringify(states[l].players) === JSON.stringify(states['A'].players));
  console.log('CHECK: all 4 clients agree on initial roster:', allInitialMatch);

  // Real turn cycle: fire from whichever client is actually active, repeat
  // for 6 turns, checking full 4-way HP+terrain convergence after each.
  const pageByPlayerId = { }; // filled in below once we know slot assignment
  let allConverged = true;
  for (let turn = 1; turn <= 6; turn++) {
    const activeId = await pA.evaluate(() => window.ORBOUND_DEBUG.state.activePlayerId);
    const phase = await pA.evaluate(() => window.ORBOUND_DEBUG.state.phase);
    if (phase === 'gameover') { console.log(`Turn ${turn}: game already over`); break; }

    // Figure out which page controls activeId by checking each page's own yourPlayerId
    let shooterPage = null, shooterLabel = null;
    for (let i = 0; i < 4; i++) {
      const yourId = await pages[i].evaluate(() => window.NetworkLayer.playerId);
      if (yourId === activeId) { shooterPage = pages[i]; shooterLabel = labels[i]; break; }
    }
    if (!shooterPage) { console.log(`Turn ${turn}: could not find shooter for ${activeId}, aborting`); break; }

    // Pick a living enemy target for a rough aimed shot
    const shotPlan = await shooterPage.evaluate((activeId) => {
      const C = window.ORBOUND_CORE;
      const s = window.ORBOUND_DEBUG.state;
      const shooter = s.players.find(p => p.id === activeId);
      const target = s.players.find(p => p.alive && p.teamIdx !== shooter.teamIdx);
      if (!target) return null;
      const windForce = (s.wind / C.WIND_MAX) * 0.045;
      let bestAngle = 45, bestDist = 99999;
      for (let angle = 10; angle <= 85; angle += 1) {
        const rad = angle * Math.PI / 180;
        const speed = (95 / 100) * 11 + 4;
        let x = shooter.x, y = shooter.y - 16;
        let vx = Math.cos(rad) * speed * (shooter.facing || 1);
        let vy = -Math.sin(rad) * speed;
        for (let i = 0; i < 900; i++) {
          vy += C.GRAVITY; vx += windForce; x += vx; y += vy;
          const d = Math.hypot(x - target.x, y - (target.y - 16));
          if (d < bestDist) { bestDist = d; bestAngle = angle; }
          if (x < -50 || x > C.CANVAS_W + 50) break;
          if (y > s.terrain.heightAt(x)) break;
        }
      }
      return { bestAngle, bestDist, targetId: target.id };
    }, activeId);

    if (!shotPlan) { console.log(`Turn ${turn}: no living enemy target found, stopping`); break; }

    await shooterPage.evaluate((angle) => {
      const s = window.ORBOUND_DEBUG.state;
      const shooter = s.players.find(p => p.id === s.activePlayerId);
      shooter.angle = angle; shooter.power = 95;
      window.NetworkLayer.fireShot(angle, 95, 's1', s.wind);
    }, shotPlan.bestAngle);

    await pA.waitForTimeout(7500);
    for (const p of pages) await p.waitForTimeout(300);

    const snap = {};
    for (let i = 0; i < 4; i++) {
      snap[labels[i]] = await pages[i].evaluate(() => window.ORBOUND_DEBUG.state.players.map(p => ({ id: p.id, hp: p.hp, alive: p.alive })));
    }
    const hpConverged = labels.every(l => JSON.stringify(snap[l]) === JSON.stringify(snap['A']));

    const terrainSnap = {};
    for (let i = 0; i < 4; i++) {
      terrainSnap[labels[i]] = await pages[i].evaluate(() => Array.from(window.ORBOUND_DEBUG.state.terrain.heights));
    }
    const terrainConverged = labels.every(l =>
      terrainSnap[l].length === terrainSnap['A'].length &&
      terrainSnap[l].every((v, idx) => Math.abs(v - terrainSnap['A'][idx]) < 0.001)
    );

    if (!hpConverged || !terrainConverged) allConverged = false;
    console.log(`Turn ${turn} (shooter ${shooterLabel} -> ${activeId}, target ${shotPlan.targetId}, dist ${shotPlan.bestDist.toFixed(1)}): HP_CONVERGED=${hpConverged} TERRAIN_CONVERGED=${terrainConverged}`);
    console.log('   A HP snapshot:', JSON.stringify(snap['A']));
  }

  console.log('\nALL 4-CLIENT TURNS FULLY CONVERGED (HP + terrain):', allConverged);
  for (const l of labels) console.log(`Errors ${l}:`, errors[l].length ? errors[l] : 'NONE');

  await pA.screenshot({ path: '/tmp/orbound_2v2_A.png' });
  await pB.screenshot({ path: '/tmp/orbound_2v2_B.png' });
  await browser.close();
})();
