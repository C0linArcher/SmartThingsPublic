# FreshTrack 🥬

A food inventory management prototype for a company selling food and food
supplies. Built to run anywhere with zero external services — Node + an embedded
SQLite database, with a mobile-first single-page UI.

It implements the domain model in [`docs/uml.md`](docs/uml.md), focusing on the
two things that make *food* inventory different from generic inventory:
**lot/batch traceability** and **expiration dates**.

## Run it

```bash
cd food-inventory
npm install
npm start
# open http://localhost:3000
```

The database auto-seeds on first start with realistic demo data (9 products
across dairy, produce, bakery, dry goods, and packaging — including some
deliberately low-stock, expiring-soon, and expired lots so the dashboard has
something to show). To wipe and reseed:

```bash
npm run seed
```

> The app pins "today" to **2026-05-30** so the seeded expiry dates stay
> meaningful. Override with `FRESHTRACK_TODAY=YYYY-MM-DD`.

## What it demonstrates

- **Dashboard** — inventory value, low-stock count, lots expiring soon, expired
  units, and a prioritized alert feed (expired → low-stock → expiring).
- **Batch / lot tracking** — quantity lives on batches, not products. Each batch
  carries a lot number, received date, and expiration date with a live status
  (`AVAILABLE` / `EXPIRING_SOON` / `EXPIRED` / `DEPLETED`).
- **FEFO selling** — fulfilling a sale consumes stock **First-Expired-First-Out**
  across batches, splitting across lots as needed, and refuses to oversell or
  sell expired stock.
- **Immutable movement ledger** — every receipt, sale, and spoilage write-off is
  an append-only event, so current stock is always explainable.
- **Receive & waste** — receive new stock (auto-computing expiry from a product's
  shelf life if not given) and write off expired batches.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/dashboard` | Metrics + prioritized alerts |
| GET  | `/api/products` | Products with computed on-hand & reorder flags |
| GET  | `/api/products/:id/batches` | Batches with status & days-to-expiry |
| GET  | `/api/movements?limit=` | Stock movement ledger (newest first) |
| POST | `/api/receive` | Create a batch + RECEIPT movement |
| POST | `/api/sell` | FEFO consumption + SALE movements |
| POST | `/api/waste` | Write off a batch (spoilage) |

## Stack

- **Backend** — Node 22, Express, `better-sqlite3` (synchronous, embedded).
- **Frontend** — vanilla HTML/CSS/JS, no build step, mobile-first.
- **Data** — single SQLite file (`freshtrack.db`), created and seeded on first run.

## Layout

```
food-inventory/
├── docs/            UML class diagram, enums, design notes (+ rendered PNG)
├── public/          Single-page UI (index.html, styles.css, app.js)
└── src/
    ├── db.js        SQLite connection + schema
    ├── seed.js      Demo data
    └── server.js    Express API + batch-status / FEFO logic
```
