// Quick test to verify power meter improvement
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = '/home/rjl/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const URL = 'http://localhost:8796/index.html';
const OUT = '/tmp/polish_verification_v2';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // Start game
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);

  // Take screenshot showing power meter
  await page.screenshot({ path: path.join(OUT, 'power-meter-improved.png') });
  console.log('✓ Power meter screenshot taken');

  await browser.close();
})().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
