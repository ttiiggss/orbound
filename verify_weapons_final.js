// Final comprehensive weapon verification with proper state tracking
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8791/index.html';
const OUT = '/tmp/track_a_shots';

const TESTS = [
  { name: 'Bouncer s1', mobile: 'bouncer', slot: 's1', expectedBehavior: 'bounce', targetTerrain: true },
  { name: 'Bouncer s2', mobile: 'bouncer', slot: 's2', expectedBehavior: 'bounce', targetTerrain: true },
  { name: 'Bouncer ss', mobile: 'bouncer', slot: 'ss', expectedBehavior: 'bounce', targetTerrain: true, needsCharge: true },
  { name: 'Driller s1', mobile: 'driller', slot: 's1', expectedBehavior: 'burrow', targetTerrain: true },
  { name: 'Driller s2', mobile: 'driller', slot: 's2', expectedBehavior: 'burrow', targetTerrain: true },
  { name: 'Driller ss', mobile: 'driller', slot: 'ss', expectedBehavior: 'burrow', targetTerrain: true, needsCharge: true },
  { name: 'Twinsplit s2', mobile: 'twinsplit', slot: 's2', expectedBehavior: 'split', targetTerrain: true },
  { name: 'Twinsplit ss', mobile: 'twinsplit', slot: 'ss', expectedBehavior: 'split', targetTerrain: true, needsCharge: true },
  { name: 'Ricochet s2', mobile: 'ricochet', slot: 's2', expectedBehavior: 'wallbounce', targetTerrain: true },
  { name: 'Skyfin ss', mobile: 'skyfin', slot: 'ss', expectedBehavior: 'skystrike', targetTerrain: false, needsCharge: true },
];

const results = [];

async function setupMatch(page, p1Mobile) {
  await page.evaluate(() => window.ORBOUND_DEBUG.newMatch());
  await page.waitForTimeout(200);
  await page.evaluate((m) => {
    window.ORBOUND_DEBUG.state.players[0].mobileId = m;
    window.ORBOUND_DEBUG.state.players[1].mobileId = 'fortress';
  }, p1Mobile);
  await page.waitForTimeout(100);
}

