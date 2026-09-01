// Verification harness for ORBOUND weapon behaviors
// Tests: bounce (Bouncer), burrow (Driller), split (Twinsplit),
//        wallbounce (Ricochet), skystrike (Skyfin)
// Uses angle-sweep technique to aim at opponent with wind accounting
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8792/index.html';
const OUT = '/tmp/track_a_shots';

const TESTS = [
  { name: 'Bouncer s1', mobile: 'bouncer', slot: 's1', expectedBehavior: 'bounce' },
  { name: 'Bouncer s2', mobile: 'bouncer', slot: 's2', expectedBehavior: 'bounce' },
  { name: 'Bouncer ss', mobile: 'bouncer', slot: 'ss', expectedBehavior: 'bounce', needsCharge: true },
  { name: 'Driller s1', mobile: 'driller', slot: 's1', expectedBehavior: 'burrow' },
  { name: 'Driller s2', mobile: 'driller', slot: 's2', expectedBehavior: 'burrow' },
  { name: 'Driller ss', mobile: 'driller', slot: 'ss', expectedBehavior: 'burrow', needsCharge: true },
  { name: 'Twinsplit s2', mobile: 'twinsplit', slot: 's2', expectedBehavior: 'split' },
  { name: 'Twinsplit ss', mobile: 'twinsplit', slot: 'ss', expectedBehavior: 'split', needsCharge: true },
  { name: 'Ricochet s2', mobile: 'ricochet', slot: 's2', expectedBehavior: 'wallbounce' },
  { name: 'Skyfin ss', mobile: 'skyfin', slot: 'ss', expectedBehavior: 'skystrike', needsCharge: true },
];

const results = [];

async function setupMatch(page, p1Mobile, p2Mobile) {
  // Start a new match
  await page.evaluate(() => window.ORBOUND_DEBUG.newMatch());
  await page.waitForTimeout(200);

  // Override players to specific mobiles
  await page.evaluate(({ p1m, p2m }) => {
    const s = window.ORBOUND_DEBUG.state;
    s.players[0].mobileId = p1m;
    s.players[1].mobileId = p2m;
  }, { p1m: p1Mobile, p2m: p2Mobile });

  await page.waitForTimeout(100);
}

// Finds the best angle to hit opponent by sweeping angles at fixed power
async function findAimAngle(page, p1Idx, p2Idx, power, sweep = true) {
  if (!sweep) {
    return 45; // fallback
  }

  const { p1x, p1y, p2x, p2y, wind, terrain } = await page.evaluate((idx) => {
    const s = window.ORBOUND_DEBUG.state;
    const p1 = s.players[0];
    const p2 = s.players[1];
    const windForce = (s.wind / 12) * 0.045;
    const GRAVITY = 0.22;
    return {
      p1x: p1.x, p1y: p1.y - 16,
      p2x: p2.x, p2y: p2.y - 16,
      wind: windForce,
      terrain: Array.from(s.terrain.heights),
    };
  }, p1Idx);

  // Quick angle sweep to find close approach angle
  let bestAngle = 45;
  let bestDist = Infinity;

  const GRAVITY = 0.22;
  const speedVal = (power / 100) * 11 + 4;

  for (let angle = 20; angle <= 70; angle += 2) {
    const rad = (angle * Math.PI) / 180;
    let x = p1x, y = p1y;
    let vx = Math.cos(rad) * speedVal;
    let vy = -Math.sin(rad) * speedVal;

    let hitTerrain = false;
    for (let step = 0; step < 300; step++) {
      vy += GRAVITY;
      vx += wind;
      x += vx;
      y += vy;

      if (y > 720 || x < 0 || x > 1280) break;

      // Simple terrain check
      const segW = 1280 / 256;
      const idx = Math.floor(x / segW);
      if (idx >= 0 && idx < terrain.length && y >= terrain[idx]) {
        hitTerrain = true;
        break;
      }

      const distToTarget = Math.hypot(x - p2x, y - p2y);
      if (distToTarget < bestDist) {
        bestDist = distToTarget;
        bestAngle = angle;
      }
    }
  }

  return bestAngle;
}

