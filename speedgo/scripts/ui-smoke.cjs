// Browser test of the full ride (rider + driver + admin) against a RUNNING local stack seeded with `npm run seed:demo`.
// Run: ADMIN_PASSWORD=... node scripts/ui-smoke.cjs ./smoke-shots     (needs: npx playwright install chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const GEO = { latitude: 30.1667, longitude: 72.65 };
const log = (m) => console.log('•', m);

(async () => {
  const browser = await chromium.launch();
  const mk = async (w, h, scheme = 'light') => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, geolocation: GEO, permissions: ['geolocation'], colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Test reason' : undefined));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/tile|openstreetmap|ERR_|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    return { ctx, page, errors };
  };
  const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const login = async (p, url, phone) => {
    await p.goto(url);
    await p.getByLabel('Mobile number').fill(phone);
    await p.getByRole('button', { name: 'Send code' }).click();
    await p.locator('.otp-boxes input').first().focus();
    await p.keyboard.type('123456');
  };

  const D = await mk(390, 844, 'dark');
  const R = await mk(390, 844, 'light');
  if (!process.argv[3]) try {
    // ---- driver logs in and goes online
    await shot(D.page, '00'); // blank guard
    await login(D.page, 'http://localhost:5172', '03000000001');
    await D.page.getByRole('button', { name: /Go online/ }).waitFor({ timeout: 8000 });
    await shot(D.page, 'driver-1-home-offline');
    await D.page.getByRole('button', { name: /Go online/ }).click();
    await D.page.getByText('You are online').waitFor();
    log('driver online');
    await shot(D.page, 'driver-2-online');

    // ---- rider logs in, picks a destination on the map
    await login(R.page, 'http://localhost:5171', '03000000100');
    await R.page.getByText('Where to?').waitFor({ timeout: 8000 });
    await R.page.waitForTimeout(1200);
    await shot(R.page, 'rider-1-home');
    await R.page.getByText('Where to?').click();
    await shot(R.page, 'rider-2-search');
    await R.page.getByText('Choose on map').click();
    const box = await R.page.locator('.leaflet-container').boundingBox();
    await R.page.mouse.click(box.x + box.width / 2 + 90, box.y + box.height / 2 - 120);
    await R.page.getByText('Choose a ride').waitFor({ timeout: 8000 });
    await R.page.getByRole('button', { name: /Find drivers/ }).waitFor();
    await R.page.waitForTimeout(500);
    await shot(R.page, 'rider-3-choose-ride');
    log('rider sees estimates');
    await R.page.getByRole('button', { name: /Find drivers/ }).click();
    await R.page.getByText('Looking for drivers near you').waitFor();
    await shot(R.page, 'rider-4-searching');

    // ---- driver receives the request and accepts at the rider's price
    await D.page.getByText('NEW RIDE REQUEST').waitFor({ timeout: 8000 });
    await shot(D.page, 'driver-3-request');
    log('driver got request');
    await D.page.getByRole('button', { name: 'Accept' }).click();
    await R.page.getByText(/driver replied/).waitFor({ timeout: 8000 });
    await R.page.waitForTimeout(400);
    await shot(R.page, 'rider-5-offers');
    await R.page.getByRole('button', { name: /^Accept Demo/ }).click();
    await R.page.getByText(/Driver is on the way/).waitFor({ timeout: 8000 });
    await D.page.getByText('Go to pickup').waitFor();
    log('ride accepted by rider');
    await shot(R.page, 'rider-6-driver-on-way');
    await shot(D.page, 'driver-4-go-to-pickup');

    // ---- arrive, PIN, start
    await D.page.getByRole('button', { name: 'I have arrived' }).click();
    await R.page.getByText('Your driver has arrived').waitFor({ timeout: 8000 });
    const pin = (await R.page.locator('.pin span').allTextContents()).join('');
    log('rider PIN ' + pin);
    await shot(R.page, 'rider-7-arrived-pin');
    await D.page.getByLabel('Ride PIN').fill('0000'.replace(/./g, (c) => (pin === '0000' ? '1' : c)));
    await D.page.getByRole('button', { name: 'Start ride' }).click();
    await D.page.getByText(/PIN is not correct/).waitFor({ timeout: 5000 });
    log('wrong PIN rejected');
    await D.page.getByLabel('Ride PIN').fill(pin);
    await shot(D.page, 'driver-5-pin');
    await D.page.getByRole('button', { name: 'Start ride' }).click();
    await D.page.getByText('Ride in progress').waitFor({ timeout: 8000 });
    await R.page.getByText('On your way').waitFor({ timeout: 8000 });
    await shot(D.page, 'driver-6-in-progress');
    await shot(R.page, 'rider-8-in-progress');

    // ---- complete, cash, ratings
    await D.page.getByRole('button', { name: 'Complete ride' }).click();
    await D.page.getByText('Ride complete').waitFor({ timeout: 8000 });
    await shot(D.page, 'driver-7-complete');
    await R.page.getByText('You have arrived').waitFor({ timeout: 8000 });
    await shot(R.page, 'rider-9-complete');
    await D.page.getByRole('button', { name: 'Cash collected' }).click();
    await D.page.getByText(/^Rate /).waitFor();
    await D.page.getByRole('button', { name: '5 stars' }).click();
    await D.page.getByRole('button', { name: 'Submit' }).click();
    await D.page.getByRole('button', { name: 'Done' }).click();
    await R.page.getByRole('button', { name: '5 stars' }).click();
    await R.page.getByRole('button', { name: 'Submit' }).click();
    await R.page.getByRole('button', { name: 'Done' }).click();
    await R.page.getByText('Where to?').waitFor();
    log('ride finished, both rated');
    await D.page.getByRole('button', { name: 'Earnings' }).click();
    await D.page.waitForTimeout(600);
    await shot(D.page, 'driver-8-earnings');
  } catch (e) {
    console.error('FAILED:', e.message);
    await shot(D.page, 'FAIL-driver').catch(() => {});
    await shot(R.page, 'FAIL-rider').catch(() => {});
    process.exitCode = 1;
  }
  if (!process.argv[3]) for (const [n, x] of [['driver', D], ['rider', R]]) if (x.errors.length) { console.error(n + ' console errors:', x.errors.slice(0, 5)); process.exitCode = 1; }

  // ---- admin, dark then light
  try {
    const A = await mk(1440, 900, 'dark');
    await A.page.goto('http://localhost:5173');
    await A.page.getByLabel('Email').fill((process.env.ADMIN_EMAIL || 'admin@speedgo.local'));
    await A.page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD || '');
    await A.page.getByRole('button', { name: 'Sign in' }).click();
    await A.page.getByRole('heading', { name: 'Live operations' }).waitFor({ timeout: 8000 });
    await A.page.waitForTimeout(1500);
    await shot(A.page, 'admin-1-live-dark');
    await A.page.getByRole('radio', { name: 'Light' }).first().click();
    await A.page.waitForTimeout(400);
    await shot(A.page, 'admin-2-live-light');
    for (const [label, name] of [['Drivers', 'admin-3-drivers'], ['Rides', 'admin-4-rides'], ['Pricing & settings', 'admin-5-pricing'], ['Management', 'admin-6-management'], ['Roles & staff', 'admin-7-roles'], ['Audit log', 'admin-8-audit']]) {
      await A.page.getByRole('button', { name: new RegExp('^' + label.replace(/[&]/g, '\\&')) }).first().click();
      await A.page.waitForTimeout(900);
      await shot(A.page, name);
    }
    // completed ride must appear in the admin rides list
    await A.page.getByRole('button', { name: /^Rides/ }).first().click();
    await A.page.getByRole('tab', { name: 'Completed' }).click();
    await A.page.getByRole('row').nth(1).waitFor({ timeout: 5000 });
    log('admin sees the completed ride');
    if (A.errors.length) { console.error('admin console errors:', A.errors.slice(0, 5)); process.exitCode = 1; }
  } catch (e) {
    console.error('ADMIN FAILED:', e.message);
    process.exitCode = 1;
  }
  await browser.close();
  console.log(process.exitCode ? 'RESULT: FAILED' : 'RESULT: ALL STEPS PASSED');
})();
