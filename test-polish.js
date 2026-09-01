// Test script for title screen, HUD, and audio polish
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8796/index.html';
const OUT = '/tmp/polish_verification';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleErrors = [];
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    if (msg.type() === 'log') consoleLogs.push(text);
  });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  console.log('Loading game at ' + URL + '...');
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // ===== Title Screen Test =====
  console.log('\n=== TITLE SCREEN TEST ===');
  await page.screenshot({ path: path.join(OUT, '01-title-screen.png') });
  console.log('✓ Title screen screenshot taken');

  // Check if AudioFX is available
  const audioAvailable = await page.evaluate(() => typeof window.AudioFX !== 'undefined');
  console.log('✓ AudioFX available:', audioAvailable);

  // ===== Start Practice Game =====
  console.log('\n=== PRACTICE GAME TEST ===');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  const gameState1 = await page.evaluate(() => ({
    phase: window.ORBOUND_DEBUG.state.phase,
    players: window.ORBOUND_DEBUG.state.players.length,
    terrain: window.ORBOUND_DEBUG.state.terrain ? 'loaded' : 'missing',
  }));
  console.log('Game state after ENTER:', gameState1);

  await page.screenshot({ path: path.join(OUT, '02-gameplay-initial.png') });
  console.log('✓ Initial gameplay screenshot taken');

  // ===== Audio Test =====
  console.log('\n=== AUDIO TEST ===');

  // Initialize audio context by simulating user interaction
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);

  // Test each audio function
  const audioFunctions = ['playFireShot', 'playImpact', 'playDamage', 'playVictory', 'playUIClick'];
  const audioResults = {};

  for (const fn of audioFunctions) {
    try {
      const called = await page.evaluate((fnName) => {
        try {
          if (typeof window.AudioFX[fnName] === 'function') {
            window.AudioFX[fnName]();
            return true;
          }
          return false;
        } catch (e) {
          console.error('Audio error in ' + fnName + ':', e.message);
          return false;
        }
      }, fn);
      audioResults[fn] = called ? '✓ OK' : '✗ MISSING';
    } catch (e) {
      audioResults[fn] = '✗ ERROR: ' + e.message;
    }
  }
  console.log('Audio function tests:', audioResults);

  // ===== Fire Shot Test =====
  console.log('\n=== FIRE SHOT TEST ===');

  const beforeFire = await page.evaluate(() => ({
    phase: window.ORBOUND_DEBUG.state.phase,
    projCount: window.ORBOUND_DEBUG.state.projectiles.length,
    activePlayer: window.ORBOUND_DEBUG.state.activePlayerId,
  }));
  console.log('Before fire:', beforeFire);

  // Set up deterministic shot
  await page.evaluate(() => {
    const dbg = window.ORBOUND_DEBUG;
    const p = dbg.state.players[0];
    p.angle = 35;
    p.power = 75;
    dbg.fireShot(p, 's1');
  });

  await page.screenshot({ path: path.join(OUT, '03-shot-fired.png') });

  // Let physics run
  await page.waitForTimeout(3000);

  const afterFire = await page.evaluate(() => ({
    phase: window.ORBOUND_DEBUG.state.phase,
    players: window.ORBOUND_DEBUG.state.players.map(p => ({ id: p.id, hp: p.hp, alive: p.alive })),
    log: window.ORBOUND_DEBUG.state.log.slice(0, 3),
  }));
  console.log('After fire:', JSON.stringify(afterFire, null, 2));

  await page.screenshot({ path: path.join(OUT, '04-after-impact.png') });
  console.log('✓ Post-impact screenshot taken');

  // ===== Test Menu Options =====
  console.log('\n=== TESTING MENU NAVIGATION ===');

  // Play until gameover or several rounds
  let roundCount = 0;
  while (roundCount < 15) {
    const phase = await page.evaluate(() => window.ORBOUND_DEBUG.state.phase);
    if (phase === 'gameover') {
      console.log('Game over reached!');
      break;
    }
    if (phase !== 'aiming') {
      await page.waitForTimeout(500);
      roundCount++;
      continue;
    }

    const active = await page.evaluate(() => window.ORBOUND_DEBUG.state.activePlayerId);
    if (active === 'p0') {
      await page.evaluate(() => {
        const dbg = window.ORBOUND_DEBUG;
        const p = dbg.state.players[0];
        p.angle = 25 + Math.random() * 30;
        p.power = 60 + Math.random() * 30;
        dbg.fireShot(p, 's1');
      });
      await page.waitForTimeout(3500);
    } else {
      await page.waitForTimeout(500);
    }
    roundCount++;
  }

  // Take final gameover screenshot if reached
  const finalPhase = await page.evaluate(() => window.ORBOUND_DEBUG.state.phase);
  if (finalPhase === 'gameover') {
    console.log('✓ Gameover screen reached');
    await page.screenshot({ path: path.join(OUT, '05-gameover.png') });
  }

  // ===== HUD Cleanup Verification =====
  console.log('\n=== HUD VISUAL CHECK ===');
  console.log('(Note: Visual quality checked via screenshots)');
  console.log('Screenshots saved to: ' + OUT);

  // Check for console errors
  console.log('\n=== CONSOLE ERRORS ===');
  if (consoleErrors.length === 0) {
    console.log('✓ No console errors detected');
  } else {
    console.log('✗ Console errors found:');
    consoleErrors.forEach(err => console.log('  - ' + err));
  }

  console.log('\n=== TEST COMPLETE ===');
  console.log('All screenshots and verification data saved.');

  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
