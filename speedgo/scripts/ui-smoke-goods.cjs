// Browser test for Pick & Drop, profile photo and the admin Bookings page.
// Needs the seeded stack running (npm run seed:demo && npm run dev) and ADMIN_PASSWORD.
// Run: ADMIN_PASSWORD=... node scripts/ui-smoke-goods.cjs ./smoke-shots
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || './smoke-shots';
fs.mkdirSync(OUT, { recursive: true });
const GEO = { latitude: 30.1667, longitude: 72.65 };
const api = async (m, u, t, b) => (await fetch('http://localhost:4000' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
async function clearActive(phone) { // cancel a leftover test booking so the run can start clean
  await api('POST', '/api/auth/otp/request', null, { phone, role: 'rider' });
  const r = await api('POST', '/api/auth/otp/verify', null, { phone, role: 'rider', code: '123456' });
  const a = await api('GET', '/api/rider/orders/active', r.token);
  if (a.order) await api('POST', `/api/rider/orders/${a.order.id}/cancel`, r.token, { reason: 'test cleanup' });
}
const log = (m) => console.log('•', m);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await chromium.launch();
  const mk = async (w, h, scheme = 'light') => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, geolocation: GEO, permissions: ['geolocation'], colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Test reason' : undefined));
    return page;
  };
  const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
  const login = async (p, url, phone) => {
    await p.goto(url);
    await p.getByLabel('Mobile number').fill(phone);
    await p.getByRole('button', { name: 'Send code' }).click();
    await p.locator('.otp-boxes input').first().focus();
    await p.keyboard.type('123456');
  };
  await clearActive('03000000100');
  const D = await mk(390, 844, 'light');
  const C = await mk(390, 844, 'light');
  try {
    await login(D, 'http://localhost:5172', '03000000001');
    const go = D.getByRole('button', { name: /Go (online|offline)/ });
    await go.waitFor({ timeout: 8000 });
    if (/Go online/.test(await go.innerText())) await go.click();
    await D.getByText('You are online').waitFor({ timeout: 8000 });
    log('driver online');

    await login(C, 'http://localhost:5171', '03000000100');
    await C.getByText('Where to?').waitFor({ timeout: 8000 });
    // profile photo
    await C.getByRole('button', { name: 'Menu' }).click();
    const png = path.join(OUT, 'me.png');
    fs.writeFileSync(png, PNG);
    await C.locator('input[type=file]').setInputFiles(png);
    await C.getByText('Photo updated').waitFor({ timeout: 8000 });
    await C.waitForTimeout(500);
    await shot(C, 'c-profile');
    log('customer photo uploaded');
    await C.getByRole('button', { name: 'Close' }).click();

    // pick & drop
    await C.getByRole('tab', { name: 'Pick & Drop' }).click();
    await C.waitForTimeout(600);
    await shot(C, 'c-tabs');
    await C.getByText('What should we bring you?').click();
    await C.getByText('Collect from').waitFor();
    await C.getByRole('button', { name: /^(Change|Set)$/ }).first().click();
    await C.getByText('Choose on map').click();
    const box = await C.locator('.leaflet-container').boundingBox();
    await C.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2 - 100);
    await C.getByLabel('What should the driver collect?').fill('2 biryani from Rana Hotel');
    await shot(C, 'c-goods-form');
    await C.getByRole('button', { name: 'Choose vehicle and fare' }).click();
    await C.getByRole('button', { name: /Find drivers/ }).waitFor({ timeout: 8000 });
    await C.getByRole('button', { name: /^Mini/ }).click(); // the demo driver drives a Mini
    await shot(C, 'c-goods-choose');
    await C.getByRole('button', { name: /Find drivers/ }).click();
    await D.getByText('NEW RIDE REQUEST').waitFor({ timeout: 8000 });
    await D.getByText(/2 biryani from Rana Hotel/).waitFor();
    await D.getByText(/SG-PD-/).first().waitFor();
    await shot(D, 'd-goods-request');
    log('driver sees Pick & Drop request with item and booking number');
    await D.getByRole('button', { name: 'Accept' }).click();
    await C.getByText(/driver replied/).waitFor({ timeout: 8000 });
    await C.getByRole('button', { name: /^Accept Demo/ }).click();
    await D.getByText('Go to pickup').waitFor({ timeout: 8000 });
    await D.getByText(/2 biryani from Rana Hotel/).first().waitFor();
    await shot(D, 'd-goods-trip');
    log('trip card shows the item');

    // admin
    const A = await mk(1440, 900, 'light');
    await A.goto('http://localhost:5173');
    await A.getByLabel('Email').fill('admin@speedgo.local');
    await A.getByLabel('Password').fill(process.env.ADMIN_PASSWORD || '');
    await A.getByRole('button', { name: 'Sign in' }).click();
    await A.getByRole('heading', { name: 'Live operations' }).waitFor({ timeout: 8000 });
    await A.getByRole('button', { name: /^Bookings/ }).first().click();
    await A.getByText(/SG-PD-/).first().waitFor({ timeout: 8000 });
    await A.getByRole('tab', { name: 'Pick & Drop' }).click();
    await A.waitForTimeout(700);
    await shot(A, 'a-bookings');
    log('admin Bookings shows the Pick & Drop booking');

    await D.getByRole('button', { name: 'I have arrived' }).click();
    await A.waitForTimeout(1500);
    await shot(A, 'a-bookings-live');
    await D.getByRole('button', { name: /^Cancel/ }).first().click().catch(() => {});
    console.log('RESULT: ALL STEPS PASSED');
  } catch (e) {
    console.error('FAILED:', e.message);
    await shot(D, 'FAIL-driver').catch(() => {});
    await shot(C, 'FAIL-customer').catch(() => {});
    process.exitCode = 1;
    console.log('RESULT: FAILED');
  }
  await browser.close();
})();
