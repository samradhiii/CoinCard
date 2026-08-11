# CoinCard

A consumer app for paying credit-card bills, earning reward coins, and looking at your own
spending. Built for the Digital Alpha Full Stack Engineer take-home.

Next.js + TypeScript frontend, FastAPI backend, PostgreSQL 18. Pagination, filtering, sorting
and all chart aggregation happen **in the database** — the browser never receives more than one
page of rows.

---

## What it does

**Transactions** — all 10,000 rows in a hand-built table (no component library). Filter by
category, date range, amount range, status and payment method in any combination; search
merchants as you type; sort by date, amount or merchant. Clicking a row opens a detail drawer.

**Spend analytics** — a category donut and a monthly trend, both filter-aware. Cross-filtering
works **both ways**: click a chart slice and the table filters to it; filter the table any other
way and the charts recompute over the same predicate.

**Rewards** — 1 coin per ₹100 on successful payments, capped at 100 coins per transaction. The
balance is visible in the header on every screen. Six rewards, redeemed via select → confirm →
done, with an optimistic balance update that rolls back cleanly when the server refuses.

---

## The dataset is dirty, on purpose

Profiling all 10,000 rows before writing any code turned up this. Every item is handled at
ingest, and **nothing is dropped** — rows are repaired and flagged, because an app that quietly
deletes 200 of your transactions is worse than one that labels them.

| What's wrong | Rows | How it's handled |
|---|---:|---|
| `timestamp` in **five** different shapes | 10,000 | All normalised to UTC. ISO-Z (5,476), ISO+05:30 (1,961), epoch millis (1,007), `DD/MM/YYYY` (841), date-only (715) |
| `amount` arrives as a **string** (`"5065.00"`) | 20 | Coerced to `NUMERIC(14,2)` |
| `amount` is **negative** | 148 | Treated as refunds — shown in the table, excluded from spend, earn no coins |
| `amount` is `999999999.0` (~28,000× p99) | 1 | Kept and flagged, excluded from analytics so it can't flatten a chart |
| `category` missing / `null` / `""` | 200 | **Backfilled from the merchant** — all 49 merchants map 1:1 to a category |
| `status` is lowercase `'success'` | 25 | Normalised to the enum |
| **Duplicate transaction IDs** (different payloads) | 80 rows / 40 IDs | The source `id` is *not* the primary key. Surrogate key; collisions surfaced in the drawer |

That last one is the trap: `id` looks like a primary key and isn't. Making it one would have
either crashed the seed or silently lost 40 real transactions.

The app is upfront about all of this — there's a data-quality banner on the dashboard, per-row
flags in the table, and a `/api/meta/data-quality` endpoint reporting exactly what was repaired.

---

## Local setup

**Prerequisites:** Docker, or PostgreSQL 16+ running locally. Node 20+, Python 3.12+.

### With Docker (one command)

```bash
cp .env.example .env
docker compose up -d db                    # PostgreSQL 18 on :5433
docker compose run --rm seed               # schema + all 10,000 rows  ← the seed command
docker compose up -d api web               # API :8000, app :3000
```

Open <http://localhost:3000>.

### Without Docker

If Docker isn't available (this was the case on the machine it was built on — see
*Known issues*), point the app at any PostgreSQL 16+ instance.

```bash
# 1. Database — create an empty database, then:
cd backend
python -m venv .venv && .venv/Scripts/activate      # Windows
# python -m venv .venv && source .venv/bin/activate # macOS / Linux
pip install -r requirements-dev.txt

export DATABASE_URL="postgresql://coincard:coincard@localhost:5433/coincard"
python -m app.db.seed --file ../data/transactions.json --reset   # ← the seed command

# 2. API
python run.py            # http://localhost:8000  (docs at /docs)

# 3. Frontend — in a second terminal
cd frontend
npm install
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000" > .env.local
npm run dev              # http://localhost:3000
```

> **Windows note:** use `python run.py`, not the bare `uvicorn` CLI. psycopg's async driver
> cannot run on asyncio's `ProactorEventLoop` (the Windows default) and the connection pool
> silently times out. `run.py` supplies a selector loop. Linux and the Docker image are
> unaffected.

The seed is idempotent (`--reset` reloads from scratch) and prints a full report of what it had
to repair:

```
  Rows read .................... 10,000
  Rows loaded .................. 10,000
  Rows rejected ................ 0
  Merchants / categories ....... 49 / 10

  Timestamp formats normalised to UTC
    iso_utc        5,476
    iso_offset     1,961
    epoch_ms       1,007
    dmy_slash      841
    date_only      715

  Data repaired
    amounts coerced from string .. 20
    status case normalised ....... 25
    categories backfilled ........ 200  (missing key 50 / null 100 / empty 50)

  Data flagged (kept, excluded from spend analytics)
    refunds (negative amount) .... 148
    corrupt-magnitude outliers ... 1
    rows with duplicate id ....... 80 across 40 ids

  Rewards
    coins awarded ................ 362,629
    transactions hitting the cap . 1,620 (cap = 100 coins/txn)
    opening balance .............. 362,629 coins
```

### Tests

```bash
cd backend && python -m pytest        # 58 passed
```

