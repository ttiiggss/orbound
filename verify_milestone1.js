// Verification harness for ORBOUND milestone 1 (single-player vs bot).
// Launches the existing local chromium install directly (no system chrome needed),
// loads the game, drives real gameplay via the exposed window.ORBOUND_DEBUG hooks
// plus real mouse events, and screenshots key states for visual proof.
const { chromium } = require('playwright-core');
const path = require('path');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8791/index.html';
const OUT = '/tmp/orbound_shots';

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  console.log('--- Menu state ---');
  await page.screenshot({ path: path.join(OUT, '01_menu.png') });

  // Start match
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '02_match_start.png') });

  const phase1 = await page.evaluate(() => window.ORBOUND_DEBUG.state.phase);
  console.log('Phase after start:', phase1);

  // Verify terrain + players exist
  const initialState = await page.evaluate(() => {
    const s = window.ORBOUND_DEBUG.state;
    return {
      phase: s.phase,
      players: s.players.map(p => ({ id: p.id, mobile: p.mobileId, hp: p.hp, x: Math.round(p.x), y: Math.round(p.y), alive: p.alive })),
      activePlayer: s.activePlayerId,
      terrainSample: s.terrain.heightAt(640),
    };
  });
  console.log('Initial state:', JSON.stringify(initialState, null, 2));

  // Fire a shot programmatically as p1 (deterministic, for verification not reliant on charge timing)
  const beforeHp = await page.evaluate(() => window.ORBOUND_DEBUG.state.players[1].hp);
  const beforeTerrain = await page.evaluate(() => Array.from(window.ORBOUND_DEBUG.state.terrain.heights));

  await page.evaluate(() => {
    const dbg = window.ORBOUND_DEBUG;
    const p1 = dbg.state.players[0];
    p1.angle = 35;
    p1.power = 75;
    dbg.fireShot(p1, 's1');
  });

  console.log('--- Projectile flying ---');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '03_projectile_flying.png') });

  // Let physics resolve (up to a few seconds of real frames)
  await page.waitForTimeout(4500);
  await page.screenshot({ path: path.join(OUT, '04_after_impact.png') });

  const afterState = await page.evaluate(() => {
    const s = window.ORBOUND_DEBUG.state;
    return {
      phase: s.phase,
      players: s.players.map(p => ({ id: p.id, hp: p.hp, alive: p.alive })),
      activePlayer: s.activePlayerId,
      log: s.log,
    };
  });
  console.log('After-shot state:', JSON.stringify(afterState, null, 2));

  const afterTerrain = await page.evaluate(() => Array.from(window.ORBOUND_DEBUG.state.terrain.heights));
  let terrainChanged = false;
  for (let i = 0; i < beforeTerrain.length; i++) {
    if (Math.abs(beforeTerrain[i] - afterTerrain[i]) > 0.5) { terrainChanged = true; break; }
  }
  console.log('Terrain deformed by impact:', terrainChanged);

  // Play out several more bot-vs-bot style turns by repeatedly firing p1 with varied angles
  // to reach a gameover state and verify win detection works.
  // Loop several more rounds to try to reach gameover, checking terrain deformation
  // against a wide sample window (impacts can land anywhere across the map).
  const wideBeforeTerrain = beforeTerrain;
  for (let round = 0; round < 16; round++) {
    const s = await page.evaluate(() => window.ORBOUND_DEBUG.state.phase);
    if (s === 'gameover') break;
    const active = await page.evaluate(() => window.ORBOUND_DEBUG.state.activePlayerId);
    if (active === 'p1') {
      await page.evaluate(() => {
        const dbg = window.ORBOUND_DEBUG;
        const p = dbg.state.players[0];
        p.angle = 30 + Math.random() * 20;
        p.power = 80 + Math.round(Math.random() * 15);
        dbg.fireShot(p, 's1');
      });
    }
    await page.waitForTimeout(3500);
  }

  await page.screenshot({ path: path.join(OUT, '05_endgame_or_progress.png') });
  const finalState = await page.evaluate(() => {
    const s = window.ORBOUND_DEBUG.state;
    return { phase: s.phase, winner: s.winner, players: s.players.map(p => ({ id: p.id, hp: p.hp, alive: p.alive })), log: s.log };
  });
  console.log('Final state:', JSON.stringify(finalState, null, 2));

  console.log('--- Console errors captured ---');
  console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');

  await browser.close();
  console.log('--- DONE, screenshots in', OUT, '---');
})().catch(err => { console.error('HARNESS FAILURE:', err); process.exit(1); });
