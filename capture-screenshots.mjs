import { chromium } from 'playwright';
import { copyFileSync } from 'fs';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('Opening http://localhost:5176...');
  await page.goto('http://localhost:5176');

  console.log('Waiting for map to render...');
  await page.waitForTimeout(5000);

  // Take screenshots and copy to public folder
  const screenshots = [
    { name: 'initial', zoom: 0 },
    { name: 'zoom1', zoom: 3 },
    { name: 'zoom2', zoom: 6 },
    { name: 'closeup', zoom: 9 },
  ];

  await page.mouse.move(400, 400);

  for (const { name, zoom } of screenshots) {
    if (zoom > 0) {
      console.log(`Zooming in (${zoom} steps)...`);
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, -100);
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(500);
    }

    console.log(`Taking ${name} screenshot...`);
    const filename = `screenshot-${name}.png`;
    await page.screenshot({ path: filename });

    // Copy to public folder
    copyFileSync(filename, `public/${filename}`);
    console.log(`  → Copied to public/${filename}`);
  }

  // Take rotated view
  console.log('Rotating map...');
  await page.mouse.move(400, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(500, 300, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);

  console.log('Taking rotated screenshot...');
  await page.screenshot({ path: 'screenshot-rotated.png' });
  copyFileSync('screenshot-rotated.png', 'public/screenshot-rotated.png');
  console.log('  → Copied to public/screenshot-rotated.png');

  await browser.close();
  console.log('\nAll screenshots saved to public folder!');
  console.log('View at: http://localhost:5176/screenshot-*.png');
})();
