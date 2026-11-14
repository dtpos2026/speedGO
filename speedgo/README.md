# SpeedGo (Phase 1, runs locally)

A ride-hailing platform in one repository: **Rider app**, **Driver app**, **Admin panel** (with a Management dashboard) and the **server** behind them.
Phase 1 runs entirely on your own computer with no paid services and no licences: free OpenStreetMap maps, a local database and a fixed test OTP code.

| App | Folder | Address when running |
|---|---|---|
| Server (API + realtime) | `apps/server` | http://localhost:4000 |
| Rider app | `apps/rider` | http://localhost:5171 |
| Driver app | `apps/driver` | http://localhost:5172 |
| Admin panel | `apps/admin` | http://localhost:5173 |
| Shared code | `packages/shared`, `packages/ui` | – |

Design reference: the approved SpeedGo design canvas (purple theme, light and dark modes, English and Urdu).

## 1. Run it

You need **Node.js 22 or newer** (https://nodejs.org). Then, in this folder:

```bash
npm install
npm run seed:demo      # creates 5 demo drivers and 1 demo rider (optional but recommended)
npm run dev            # starts the server and all three apps
```

The first time the server starts it creates an **admin account** and prints the email and a random password **once** in the terminal (also saved in `apps/server/data/first-admin.txt`). Log in to the Admin panel with it. To choose your own password instead, start with `SEED_ADMIN_PASSWORD=yourpassword` the very first time.

## 2. Try a full ride in 2 minutes

Open the apps in separate browser windows (use a normal window and a private window, or two browsers):

1. **Driver app** (5172): log in with `0300 0000001` and code `123456`. Tap **Go online**. (Allow location when the browser asks. In test mode the **Move me** button lets you tap anywhere on the map to move yourself.)
2. **Rider app** (5171): log in with `0300 0000100`, code `123456`. Tap **Where to?**, choose **Choose on map**, tap a point on the map near the pickup, pick **Mini**, adjust your offer with **+10 / −10**, tap **Find drivers**.
3. **Driver app**: the request appears with a countdown. Tap **Accept** (or raise your price and tap **Offer**).
4. **Rider app**: the offer shows up. Tap **Accept**. The rider's 4-digit **ride PIN** is shown.
5. **Driver app**: **I have arrived**, enter the PIN, **Start ride**, **Complete ride**, **Cash collected**. Both sides can rate.
6. **Admin panel**: watch it live on **Live operations**, then open **Rides**, **Management** and **Audit log**.

To register a *new* driver instead: log in to the Driver app with any new number (`03xx xxxxxxx`), fill in the CNIC and vehicle details, upload the photos, submit. Then in the Admin panel open **Drivers → Pending review**, check the documents, and approve.

Phone testing: the apps listen on your local network too. Open `http://<your-computer-IP>:5171` (rider) or `:5172` (driver) on a phone connected to the same Wi-Fi. Note that phone browsers only share GPS on `https://` or `localhost`, so on a phone use **Move me (test)** or set up HTTPS later.

## 3. What Phase 1 includes (verified)

**Rider:** +92 phone login with OTP · map · destination search and "choose on map" · 5 vehicle types (Bike, Rickshaw, Mini, AC, VIP) with PKR fare estimate · **name your own fare** within allowed limits · live driver offers and counter-offers · accept the offer you like · ride PIN · live driver tracking · call or SMS the driver · share trip details · SOS · cancel · cash payment · rating · ride history · English / Urdu (main screens) · light / dark / auto theme.

**Driver:** registration (CNIC, licence, vehicle, 8 document photos) · approval status with per-document rejection reasons and re-upload · online / offline · request alerts with countdown, accept or counter-offer · navigation links · arrive, PIN start, complete · cash confirmation · earnings (day, week, month) with commission breakdown · wallet history · light / dark theme.

**Admin and Management:** live map and counters · driver verification with private document viewer · customers (block or unblock) · all rides with timeline and cancel · pricing, commission and rule settings · SOS handling · 10 roles with server-enforced permissions · staff accounts · audit log · management dashboard (revenue, rides, demand by hour, growth) with CSV export.

**Server:** order state machine (requested → accepted → arrived → in progress → completed, plus cancelled and no-driver) · nearest-driver dispatch · atomic acceptance (a driver can never be double-booked) · automatic expiry of unanswered requests · drivers who lose connection are taken offline automatically · commission booked to a wallet ledger.

### Test status

- `npm test` runs **19 automated end-to-end checks** (auth, permissions, driver approval, the whole ride, SOS, cancellation, expiry, blocking, wallet rules). All pass.
- `npm run typecheck` and `npm run build` are clean.
- `scripts/ui-smoke.cjs` drives the real apps in a browser through a complete ride (see its first lines). It passed on the last run.
- **Not tested:** real phones and GPS movement, real map tiles and routing (the build machine had no internet), load with many users, and any real payment or SMS service.

## 4. Known limits of Phase 1 (honest list)

- **Web apps, not Android apps yet.** The rider and driver apps are mobile-style web apps. A web page cannot track GPS in the background, so a driver's location is shared only while the app is open on screen. The native Android apps (needed for Play Store and background location) come after Phase 1 is accepted.
- **No SMS.** OTP is a fixed code (`123456`) and the server refuses to start in production mode with it.
- **Cash only.** Easypaisa, JazzCash, bank transfer and card payments are not built. A cancellation fee is *recorded* but not charged yet. Rider wallet, promo codes, referrals and saved places (Home, Work) are not built.
- **No push notifications** yet (needed for native apps). **Calls and messages** use normal phone links, not masked numbers or in-app chat.
- **Trip sharing** shares text only; a public live-tracking link comes later.
- **Maps:** OpenStreetMap tiles, the public OSRM routing server and Nominatim address search are free but meant for light use. They are fine for testing. For a real launch, host your own routing/search servers or use a paid provider. If routing is unreachable the server falls back to a straight-line distance estimate and says so.
- **Database:** SQLite (one file, in `apps/server/data`). Perfect for local and pilot use. The plan for scale is PostgreSQL + Redis (see `docs/ROADMAP.md`).
- **Admin:** promotions, finance payouts and reconciliation, disputes, complaints and lost items, fleet/zone management and forecasts are designed but not built.
- **Urdu** covers the main rider and driver screens. Admin is English only.
- Driver document photos are stored privately on the server disk and only staff with permission can open them. Each view is logged.

## 5. Settings you can change

Admin → **Pricing & settings** (applies to new requests): fares per vehicle, commission %, minimum driver wallet, offer limits, search radius, request lifetime, waiting and cancellation rules, peak-hour multipliers.
In test mode the minimum driver wallet is **0**. Demo drivers start with Rs 2,000. Use **Drivers → Adjust wallet** to top up real drivers later.

Environment variables (optional, `apps/server/.env`, see `.env.example`): `PORT`, `OTP_MODE`, `ROUTING=off` (no internet routing), `GEOCODER=off`, `OSRM_URL`, `NOMINATIM_URL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `ARRIVE_RADIUS_M` (for example `300` to require the driver to be near the pickup before "I have arrived").

## 6. Security notes

- No secrets are in the code. The signing secret is generated on first start and kept in `apps/server/data` (not committed).
- Every admin action is checked **on the server** against the person's role. Hiding a menu is only a convenience. Denied attempts are written to the audit log.
- Passwords are hashed with scrypt. Login and OTP endpoints are rate limited. Uploaded photos are checked by their real file type.
- Drivers never receive the ride PIN. The rider's phone number is only revealed to the driver after the rider accepts.
- Before any public launch: HTTPS, a real SMS provider, backups, and a security review are required.

## 7. Repository map

```
apps/server      Express + Socket.IO + SQLite. src/orders.ts is the ride state machine.
apps/rider       Rider web app (React + Vite)
apps/driver      Driver web app
apps/admin       Admin and Management panel
packages/shared  Types and helpers used by all (phone and CNIC checks, DTOs)
packages/ui      Theme (light/dark), language, map, API client, login flow
docs/ROADMAP.md  What comes next: food pickup, parcels, native apps
```

Orders are stored in a general `orders` table with a `service` field (`ride` today; `food` and `parcel` next), so pickup-and-delivery services reuse the same dispatch, offers, wallet and admin tools.
