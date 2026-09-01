// Verify sprite integration: sprites load, render correctly in-match, and the
// game still functions (fire a shot, confirm hit detection still works with
// the new sprite-based rendering).
const { chromium } = require('playwright-core');
const path = require('path');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8791/index.html';
const OUT = '/tmp/orbound_sprite_shots';

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'load' });

  // Wait for sprite loader to finish
  await page.waitForFunction(() => window.SpriteLoader && window.SpriteLoader.ready, { timeout: 10000 });
  const loadStatus = await page.evaluate(() => {
    const sl = window.SpriteLoader;
    return {
      ready: sl.ready,
      loadedIds: Object.keys(sl.images),
      manifestIds: Object.keys(sl.manifest),
    };
  });
  console.log('Sprite load status:', JSON.stringify(loadStatus, null, 2));

  await page.evaluate(() => window.ORBOUND_DEBUG.newMatch(777));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '01_match_with_sprites.png') });

  // Try each mobile as p1 to verify all 8 sprites render without crashing
  const { MOBILES } = await page.evaluate(() => ({ MOBILES: Object.keys(window.ORBOUND_DEBUG.MOBILES) }));
  console.log('Testing all mobiles:', MOBILES);

  for (const mobileId of MOBILES) {
    await page.evaluate((id) => {
      const dbg = window.ORBOUND_DEBUG;
      dbg.state.players[0].mobileId = id;
    }, mobileId);
    await page.waitForTimeout(150);
  }
  // Final screenshot cycling through last mobile
  await page.screenshot({ path: path.join(OUT, '02_after_mobile_cycle.png') });

  // Verify gameplay still works: fire an aimed shot using the sweep technique
  const best = await page.evaluate(() => {
    const C = window.ORBOUND_CORE;
    const s = window.ORBOUND_DEBUG.state;
    const p1 = s.players[0], p2 = s.players[1];
    const windForce = (s.wind / C.WIND_MAX) * 0.045;
    let bestAngle = null, bestDist = 9999;
    for (let angle = 20; angle <= 80; angle += 0.5) {
      const rad = angle * Math.PI / 180;
      const speed = 11 + 4;
      let x = p1.x, y = p1.y - 16;
      let vx = Math.cos(rad) * speed;
      let vy = -Math.sin(rad) * speed;
      for (let i = 0; i < 800; i++) {
        vy += C.GRAVITY;
        vx += windForce;
        x += vx; y += vy;
        const d = Math.hypot(x - p2.x, y - (p2.y - 16));
        if (d < bestDist) { bestDist = d; bestAngle = angle; }
        if (x < -50 || x > C.CANVAS_W + 50) break;
        if (y > s.terrain.heightAt(x)) break;
      }
    }
    return { bestAngle, bestDist };
  });
  console.log('Best shot found:', JSON.stringify(best));

  const beforeHp = await page.evaluate(() => window.ORBOUND_DEBUG.state.players[1].hp);
  await page.evaluate((angle) => {
    const dbg = window.ORBOUND_DEBUG;
    const p = dbg.state.players[0];
    p.angle = angle; p.power = 100;
    dbg.fireShot(p, 's1');
  }, best.bestAngle);

  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '03_projectile_with_sprites.png') });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, '04_after_impact_sprites.png') });

  const afterState = await page.evaluate(() => {
    const s = window.ORBOUND_DEBUG.state;
    return { hp2: s.players[1].hp, log: s.log };
  });
  console.log('before hp2:', beforeHp, 'after:', JSON.stringify(afterState));

  console.log('--- Errors captured ---');
  console.log(errors.length ? errors.join('\n') : '(none)');

  await browser.close();
  console.log('DONE, screenshots in', OUT);
})().catch(err => { console.error('HARNESS FAILURE:', err); process.exit(1); });