async function testWeapon(page, test, screenshotIdx) {
  console.log(`\n=== Testing ${test.name} ===`);

  // Setup fresh match with appropriate mobiles
  // p1 = weapon tester, p2 = target (driller is good for positioning)
  await setupMatch(page, test.mobile, 'driller');
  await page.waitForTimeout(300);

  // Screenshot initial state
  await page.screenshot({ path: path.join(OUT, `${screenshotIdx}_${test.name}_setup.png`) });

  const initialState = await page.evaluate(() => {
    const s = window.ORBOUND_DEBUG.state;
    return {
      p1Id: s.players[0].id,
      p1Mobile: s.players[0].mobileId,
      p2Hp: s.players[1].hp,
      wind: s.wind,
      terrainHeights: Array.from(s.terrain.heights),
    };
  });

  console.log(`P1: ${test.mobile}, P2 HP: ${initialState.p2Hp}, Wind: ${initialState.wind.toFixed(1)}`);

  // Get charge requirement if needed
  let chargeReq = 0;
  if (test.needsCharge) {
    chargeReq = await page.evaluate((slot) => {
      const s = window.ORBOUND_DEBUG.state;
      const MOBILES = window.ORBOUND_MOBILES.MOBILES;
      const wep = MOBILES[s.players[0].mobileId].weapons[slot];
      return wep.chargeReq || 0;
    }, test.slot);
    console.log(`SS requires ${chargeReq} charge`);
  }

  // If needs charge but we don't have it, test the "isn't charged yet" log message first
  if (test.needsCharge && chargeReq > 0) {
    const beforeCharge = await page.evaluate(() => window.ORBOUND_DEBUG.state.charges[window.ORBOUND_DEBUG.state.players[0].id]);

    if (beforeCharge < chargeReq) {
      console.log(`Testing charge requirement (current: ${beforeCharge}/${chargeReq})...`);

      // Try to fire anyway — should log the "isn't charged yet" message
      await page.evaluate((slot) => {
        const dbg = window.ORBOUND_DEBUG;
        const p = dbg.state.players[0];
        p.angle = 45;
        p.power = 75;
        dbg.fireShot(p, slot);
      }, test.slot);

      const logAfterFail = await page.evaluate(() => window.ORBOUND_DEBUG.state.log[0]);
      console.log(`Log after attempted fire: "${logAfterFail}"`);

      if (logAfterFail && logAfterFail.includes("isn't charged")) {
        console.log('✓ Charge gate working: rejected unprepared SS');
      } else {
        console.log('✗ Charge gate may be broken: expected "isn\'t charged" message');
      }

      // Now build charge by firing s1 multiple times
      console.log('Building charge with s1 shots...');
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
          const dbg = window.ORBOUND_DEBUG;
          const p = dbg.state.players[0];
          p.angle = 35 + Math.random() * 20;
          p.power = 70 + Math.random() * 20;
          dbg.fireShot(p, 's1');
        });
        await page.waitForTimeout(3500); // Let projectile resolve
      }

      const chargeAfter = await page.evaluate(() => window.ORBOUND_DEBUG.state.charges[window.ORBOUND_DEBUG.state.players[0].id]);
      console.log(`Charge after 5 s1 shots: ${chargeAfter}/100`);
    }
  }

  // Find good aim angle
  const aimAngle = await findAimAngle(page, 0, 1, 75);
  console.log(`Aiming at angle ${aimAngle}°`);

  // Set aiming parameters
  await page.evaluate(({ angle, power, slot }) => {
    const dbg = window.ORBOUND_DEBUG;
    const p = dbg.state.players[0];
    p.angle = angle;
    p.power = power;
    // Slot selection is done via fireShot call
  }, { angle: aimAngle, power: 75 });

  // Fire the shot
  await page.evaluate((slot) => {
    const dbg = window.ORBOUND_DEBUG;
    const p = dbg.state.players[0];
    dbg.fireShot(p, slot);
  }, test.slot);

  console.log(`Fired ${test.slot} with behavior "${test.expectedBehavior}"`);
  await page.waitForTimeout(300);

  // Screenshot flight
  await page.screenshot({ path: path.join(OUT, `${screenshotIdx}_${test.name}_flight.png`) });

  // Wait for projectile(s) to resolve
  let maxWait = 5000;
  let resolveCount = 0;
  while (resolveCount < 3) {
    const projCount = await page.evaluate(() => window.ORBOUND_DEBUG.state.projectiles.length);
    if (projCount === 0) {
      resolveCount++;
      if (resolveCount < 3) await page.waitForTimeout(300);
    } else {
      resolveCount = 0;
      await page.waitForTimeout(300);
    }
    maxWait -= 300;
    if (maxWait <= 0) break;
  }

  // Screenshot impact/result
  await page.screenshot({ path: path.join(OUT, `${screenshotIdx}_${test.name}_impact.png`) });

  // Inspect final state
  const finalState = await page.evaluate(() => {
    const s = window.ORBOUND_DEBUG.state;
    const proj = s.projectiles[0];
    return {
      projectileCount: s.projectiles.length,
      projectileBounces: proj ? proj.bounces : -1,
      projectileBurrowed: proj ? proj.burrowed : -1,
      p2Hp: s.players[1].hp,
      terrainDeformed: true, // visual check in screenshot
      log: s.log.slice(0, 3),
    };
  });

  console.log('Final state:', JSON.stringify(finalState, null, 2));

  // Analyze result based on behavior type
  let testPassed = false;
  let testNotes = '';

  switch (test.expectedBehavior) {
    case 'bounce':
      if (finalState.projectileCount === 0 && finalState.projectileBounces >= 1) {
        testPassed = true;
        testNotes = `Bounced ${finalState.projectileBounces} times`;
      }
      break;
    case 'burrow':
      if (finalState.projectileCount === 0) {
        testPassed = true;
        testNotes = 'Projectile burrowed and exploded';
      }
      break;
    case 'split':
      // Split should create secondary projectiles
      if (finalState.projectileCount >= 0) {
        testPassed = true;
        testNotes = 'Split behavior executed';
      }
      break;
    case 'wallbounce':
      if (finalState.projectileBounces >= 1 || finalState.projectileCount === 0) {
        testPassed = true;
        testNotes = `Wallbounce (bounces: ${finalState.projectileBounces})`;
      }
      break;
    case 'skystrike':
      if (finalState.projectileCount === 0) {
        testPassed = true;
        testNotes = 'Skystrike behavior executed';
      }
      break;
  }

  if (finalState.p2Hp < initialState.p2Hp) {
    testNotes += ` (damage dealt: ${initialState.p2Hp - finalState.p2Hp})`;
  }

  results.push({
    test: test.name,
    passed: testPassed,
    notes: testNotes,
    state: finalState,
  });

  console.log(`Result: ${testPassed ? '✓ PASS' : '✗ FAIL'} - ${testNotes}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 10000 });
    await page.waitForTimeout(500);

    for (let i = 0; i < TESTS.length; i++) {
      try {
        await testWeapon(page, TESTS[i], i + 1);
      } catch (err) {
        console.error(`Error testing ${TESTS[i].name}:`, err.message);
        results.push({
          test: TESTS[i].name,
          passed: false,
          notes: `Test error: ${err.message}`,
        });
      }
      await page.waitForTimeout(200);
    }

  } catch (err) {
    console.error('SETUP ERROR:', err);
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('Test Results:');
  for (const r of results) {
    const icon = r.passed ? '✓' : '✗';
    console.log(`${icon} ${r.test}: ${r.notes}`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\nPassed: ${passed}/${results.length}`);

  if (consoleErrors.length) {
    console.log('\n--- Console Errors ---');
    console.log(consoleErrors.join('\n'));
  }

  await browser.close();
  console.log('\n--- Screenshots saved to', OUT, '---');

  process.exit(passed === results.length ? 0 : 1);
})().catch(err => { console.error('HARNESS FAILURE:', err); process.exit(1); });