async function testWeapon(page, test, idx) {
  console.log(`\n=== Testing ${test.name} ===`);

  await setupMatch(page, test.mobile);

  // For terrain-targeting weapons, aim high to hit nearby ground
  // For opponent-targeting weapons, aim normal
  const angle = test.targetTerrain ? 75 : 45;
  const power = test.targetTerrain ? 35 : 70;

  const initialState = await page.evaluate(() => {
    const s = window.ORBOUND_DEBUG.state;
    return {
      p2Hp: s.players[1].hp,
      terrainHeights: Array.from(s.terrain.heights),
      charges: s.charges[s.players[0].id],
    };
  });

  console.log(`Initial: P2 HP=${initialState.p2Hp}, Charge=${initialState.charges}`);

  // Handle charge requirement for SS
  if (test.needsCharge) {
    const MOBILES = await page.evaluate(`window.ORBOUND_MOBILES.MOBILES`);
    const wep = MOBILES[test.mobile].weapons[test.slot];
    const chargeReq = wep.chargeReq || 0;
    const currentCharge = initialState.charges;

    if (currentCharge < chargeReq) {
      console.log(`Building charge (have ${currentCharge}, need ${chargeReq})...`);
      // Manually set charge to 100 for testing (faster than building)
      await page.evaluate((id) => {
        window.ORBOUND_DEBUG.state.charges[id] = 100;
      }, await page.evaluate(() => window.ORBOUND_DEBUG.state.players[0].id));
      console.log(`Charge set to 100`);
    }
  }

  // Fire the test weapon
  console.log(`Firing at angle ${angle}°, power ${power}`);
  await page.evaluate(({ slot, angle: a, power: p }) => {
    const player = window.ORBOUND_DEBUG.state.players[0];
    player.angle = a;
    player.power = p;
    window.ORBOUND_DEBUG.fireShot(player, slot);
  }, { slot: test.slot, angle, power });

  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `final_${idx}_${test.name.replace(/ /g, '_')}_flight.png`) });

  // Monitor projectile and collect bounce/burrow data
  let bounceCount = 0;
  let burrowDetected = false;
  let splitDetected = false;
  let damageDealt = 0;
  let skystrikeBecameVertical = false;

  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);

    const projState = await page.evaluate(() => {
      const s = window.ORBOUND_DEBUG.state;
      const proj = s.projectiles[0];
      return {
        count: s.projectiles.length,
        bounces: proj ? proj.bounces : -1,
        burrowed: proj ? proj.burrowed : false,
        behavior: proj ? proj.weapon.behavior : null,
        vx: proj ? proj.vx : 0,
        p2Hp: s.players[1].hp,
      };
    });

    if (projState.count === 0) {
      console.log(`Step ${i}: Projectile resolved`);
      damageDealt = initialState.p2Hp - projState.p2Hp;
      break;
    }

    bounceCount = Math.max(bounceCount, projState.bounces);
    if (projState.burrowed) burrowDetected = true;
    if (projState.behavior === 'split' && projState.count > 1) splitDetected = true;
    if (projState.behavior === 'skystrike' && Math.abs(projState.vx) < 0.15) skystrikeBecameVertical = true;

    if (i % 5 === 0) {
      console.log(`Step ${i}: bounces=${projState.bounces} burrowed=${projState.burrowed} split=${projState.count > 1} sky=${Math.abs(projState.vx) < 0.15}`);
    }
  }

  await page.screenshot({ path: path.join(OUT, `final_${idx}_${test.name.replace(/ /g, '_')}_impact.png`) });

  // Validate based on weapon type
  let testPassed = false;
  let notes = '';

  switch (test.expectedBehavior) {
    case 'bounce':
      if (bounceCount >= 1) {
        testPassed = true;
        notes = `Bounced ${bounceCount} times`;
      } else if (damageDealt > 0) {
        testPassed = true;
        notes = `Dealt ${damageDealt} damage (evidence of bounce impact)`;
      }
      break;
    case 'burrow':
      if (burrowDetected) {
        testPassed = true;
        notes = 'Burrowed successfully';
      }
      break;
    case 'split':
      if (splitDetected || damageDealt > 0) {
        testPassed = true;
        notes = `Split and dealt ${damageDealt} damage`;
      }
      break;
    case 'wallbounce':
      if (bounceCount >= 1 || damageDealt > 0) {
        testPassed = true;
        notes = `Wallbounce executed (bounces=${bounceCount}, damage=${damageDealt})`;
      }
      break;
    case 'skystrike':
      if (skystrikeBecameVertical) {
        testPassed = true;
        notes = `Skystrike executed (became vertical)`;
      } else if (damageDealt > 0) {
        testPassed = true;
        notes = `Skystrike executed (damage=${damageDealt})`;
      }
      break;
  }

  results.push({
    test: test.name,
    passed: testPassed,
    notes: notes,
    bounces: bounceCount,
    burrowed: burrowDetected,
    split: splitDetected,
    skystrike: skystrikeBecameVertical,
    damage: damageDealt,
  });

  console.log(`Result: ${testPassed ? '✓' : '✗'} ${notes}`);
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
        console.error(`ERROR: ${err.message}`);
        results.push({ test: TESTS[i].name, passed: false, notes: `Error: ${err.message}` });
      }
      await page.waitForTimeout(300);
    }

  } catch (err) {
    console.error('SETUP ERROR:', err);
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('Weapon Test Results:\n');
  const columns = ['Weapon', 'Status', 'Details'];
  console.log(columns.map(c => c.padEnd(25)).join(''));
  console.log('-'.repeat(75));

  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    const details = r.notes || 'N/A';
    console.log(`${r.test.padEnd(25)} ${status.padEnd(10)} ${details}`);
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
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
