import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log('Opening http://localhost:5176...');
  await page.goto('http://localhost:5176');

  // Wait for map to load
  console.log('Waiting for map to render...');
  await page.waitForTimeout(5000);

  // Take initial screenshot
  console.log('Taking initial screenshot...');
  await page.screenshot({ path: 'screenshot-initial.png' });

  // Zoom in by scrolling
  console.log('Zooming in (zoom level 1)...');
  await page.mouse.move(400, 400);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  console.log('Taking zoomed screenshot 1...');
  await page.screenshot({ path: 'screenshot-zoom1.png' });

  // Zoom in more
  console.log('Zooming in more (zoom level 2)...');
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  console.log('Taking zoomed screenshot 2...');
  await page.screenshot({ path: 'screenshot-zoom2.png' });

  // Zoom in even more to see individual building details
  console.log('Zooming in close (zoom level 3)...');
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  console.log('Taking close-up screenshot...');
  await page.screenshot({ path: 'screenshot-closeup.png' });

  // Rotate while zoomed in to see z-fighting
  console.log('Rotating while zoomed...');
  await page.mouse.move(400, 400);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(500, 300, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  console.log('Taking rotated close-up screenshot...');
  await page.screenshot({ path: 'screenshot-closeup-rotated.png' });

  await browser.close();
  console.log('Screenshots saved!');
})();
