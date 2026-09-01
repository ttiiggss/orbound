// Debug script to understand bounce behavior
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

    // Override p1 to bouncer
    await page.evaluate(() => {
      window.ORBOUND_DEBUG.state.players[0].mobileId = 'bouncer';
      window.ORBOUND_DEBUG.state.players[1].mobileId = 'fortress';
    });

    await page.waitForTimeout(100);

    // Fire bouncer s1 into the ground (high angle, low power to hit terrain quickly)
    console.log('\n=== Firing Bouncer s1 at ground ===');
    await page.evaluate(() => {
      const dbg = window.ORBOUND_DEBUG;
      const p = dbg.state.players[0];
      p.angle = 85; // Very high angle to hit nearby ground
      p.power = 30; // Low power
      console.log(`Firing at angle ${p.angle}°, power ${p.power}`);
      dbg.fireShot(p, 's1');
    });

    // Wait for projectile to land
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200);

      const state = await page.evaluate(() => {
        const s = window.ORBOUND_DEBUG.state;
        if (s.projectiles.length === 0) return null;
        const proj = s.projectiles[0];
        return {
          count: s.projectiles.length,
          x: Math.round(proj.x),
          y: Math.round(proj.y),
          vx: proj.vx.toFixed(2),
          vy: proj.vy.toFixed(2),
          bounces: proj.bounces,
          maxBounces: proj.maxBounces,
          burrowed: proj.burrowed,
          behavior: proj.weapon.behavior,
        };
      });

      if (state) {
        console.log(`Step ${i}: proj=${state.x},${state.y} v=${state.vx},${state.vy} bounces=${state.bounces}/${state.maxBounces}`);
      } else {
        console.log(`Step ${i}: Projectile resolved`);
        break;
      }
    }

    // Take screenshot
    await page.screenshot({ path: path.join(OUT, 'debug_bounce_result.png') });

    // Check final damage and logs
    const finalState = await page.evaluate(() => {
      const s = window.ORBOUND_DEBUG.state;
      return {
        p1Hp: s.players[0].hp,
        p2Hp: s.players[1].hp,
        terrainChanged: true,
        log: s.log.slice(0, 5),
      };
    });

    console.log('\nFinal state:', JSON.stringify(finalState, null, 2));

  } catch (err) {
    console.error('ERROR:', err);
  }

  await browser.close();
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
