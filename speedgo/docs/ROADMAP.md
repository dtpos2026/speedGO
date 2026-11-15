# SpeedGo roadmap

## Phase 1: ride-hailing, local test (this build)
Everything in the README works end to end on one computer. Goal: you and your team test the full ride flow in Burewala, report what feels wrong, and we fix it.

Exit checklist for Phase 1:
- [ ] A full ride on two real phones (same Wi-Fi) with a real GPS walk
- [ ] 10 test drivers registered and approved through the admin panel
- [ ] Fares in **Pricing & settings** tuned to Burewala
- [ ] Your backgrounds, images and final logo files applied
- [ ] Urdu wording reviewed by a native speaker

## Phase 1.5: make it pilot-ready (before real customers)
- Real SMS OTP (a Pakistani gateway) and a hosted server with HTTPS and backups
- Native Android driver and rider apps (background GPS, push notifications, Play Store)
- PostgreSQL and Redis instead of SQLite
- Own OSRM and address-search server (or paid map provider)
- Masked calling and in-app chat
- Saved places, ride history details, promo codes, referrals
- Driver wallet top-up through Easypaisa/JazzCash, with admin reconciliation
- Fully translated Urdu (including admin)

## Phase 2: merchants and food
Already in Phase 1: Pick & Drop and Delivery bookings, booking numbers, item and receiver details.
Still to build:
- Merchant (restaurant / shop) app and admin module: menu, prices, opening hours, accept and ready
- Customer cart and checkout, so the shop price is shown in the app
- Per-service commission, reports and promotions

## Phase 3: parcel delivery, complete
- Parcel size and weight classes, fragile and cash-on-delivery options
- Pickup and drop proof (photo and PIN), SMS and tracking link for the receiver
- COD cash settlement in the driver wallet
- Business accounts and invoices

## Later
Scheduled rides, intercity, women-only option, driver incentives and heat-map, dispute and refund desk, forecasting.
