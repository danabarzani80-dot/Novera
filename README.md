# Pharmacy POS & Management (IQD, EN / کوردی / عربي)

Offline-first pharmacy POS + ERP. React 18 + TypeScript + Vite + Tailwind v4 front end, a local Express API, and a SQLite database stored in `data/pharmacy.db`.

## Install

Requires Node.js 20+ (22 recommended).

```bash
npm install
```

## Run

```bash
npm run build     # build the web app once
npm start         # API + app on http://127.0.0.1:3000
```

Development with hot reload (two terminals):

```bash
npm run dev          # API on :3000
npm run dev:client   # Vite on :5173 (proxies /api to :3000)
```

## First-run setup

There are **no default or demo accounts**. The first time you open the app it shows a one-time
*Create Super Admin* screen (pharmacy name, your name, username, password of 8+ characters).
After that, normal login. The Super Admin then adds users under **Users & Doctors**
(`pharmacist`, `cashier`, `warehouse_manager`, `doctor`) and extra **Branches**.

Typical first steps: add suppliers → **Receive Invoice** (creates batches and stock) → open a **shift** → sell in **POS**.

## Roles

| Role | Modules |
| --- | --- |
| super_admin | everything |
| pharmacist | everything except Branches, Users, Audit |
| cashier | Dashboard, POS, Returns, Customers, Shifts |
| warehouse_manager | Dashboard, inventory, purchasing, supplier ledger |
| doctor | Doctor Portal only |

Permissions are enforced on the API (`src/server/routes.ts`) and in the sidebar (`src/types/pharmacy.ts`).

## Business rules (all enforced server-side, in transactions)

- **FEFO**: sales take stock from the earliest-expiring valid batch first, spanning batches when needed.
- **Expired-batch lock**: the backend refuses to sell an expired batch (`EXPIRED_BATCH`), even if the UI is bypassed.
- Purchase price is stored on every sold line, so COGS and profit are exact.
- **Qarz** (customer credit) balance = Qarz sales − payments − returns refunded to Qarz.
- Supplier balance = approved credit invoices + old invoices − payments − returns to vendor.
- Branch transfers move stock only when the receiving branch confirms receipt.
- `audit_logs` is append-only (database triggers block UPDATE and DELETE).
- All money is stored as integer IQD.

## Tests

```bash
npm test             # FEFO, expired lock, Qarz, returns, supplier ledger, transfers, P&L math
npm run i18n:check   # every translation key used has EN + KU + AR text
npm run typecheck
```

## Backup / restore

**Users & Doctors → Backup & restore** exports a consistent copy of the database and can import one
(this replaces all current data). The database file itself is `data/pharmacy.db`
(override with `PHARMACY_DATA_DIR` or `PHARMACY_DB`).

## Desktop app (optional, Windows / macOS / Linux, works offline)

```bash
npm i -D electron electron-builder
npm run electron:dev     # run in an Electron window
npm run electron:build   # installer in ./release
```

The desktop app stores its data in the OS user-data folder. `better-sqlite3` is rebuilt for Electron by electron-builder.

## Printing

Receipts, Z-reports, purchase orders and barcode stickers use the browser/Electron print dialog with `no-print` CSS.
Receipts are laid out for 80 mm thermal paper; stickers for 50×30 mm labels.

## Notes

- Set a strong `PHARMACY_SECRET` environment variable in production; otherwise a random secret is generated in `data/.secret`.
- By default the server listens on `127.0.0.1` only. Set `HOST=0.0.0.0` to use it from other computers on the LAN (put it behind HTTPS if the network is not trusted).

## Run in the background (Windows, starts automatically)

Double-click `scripts\install-autostart.cmd`. It registers a per-user startup task that runs the server hidden
(no window) every time you sign in, restarts it if it stops, and starts it right away. Logs go to `data\server.log`.
Open http://127.0.0.1:3000. Run `scripts\uninstall-autostart.cmd` to remove it and stop the server.

## Use from other computers on the network

The background scripts make the server listen on all network interfaces (`HOST=0.0.0.0`).
1. On the server PC, right-click `scriptsallow-network.cmd` → *Run as administrator* (opens port 3000 for the private network only).
2. On other computers open `http://<server-PC-IP>:3000` (the script prints the IP; `dataserver.log` lists it too).
3. Give the server PC a fixed IP in your router so the address doesn't change.

The connection is plain HTTP, so use it only on a network you trust. Each computer signs in with its own user account.