Unit tests for the normalisers and coin maths need no database. The redeem tests run against a
real PostgreSQL instance inside a rolled-back transaction, so they never alter the seeded data
(they skip cleanly if the database isn't up).

---

## API

Interactive docs at `http://localhost:8000/docs`.

| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/api/transactions` | Server-side pagination, filtering, sorting |
| `GET` | `/api/transactions/{id}` | Detail + any rows sharing its source ID |
| `GET` | `/api/transactions/facets` | Filter options and bounds, derived from the data |
| `GET` | `/api/analytics` | Summary, category breakdown, monthly trend — same filter params |
| `GET` | `/api/rewards/balance` | Coin balance, summed from the ledger |
| `GET` | `/api/rewards/catalogue` | Rewards annotated with affordability |
| `POST` | `/api/rewards/redeem` | `201` · `404` unknown · `409` unaffordable/sold out · `422` malformed |
| `GET` | `/api/rewards/activity` | Coin ledger and redemption history |
| `GET` | `/api/meta/data-quality` | What the ingest repaired, and why |
| `GET` | `/health` | Liveness + database reachability |

Filter params are shared by `/api/transactions` and `/api/analytics` — which is what makes
two-way cross-filtering structurally correct rather than a matter of keeping two code paths in
sync:

```
?category=Travel&category=Shopping
&status=SUCCESS
&date_from=2026-01-01&date_to=2026-03-31
&amount_min=1000&amount_max=5000
&q=amazon
&sort=amount&order=desc&page=1&page_size=25
```

---

## Architecture

```
backend/app/
  api/routes/     HTTP only — parse, delegate, serialise
  services/       business rules; framework-free and unit-testable
  repositories/   SQL; the only layer that imports psycopg
  domain/         pure functions: normalisation, coin maths
  db/             schema.sql, seed.py, connection pool

frontend/src/
  app/            Next.js App Router, providers, dashboard composition
  components/ui/  design system: Button, Card, Badge, Input, Modal, Toast, states
  components/…    transactions, analytics, rewards
  hooks/          useFilterState (URL state), useQueries (server state), useFocusTrap
  lib/            typed API client, filter serialisation, formatting
  styles/         design tokens (primitive + semantic layers), global reset
```

A route never writes SQL; a service never imports FastAPI. The coin rules and the dirty-data
normalisers are pure functions in `domain/`, which is why they're tested without a database and
why the seed script and the API can't disagree about them.

**State**: the URL is the single source of truth for filters, sort and page; React Query owns
server state. Neither duplicates the other, so there is no "sync the store with the URL" effect
anywhere in the codebase. Views are shareable and the back button works.

See `DECISIONS.md` for the reasoning, `ASSUMPTIONS.md` for the product calls.

---

## Done / not done / known issues

### Done
- Transactions table on the full 10k rows — hand-built, no component library. Sticky header,
  sortable columns with `aria-sort`, hover/focus/loading/empty/error states, keyboard-operable
  rows, and a card layout below 720px that holds together at 360px.
- Combinable filters (category, date range, amount range, status, payment method), debounced
  merchant search, sorting by date/amount/merchant.
- Row click → detail drawer, including the transactions that share a duplicate source ID.
- **Both** charts — category donut and monthly trend — with **two-way** cross-filtering.
- Server-side pagination, filtering, sorting and aggregation.
- Rewards: always-visible balance, 6-item catalogue, select → confirm → done, optimistic balance
  update with snapshot rollback, backend rejecting invalid/unaffordable redeems with 404/409/422.
- Idempotency keys on redeem, so a retry after a timeout can't double-charge.
- PostgreSQL 18, normalised schema (not JSON-in-a-column), one-command seed.
- Hand-built modal: focus trap, focus restoration, Escape to close, scroll lock without layout
  shift, `role="dialog"` + `aria-modal`.
- Light and dark themes, applied before first paint (no flash).
- 58 tests.

### Not done
- **Not deployed.** Docker Desktop could not start on the build machine (no WSL distribution
  installed), so a hosted Postgres + Render/Vercel deploy wasn't set up within the time. Compose
  files and a production Dockerfile are included and the app runs end to end locally.
- No authentication. The brief describes one consumer looking at their own spending; a login
  would have consumed frontend time the brief explicitly wants spent elsewhere. Every route
  still resolves the user through a single dependency, so adding real auth is a one-function
  change rather than a refactor.
- No bill-payment flow — the brief scopes the build to the transactions/analytics/rewards core.
- No frontend component tests. Testing effort went to the redeem endpoint and the data
  normalisers, where correctness actually costs the user money.

### Known issues
- `next start` doesn't work with `output: "standalone"` in `next.config.ts` (that config exists
  for the Docker image). Use `npm run dev` locally, or `node .next/standalone/server.js` after a
  build.
- The rewards "Recent coin activity" list shows the most recent ledger entries, which right
  after seeding are all EARN rows in insertion order rather than date order.
- Amount filtering compares on absolute value, so a range of ₹500–₹2,000 also matches a −₹700
  refund. This is deliberate (see `ASSUMPTIONS.md`) but is a product call someone could
  reasonably disagree with.
- The category donut renders all 10 categories; with a much larger category set it would need
  an "Other" bucket.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), React 19, TypeScript (strict), CSS Modules + design tokens |
| Charts | Recharts |
| Server state | TanStack Query |
| Backend | FastAPI, Pydantic v2, psycopg 3 (raw SQL, no ORM) |
| Database | PostgreSQL 18 |
| Tests | pytest + pytest-asyncio |
