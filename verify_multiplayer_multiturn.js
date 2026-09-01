const { chromium } = require('playwright-core');
const EXE = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

// Multi-turn sync test: fires several real alternating shots across a full
// exchange (not just one), checking convergence after EVERY shot, to catch
// any drift that might accumulate turn-over-turn rather than showing up on
// shot #1 alone.
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
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

  await pageA.evaluate(() => window.NetworkLayer.connect('ws://localhost:8081'));
  await pageA.waitForTimeout(300);
  const room = await pageA.evaluate(() => new Promise(r => {
    const prev = window.NetworkLayer.onRoomCreated;
    window.NetworkLayer.onRoomCreated = (m) => { r(m); if (prev) prev(m); };
    window.NetworkLayer.createRoom('PlayerA', '1v1');
  }));
  await pageB.evaluate(() => window.NetworkLayer.connect('ws://localhost:8081'));
  await pageB.waitForTimeout(300);
  await pageB.evaluate((c) => window.NetworkLayer.joinRoom(c, 'PlayerB'), room.roomCode);
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);
  await pageA.evaluate(() => window.NetworkLayer.selectMobile('bastion'));
  await pageB.evaluate(() => window.NetworkLayer.selectMobile('driller'));
  await pageA.waitForTimeout(300);
  await pageB.waitForTimeout(300);
  await pageA.evaluate(() => window.NetworkLayer.startMatch());
  await pageA.waitForTimeout(600);
  await pageB.waitForTimeout(600);

  let allConverged = true;
  for (let turn = 1; turn <= 8; turn++) {
    const activeId = await pageA.evaluate(() => window.ORBOUND_DEBUG.state.activePlayerId);
    const phase = await pageA.evaluate(() => window.ORBOUND_DEBUG.state.phase);
    if (phase === 'gameover') { console.log(`Turn ${turn}: game already over, stopping`); break; }
    const shooterPage = activeId === 't0p0' ? pageA : pageB;
    const shooterLabel = activeId === 't0p0' ? 'A' : 'B';
    const targetIdx = activeId === 't0p0' ? 1 : 0;

    const shotPlan = await shooterPage.evaluate((targetIdx) => {
      const C = window.ORBOUND_CORE;
      const s = window.ORBOUND_DEBUG.state;
      const shooter = s.players.find(p => p.id === s.activePlayerId);
      const target = s.players[targetIdx];
      const windForce = (s.wind / C.WIND_MAX) * 0.045;
      const FIRE_POWER = 95; // must match the power actually used in fireShot() below
      let bestAngle = 45, bestDist = 99999;
      for (let angle = 10; angle <= 85; angle += 1) {
        const rad = angle * Math.PI / 180;
        const speed = (FIRE_POWER / 100) * 11 + 4;
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
      return { bestAngle, bestDist };
    }, targetIdx);

    await shooterPage.evaluate((angle) => {
      const s = window.ORBOUND_DEBUG.state;
      const shooter = s.players.find(p => p.id === s.activePlayerId);
      shooter.angle = angle; shooter.power = 95;
      window.NetworkLayer.fireShot(angle, 95, 's1', s.wind);
    }, shotPlan.bestAngle);

    await pageA.waitForTimeout(7000);
    await pageB.waitForTimeout(500);

    const hpA = await pageA.evaluate(() => window.ORBOUND_DEBUG.state.players.map(p => ({ id: p.id, hp: p.hp, alive: p.alive })));
    const hpB = await pageB.evaluate(() => window.ORBOUND_DEBUG.state.players.map(p => ({ id: p.id, hp: p.hp, alive: p.alive })));
    const converged = JSON.stringify(hpA) === JSON.stringify(hpB);
    if (!converged) allConverged = false;

    // Byte-for-byte terrain heightmap comparison (not just "visually close")
    const terrainA = await pageA.evaluate(() => Array.from(window.ORBOUND_DEBUG.state.terrain.heights));
    const terrainB = await pageB.evaluate(() => Array.from(window.ORBOUND_DEBUG.state.terrain.heights));
    const terrainMatch = terrainA.length === terrainB.length && terrainA.every((v, i) => Math.abs(v - terrainB[i]) < 0.001);
    if (!terrainMatch) allConverged = false;

    console.log(`Turn ${turn} (shooter ${shooterLabel}, target dist ${shotPlan.bestDist.toFixed(1)}): A=${JSON.stringify(hpA)} B=${JSON.stringify(hpB)} CONVERGED=${converged} TERRAIN_MATCH=${terrainMatch}`);
  }

  console.log('\nALL TURNS CONVERGED:', allConverged);
  console.log('Errors A:', errorsA.length ? errorsA : 'NONE');
  console.log('Errors B:', errorsB.length ? errorsB : 'NONE');
  await pageA.screenshot({ path: '/tmp/track_d_shots/multiturn_final_A.png' });
  await pageB.screenshot({ path: '/tmp/track_d_shots/multiturn_final_B.png' });
  await browser.close();
})();
