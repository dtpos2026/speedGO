import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { config } from './config.js';

const { server, seeded } = createApp();

server.listen(config.port, () => {
  console.log(`\nSpeedGo server running on http://localhost:${config.port}`);
  console.log(`  OTP mode: ${config.otpMode}${config.otpMode === 'dev' ? `  (use code ${config.devOtpCode} - LOCAL TESTING ONLY)` : ''}`);
  console.log(`  Routing: ${config.routing.enabled ? config.routing.url : 'straight-line estimate'}`);
  if (seeded.adminEmail) {
    const note = seeded.adminPassword
      ? `Admin account created.\n  Email:    ${seeded.adminEmail}\n  Password: ${seeded.adminPassword}\n  (shown once. Saved in ${path.join(config.dataDir, 'first-admin.txt')}; delete that file after you change the password)`
      : `Admin account created for ${seeded.adminEmail} with the password from SEED_ADMIN_PASSWORD.`;
    console.log('\n' + note + '\n');
    if (seeded.adminPassword) fs.writeFileSync(path.join(config.dataDir, 'first-admin.txt'), `${seeded.adminEmail}\n${seeded.adminPassword}\n`, { mode: 0o600 });
  }
});
