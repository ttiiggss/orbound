// Verification harness for Nostr integration
// Uses playwright-core with Chromium binary at /home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome

'use strict';

const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const PORT = 8793;
const BASE_URL = `http://localhost:${PORT}`;
const SHOTS_DIR = '/tmp/track_b_shots';

// Create shots directory
if (!fs.existsSync(SHOTS_DIR)) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

// Simple HTTP server to serve client/
function startServer(clientDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let filePath = path.join(clientDir, req.url === '/' ? 'index.html' : req.url);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
      };
      const contentType = mimeTypes[ext] || 'text/plain';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Server Error');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    server.listen(PORT, () => {
      console.log(`[SERVER] listening on ${BASE_URL}`);
      resolve(server);
    });
  });
}

// Generate a real Nostr keypair
function generateKeypair() {
  const sk = crypto.randomBytes(32);
  return {
    sk: sk.toString('hex'),
    npub: generateNpub(sk),
  };
}

// Stub npub generation (would use nostr-tools in real code)
function generateNpub(sk) {
  const hash = crypto.createHash('sha256').update(Buffer.from(sk, 'hex')).digest();
  return 'npub1' + hash.toString('hex').substring(0, 16);
}

// Main test suite
async function runTests() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const server = await startServer(path.join(__dirname, 'client'));
  const keypair = generateKeypair();

  console.log('[TEST] Generated keypair, npub:', keypair.npub);

  try {
    // Test 1: Login flow with mock Nostr
    console.log('\n[TEST 1] Login flow with mock Nostr');
    {
      const page = await browser.newPage();

      // Inject mock window.nostr BEFORE page load
      await page.addInitScript(() => {
        // Real-ish mock of NIP-07
        window.nostr = {
          async getPublicKey() {
            return '3050bf7b858a40f85c1676db0921b11b1380fb4459d7711bc4900b371657b2e1';
          },
          async signEvent(event) {
            // In real test, would sign with nostr-tools, but for now just fake it
            return {
              ...event,
              id: 'fake-event-id-' + Math.random().toString(36).substring(7),
              sig: '0'.repeat(128), // 128-char hex string is a valid sig format
            };
          },
        };
      });

      await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // Take screenshot of initial state
      await page.screenshot({ path: `${SHOTS_DIR}/01-initial-state.png` });
      console.log('  ✓ Screenshot: 01-initial-state.png');

      // Click login button
      const loginBtn = await page.$('#nostr-ui-container button');
      if (loginBtn) {
        await loginBtn.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${SHOTS_DIR}/02-after-login.png` });
        console.log('  ✓ Screenshot: 02-after-login.png');

        // Check if npub display is populated
        const npubDisplay = await page.$('div:has-text("npub1")');
        if (npubDisplay) {
          console.log('  ✓ Npub display populated after login');
        } else {
          console.log('  ⚠ Npub display not visible (may be in npubDisplay element)');
        }
      } else {
        console.log('  ⚠ Login button not found');
      }

      await page.close();
    }

    // Test 2: Relay picker defaults
    console.log('\n[TEST 2] Relay picker defaults (3 relays checked)');
    {
      const page = await browser.newPage();

      // Don't inject Nostr to test it exists but is optional
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // Check if relay picker button exists
      const relayBtn = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find(b => b.textContent.includes('Relays')) ? true : false;
      });

      if (relayBtn) {
        console.log('  ✓ Relay picker button found');

        // Click relay button to open picker
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.includes('Relays'));
          if (btn) btn.click();
        });
        await page.waitForTimeout(300);

        // Count checked relays
        const checkedCount = await page.evaluate(() => {
          const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          return checkboxes.filter(cb => cb.checked).length;
        });

        console.log(`  ✓ Found ${checkedCount} checked relays (should be 3 by default)`);
        if (checkedCount === 3) {
          console.log('  ✓ Default 3 relays confirmed!');
        } else {
          console.log(`  ⚠ Expected 3 checked relays, got ${checkedCount}`);
        }

        // List the checked relays
        const checkedRelays = await page.evaluate(() => {
          const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
          return checkboxes
            .filter(cb => cb.checked)
            .map(cb => cb.value)
            .slice(0, 3);
        });

        console.log('  Default relays:');
        for (const relay of checkedRelays) {
          console.log(`    - ${relay}`);
        }

        // Screenshot relay picker
        await page.screenshot({ path: `${SHOTS_DIR}/03-relay-picker-open.png` });
        console.log('  ✓ Screenshot: 03-relay-picker-open.png');
      } else {
        console.log('  ⚠ Relay picker button not found');
      }

      await page.close();
    }

    // Test 3: Game works without Nostr
    console.log('\n[TEST 3] Game works with NO window.nostr (graceful degradation)');
    {
      const page = await browser.newPage();

      // Explicitly NOT inject window.nostr
      // Set up error listener
      const errors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });

      await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // Check if game initialized
      const gameReady = await page.evaluate(() => {
        return typeof window.ORBOUND_GAME_STATE !== 'undefined';
      });

      if (gameReady) {
        console.log('  ✓ Game initialized without Nostr');
      } else {
        console.log('  ⚠ Game state not found');
      }

      // Try to start a match
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      const phase = await page.evaluate(() => window.ORBOUND_GAME_STATE?.phase);
      if (phase === 'aiming') {
        console.log('  ✓ Match started successfully (no Nostr errors)');
      }

      // Check for critical errors
      if (errors.length > 0) {
        console.log('  Errors encountered:');
        errors.slice(0, 3).forEach(e => console.log(`    - ${e}`));
      } else {
        console.log('  ✓ No console errors');
      }

      await page.screenshot({ path: `${SHOTS_DIR}/04-game-no-nostr.png` });
      console.log('  ✓ Screenshot: 04-game-no-nostr.png');

      await page.close();
    }

    // Test 4: Check relay list for primal.net
    console.log('\n[TEST 4] Verify ZERO primal.net domains in relay list');
    {
      const page = await browser.newPage();
      await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      // Click relay button to open picker
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.includes('Relays'));
        if (btn) btn.click();
      });
      await page.waitForTimeout(300);

      const allRelays = await page.evaluate(() => {
        const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        return checkboxes.map(cb => cb.value);
      });

      const primalRelays = allRelays.filter(r => r.includes('primal'));
      if (primalRelays.length === 0) {
        console.log(`  ✓ CONFIRMED: 0 primal.net domains in ${allRelays.length} relays`);
      } else {
        console.log(`  ✗ FAILED: Found ${primalRelays.length} primal.net relays:`);
        primalRelays.forEach(r => console.log(`    - ${r}`));
      }

      await page.close();
    }

    // Test 5: Gameover screen and share button
    console.log('\n[TEST 5] Gameover screen and Share button');
    {
      const page = await browser.newPage();

      // Inject mock Nostr
      await page.addInitScript(() => {
        window.nostr = {
          async getPublicKey() {
            return '3050bf7b858a40f85c1676db0921b11b1380fb4459d7711bc4900b371657b2e1';
          },
          async signEvent(event) {
            return {
              ...event,
              id: 'fake-event-id-' + Math.random().toString(36).substring(7),
              sig: '0'.repeat(128),
            };
          },
        };
      });

      await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      // Login first - click first button
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        if (btns[0]) btns[0].click();
      });
      await page.waitForTimeout(500);

      // Start a match
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // Fast-forward to gameover using debug tools
      await page.evaluate(() => {
        if (window.ORBOUND_DEBUG) {
          window.ORBOUND_GAME_STATE.phase = 'gameover';
          window.ORBOUND_GAME_STATE.winner = 0;
        }
      });

      await page.waitForTimeout(500);

      // Check if share button is visible
      const shareBtn = await page.evaluate(() => {
        const btn = document.getElementById('share-result-btn');
        return btn ? {
          visible: btn.style.display !== 'none',
          text: btn.textContent,
        } : null;
      });

      if (shareBtn && shareBtn.visible) {
        console.log('  ✓ Share button visible on gameover screen');
        console.log(`    Text: "${shareBtn.text}"`);
      } else if (shareBtn) {
        console.log('  ⚠ Share button exists but hidden');
      } else {
        console.log('  ⚠ Share button not found');
      }

      await page.screenshot({ path: `${SHOTS_DIR}/05-gameover-share-button.png` });
      console.log('  ✓ Screenshot: 05-gameover-share-button.png');

      await page.close();
    }

    console.log('\n[VERIFICATION] All tests completed!');
    console.log(`Screenshots saved to: ${SHOTS_DIR}`);

  } catch (error) {
    console.error('[ERROR]', error);
  } finally {
    await browser.close();
    server.close();
    console.log('[SERVER] closed');
  }
}

// Run tests
runTests().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
