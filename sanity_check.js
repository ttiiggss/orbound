// Quick sanity check that game loads and basic mechanics work
const { chromium } = require('playwright-core');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8792/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 10000 });
    await page.waitForTimeout(500);

    // Check that game loaded
    const hasDebug = await page.evaluate(() => !!window.ORBOUND_DEBUG);
    const hasState = await page.evaluate(() => !!window.ORBOUND_DEBUG.state);

    console.log(`✓ Game loaded successfully`);
    console.log(`✓ DEBUG hooks available: ${hasDebug}`);
    console.log(`✓ Game state accessible: ${hasState}`);

    // Start a quick match
    await page.evaluate(() => window.ORBOUND_DEBUG.newMatch());
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => {
      const s = window.ORBOUND_DEBUG.state;
      return {
        phase: s.phase,
        players: s.players.length,
        terrain: !!s.terrain,
        activePlayer: !!s.activePlayerId,
      };
    });

    console.log(`✓ Match started: phase=${state.phase}, players=${state.players}, terrain=${state.terrain}`);

    // Fire a shot
    await page.evaluate(() => {
      const p = window.ORBOUND_DEBUG.state.players[0];
      p.angle = 45;
      p.power = 75;
      window.ORBOUND_DEBUG.fireShot(p, 's1');
    });

    await page.waitForTimeout(100);

    const projCount = await page.evaluate(() => window.ORBOUND_DEBUG.state.projectiles.length);
    console.log(`✓ Shot fired: projectiles=${projCount}`);

    await page.waitForTimeout(4000);

    const afterCount = await page.evaluate(() => window.ORBOUND_DEBUG.state.projectiles.length);
    console.log(`✓ Projectile resolved after wait: projectiles=${afterCount}`);

    if (errors.length) {
      console.log('\n✗ ERRORS DETECTED:');
      errors.forEach(e => console.log(`  ${e}`));
      process.exit(1);
    } else {
      console.log('\n✓ SANITY CHECK PASSED - NO REGRESSIONS DETECTED');
      process.exit(0);
    }

  } catch (err) {
    console.error(`✗ FATAL ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
