// Debug skystrike behavior
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

    // Override to skyfin
    await page.evaluate(() => {
      window.ORBOUND_DEBUG.state.players[0].mobileId = 'skyfin';
      window.ORBOUND_DEBUG.state.players[1].mobileId = 'fortress';
      window.ORBOUND_DEBUG.state.charges[window.ORBOUND_DEBUG.state.players[0].id] = 100;
    });

    await page.waitForTimeout(100);

    // Fire skystrike SS
    console.log('\n=== Firing Skyfin ss (skystrike) ===');
    await page.evaluate(() => {
      const p = window.ORBOUND_DEBUG.state.players[0];
      console.log(`P1 position: x=${p.x}, y=${p.y}`);
      p.angle = 45;
      p.power = 70;
      window.ORBOUND_DEBUG.fireShot(p, 'ss');
    });

    // Track projectile
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(100);

      const state = await page.evaluate(() => {
        const s = window.ORBOUND_DEBUG.state;
        if (s.projectiles.length === 0) return null;
        const proj = s.projectiles[0];
        return {
          x: Math.round(proj.x),
          y: Math.round(proj.y),
          vx: proj.vx.toFixed(2),
          vy: proj.vy.toFixed(2),
          behavior: proj.weapon.behavior,
          p2Hp: s.players[1].hp,
        };
      });

      if (state) {
        console.log(`Step ${i}: x=${state.x}, y=${state.y}, vx=${state.vx}, vy=${state.vy}`);
      } else {
        console.log(`Step ${i}: Projectile resolved`);
        const final = await page.evaluate(() => {
          const s = window.ORBOUND_DEBUG.state;
          return { p2Hp: s.players[1].hp, log: s.log.slice(0, 3) };
        });
        console.log('Final state:', JSON.stringify(final, null, 2));
        break;
      }
    }

    await page.screenshot({ path: path.join(OUT, 'debug_skystrike_result.png') });

  } catch (err) {
    console.error('ERROR:', err);
  }

  await browser.close();
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
