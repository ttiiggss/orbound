// Debug script for wallbounce behavior
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8792/index.html';
const OUT = '/tmp/track_a_shots';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', msg => console.log('PAGE:', msg.text()));
  page.on('pageerror', err => console.error('PAGEERROR:', err.message));

  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 10000 });
    await page.waitForTimeout(500);

    // Start match
    await page.evaluate(() => window.ORBOUND_DEBUG.newMatch());
    await page.waitForTimeout(200);

    // Override p1 to ricochet
    await page.evaluate(() => {
      window.ORBOUND_DEBUG.state.players[0].mobileId = 'ricochet';
      window.ORBOUND_DEBUG.state.players[1].mobileId = 'fortress';
    });

    await page.waitForTimeout(100);

    // Fire ricochet s2 (wallbounce) toward left edge
    console.log('\n=== Firing Ricochet s2 (wallbounce) toward left edge ===');
    await page.evaluate(() => {
      const dbg = window.ORBOUND_DEBUG;
      const p = dbg.state.players[0];
      p.angle = 120; // Toward left
      p.power = 40;  // Moderate power
      p.facing = -1; // Facing left
      console.log(`Firing at angle ${p.angle}°, power ${p.power}, facing ${p.facing}`);
      dbg.fireShot(p, 's2');
    });

    // Watch projectile
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(150);

      const state = await page.evaluate(() => {
        const s = window.ORBOUND_DEBUG.state;
        if (s.projectiles.length === 0) return null;
        const proj = s.projectiles[0];
        return {
          x: Math.round(proj.x),
          y: Math.round(proj.y),
          vx: proj.vx.toFixed(2),
          vy: proj.vy.toFixed(2),
          bounces: proj.bounces,
          maxBounces: proj.maxBounces,
          behavior: proj.weapon.behavior,
          dead: proj.dead,
        };
      });

      if (state) {
        console.log(`Step ${i}: x=${state.x} bounces=${state.bounces}/${state.maxBounces} vx=${state.vx} vy=${state.vy}`);
      } else {
        console.log(`Step ${i}: Projectile resolved (all fired)`);
        break;
      }
    }

    // Take screenshot
    await page.screenshot({ path: path.join(OUT, 'debug_wallbounce_result.png') });

    // Check final state
    const finalState = await page.evaluate(() => {
      const s = window.ORBOUND_DEBUG.state;
      return {
        p2Hp: s.players[1].hp,
        activePlayer: s.activePlayerId,
        log: s.log.slice(0, 3),
      };
    });

    console.log('\nFinal state:', JSON.stringify(finalState, null, 2));

  } catch (err) {
    console.error('ERROR:', err);
  }

  await browser.close();
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
