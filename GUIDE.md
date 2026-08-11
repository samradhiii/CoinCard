# CoinCard — Complete Guide

Everything needed to run the app and understand how it works, front to back.

**Contents**
1. [Running it](#1-running-it)
2. [High-level design](#2-high-level-design)
3. [Request lifecycles](#3-request-lifecycles-end-to-end)
4. [Backend — low-level design](#4-backend--low-level-design)
5. [Database — low-level design](#5-database--low-level-design)
6. [Frontend — low-level design](#6-frontend--low-level-design)
7. [Feature walkthroughs](#7-feature-walkthroughs)
8. [Troubleshooting](#8-troubleshooting)

---

# 1. Running it

## 1.1 Prerequisites

| Need | Version | Check |
|---|---|---|
| Node | 20+ | `node --version` |
| Python | 3.12+ | `python --version` |
| PostgreSQL | 16+ (18 preferred) | `psql --version` |

Docker is optional. If you have it, use §1.2. If not, §1.3 — which is how this build was
actually verified, because Docker Desktop couldn't start on the build machine (no WSL
distribution installed).

## 1.2 Path A — Docker

```bash
cp .env.example .env

docker compose up -d db          # PostgreSQL 18 on host port 5433
docker compose run --rm seed     # schema + 10,000 rows          ← THE SEED COMMAND
docker compose up -d api web     # API :8000, frontend :3000
```

Open <http://localhost:3000>. Stop with `docker compose down` (add `-v` to wipe the data).

## 1.3 Path B — no Docker

### Step 1 — PostgreSQL

Any PostgreSQL 16+ works. If you have none installed and don't want to install one system-wide,
portable binaries need no admin rights:

```powershell
# Windows — download from https://www.enterprisedb.com/download-postgresql-binaries
# Extract, then:
C:\pg18\pgsql\bin\initdb.exe -D C:\pg18\data -U coincard --pwfile=pw.txt -E UTF8 --locale=C
C:\pg18\pgsql\bin\pg_ctl.exe -D C:\pg18\data -o "-p 5433" -l C:\pg18\server.log start
C:\pg18\pgsql\bin\psql.exe -h localhost -p 5433 -U coincard -d postgres -c "CREATE DATABASE coincard;"
```

```bash
# macOS / Linux with an existing server
createdb coincard
```

### Step 2 — Backend

```bash
cd backend
python -m venv .venv

.venv\Scripts\activate            # Windows
source .venv/bin/activate         # macOS / Linux

pip install -r requirements-dev.txt
```

Set the connection string:

```powershell
$env:DATABASE_URL = "postgresql://coincard:coincard@localhost:5433/coincard"   # PowerShell
```
```bash
export DATABASE_URL="postgresql://coincard:coincard@localhost:5433/coincard"    # bash
```

Seed, then run:

```bash
python -m app.db.seed --file ../data/transactions.json --reset   # ← THE SEED COMMAND
python run.py                                                    # http://localhost:8000
```

> **Use `python run.py`, not `uvicorn app.main:app`.** On Windows, psycopg's async driver cannot
> run on asyncio's `ProactorEventLoop` (the platform default) and the connection pool times out
> on startup with no useful error. `run.py` supplies a selector loop. On Linux either works.

Verify: <http://localhost:8000/health> → `{"status":"ok","database":"connected",...}`
Interactive API docs: <http://localhost:8000/docs>

### Step 3 — Frontend

In a **second terminal**:

```bash
cd frontend
npm install
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000" > .env.local
npm run dev                        # http://localhost:3000
```

> `next.config.ts` sets `output: "standalone"` for the Docker image, which **breaks
> `next start`**. Use `npm run dev` locally, or `node .next/standalone/server.js` after
> `npm run build`.

## 1.4 Everyday commands

| What | Where | Command |
|---|---|---|
| Reload the database from scratch | `backend/` | `python -m app.db.seed --file ../data/transactions.json --reset` |
| Run tests | `backend/` | `python -m pytest` |
| Typecheck | `frontend/` | `npm run typecheck` |
| Production build | `frontend/` | `npm run build` |

## 1.5 Ports

| Service | Port | Why |
|---|---|---|
| PostgreSQL | **5433** | Not 5432, so it can't collide with an existing local Postgres |
| API | 8000 | |
| Frontend | 3000 | |

---

# 2. High-level design

## 2.1 The shape of it

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                             │
│                                                                      │
│   URL  ?category=Travel&status=SUCCESS&sort=amount&page=2            │
│    │        the single source of truth for "what am I looking at"    │
│    ▼                                                                 │
│   useFilterState ──────────────┬──────────────────┐                 │
│                                │                  │                  │
│                         useTransactions     useAnalytics             │
│                          (React Query)      (React Query)            │
│                                │                  │                  │
│                    ┌───────────┴──────┐    ┌──────┴──────┐          │
│                    │ TransactionTable │    │   Charts    │          │
│                    │  (hand-built)    │◄──►│  (Recharts) │          │
│                    └──────────────────┘    └─────────────┘          │
│                          two-way cross-filtering                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  HTTP · JSON
┌──────────────────────────────▼───────────────────────────────────────┐
│  FASTAPI                                                             │
│                                                                      │
│   api/routes/    parse query params → delegate → serialise           │
│        │         (never writes SQL)                                  │
│   services/      business rules, framework-free                      │
│        │         (never imports FastAPI)                             │
│   repositories/  SQL — the only layer that knows psycopg exists      │
│        │              └── filters.py: ONE shared WHERE builder       │
│   domain/        pure functions: normalise.py, coins.py              │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  psycopg 3 pool · session pinned to UTC
┌──────────────────────────────▼───────────────────────────────────────┐
│  POSTGRESQL 18                                                       │
│   users · categories · merchants · transactions                      │
│   rewards · redemptions · coin_ledger (append-only) · ingest_runs    │
└──────────────────────────────────────────────────────────────────────┘
```

## 2.2 Four ideas that shape everything

**1. The database does the work.** Pagination, filtering, sorting and every aggregation run in
PostgreSQL. The browser never holds more than one page (25 rows) regardless of dataset size.

**2. The URL is the state.** Filters, sort and page live in the query string. Nothing else
stores them. That makes views shareable, the back button correct, and — critically — makes it
*impossible* for the table and the charts to disagree, because both derive their query from the
same parsed object.

**3. One WHERE builder, shared.** `repositories/filters.py` translates a filter set into SQL
once. `/api/transactions` and `/api/analytics` both use it. Two-way cross-filtering is therefore
structurally correct rather than a matter of keeping two code paths in sync.

**4. Money is a ledger, not a number.** The coin balance is `SUM(delta)` over an append-only
table. There is no mutable balance column to get out of sync.

## 2.3 Layering rule

```
routes → services → repositories → domain
```

Each layer may only call the one to its right. A route never writes SQL. A service never imports
FastAPI — which is why the redeem logic is testable without an HTTP client, and why the coin
rules can't drift between the seed script and the API.

---

# 3. Request lifecycles, end to end

## 3.1 User types "amaz" in the search box

```
1. keystroke → setSearchInput("amaz")           local state, instant, caret stable
2. useDebounce waits 300ms                      no network yet
3. setFilters({ search: "amaz" })               → useFilterState
4. router.replace("/?q=amaz")                   replace, not push (no history spam)
5. searchParams changes → parseFilters()        new FilterState object
6. React Query key changes → two fetches fire in parallel:
      GET /api/transactions?q=amaz&sort=date&order=desc&page=1&page_size=25
      GET /api/analytics?q=amaz
7. FastAPI: parse_filters() → TransactionFilters
8. build_where() → "WHERE m.name ILIKE %(search)s"     bound param, never interpolated
9. Postgres: GIN trigram index on merchants.name
10. One statement returns the page AND the total:
      SELECT ..., COUNT(*) OVER () AS total_count ... LIMIT 25 OFFSET 0
11. Response → keepPreviousData means old rows stay visible, dimmed
12. Table and charts update together — same filter, same predicate
```

**Why the debounce lives in the component, not the URL:** binding the input straight to the URL
means a router navigation per keystroke — the caret jumps, typing feels laggy, and history fills
with one entry per letter.

## 3.2 User clicks the "Travel" slice of the donut

```
1. Recharts onClick → onSelect("Travel")
2. selectOnly("categories", "Travel")
     if already the only selection → clear it   (the chart can undo itself)
3. URL becomes /?category=Travel
4. BOTH queries re-run with the same filter:
      table    → only Travel rows
      analytics→ donut now shows one slice, trend reshapes to Travel only
5. An "Active: Category: Travel" chip appears, removable
```

That step 4 is the whole point of the shared WHERE builder: chart→table and table→chart are the
same mechanism, not two features.

## 3.3 User redeems a reward — the careful path

```
CLIENT                                    SERVER
──────                                    ──────
click Redeem
  └→ dialog opens, mints an
     idempotency key (uuid)
click Confirm
  └→ useRedeem.onMutate:
       cancel in-flight queries
       SNAPSHOT balance + catalogue      ← the key move
       optimistically debit balance
       recompute affordability
     balance drops instantly
                                          POST /api/rewards/redeem
                                            ↓
                                          BEGIN                    ← one transaction
                                            SELECT … FROM users
                                              WHERE id=$1 FOR UPDATE    ← serialise
                                            SELECT reward             404 if missing
                                                                      409 if inactive/sold out
                                            balance = SUM(ledger)     ← read INSIDE the lock
                                            if balance < cost → 409   ← client figure ignored
                                            INSERT redemption
                                            INSERT ledger (-cost)
                                          COMMIT
                                            ↓
  ┌───────────────┴────────────────┐
SUCCESS                          FAILURE
  show code, toast                 RESTORE THE SNAPSHOT   ← not "add the cost back"
                                   dialog stays OPEN with the reason
                                   toast: "balance unchanged"
  └────────────────┬───────────────┘
     onSettled → invalidate balance/catalogue/activity
     the server always gets the last word
```

**Why a snapshot instead of adding the cost back:** if a background refetch lands between the
optimistic update and the failure, "add it back" produces a balance that never existed.
Restoring a snapshot cannot.

**Why the lock:** without it, two concurrent redeems both read a 5,000-coin balance and both
approve a 4,000-coin reward — the balance goes negative. The lock makes the second request
re-read the ledger *after* the first commits.

**Why the idempotency key:** a request that timed out may have succeeded. Retrying with the same
key returns the original redemption instead of charging twice. This is what makes the dialog's
"Try again" button safe.

## 3.4 Seeding — the dirty-data pipeline

```
transactions.json  (10,000 rows, deliberately messy)
        │
        ▼
  json.loads
        │
        ▼  normalize_row()  ─ per row, pure functions
        ├── parse_timestamp   5 formats → aware UTC datetime  (+ records which)
        ├── parse_amount      str/float → Decimal(14,2), ROUND_HALF_UP
        ├── parse_status      'success' → 'SUCCESS'
        ├── parse_method      alias table → enum
        └── flags             is_refund (amount<0), is_outlier (≥₹1,000,000)
        │
        ▼  cross-row passes — need all rows in hand
        ├── build_merchant_category_map()   49 merchants → 1 category each
        ├── backfill_categories()           200 empty categories filled + flagged
        └── flag_duplicate_external_ids()   40 ids → 80 rows flagged, none dropped
        │
        ▼  award_coins()      coins_for_transaction() per row
        │
        ▼  write
        ├── DROP + CREATE schema        (--reset)
        ├── upsert categories, merchants
        ├── COPY transactions FROM STDIN     ~10× faster than 10k INSERTs
        ├── seed user + 6 rewards
        ├── INSERT INTO coin_ledger SELECT … WHERE coins_earned > 0   (set-based)
        │      ON CONFLICT DO NOTHING — partial unique index prevents double-credit
        └── INSERT ingest_runs (JSONB report)
        │
        ▼  print report — generated from the file, never hardcoded

Whole run: 4.2 seconds.
```

---

# 4. Backend — low-level design

## 4.1 File map

```
backend/
├── run.py                        dev entrypoint (Windows selector-loop fix)
├── Dockerfile                    build context = repo root, so data/ can be baked in
├── pytest.ini
└── app/
    ├── main.py                   app factory, CORS, DomainError → HTTP handler, /health
    ├── core/
    │   ├── config.py             env-backed Settings, cached
    │   └── errors.py             DomainError hierarchy → status codes
    ├── db/
    │   ├── pool.py               async pool + sync helper, session pinned to UTC
    │   ├── schema.sql            the entire schema
    │   └── seed.py               one-command seed
    ├── domain/                   pure — no DB, no framework
    │   ├── normalize.py          the 5 timestamp formats, amounts, statuses, backfill
    │   └── coins.py              earning rules and the per-transaction cap
    ├── repositories/             SQL only
    │   ├── filters.py            ★ the shared WHERE builder
    │   ├── transactions.py       list/detail/facets/data-quality
    │   ├── analytics.py          summary, by-category, by-month, top merchants
    │   └── rewards.py            ledger, catalogue, redemptions
    ├── services/                 business rules
    │   ├── transactions.py       pagination maths, validation
    │   ├── analytics.py          assembles the chart payload
    │   └── rewards.py            ★ the redeem transaction
    ├── schemas/                  Pydantic request/response models
    └── api/
        ├── deps.py               connections, current user, query-param parsing
        └── routes/               transactions, analytics, rewards, meta
```

★ = the two files worth reading first.

## 4.2 Error handling

Services raise domain errors; one handler in `main.py` maps them to HTTP. Business logic never
imports FastAPI.

| Exception | Status | Code | When |
|---|---|---|---|
| `NotFoundError` | 404 | `not_found` | Reward or transaction doesn't exist |
| `InsufficientBalanceError` | 409 | `insufficient_balance` | Can't afford it |
| `RewardUnavailableError` | 409 | `reward_unavailable` | Inactive or sold out |
| `ValidationError` | 422 | `validation_error` | Semantically invalid input |

**Why 409 and not 400 for an unaffordable redeem:** the payload is perfectly valid. It's the
*current server state* — the balance — that makes it fail, and the identical request would
succeed after earning more coins. That's a conflict, not a malformed request.

Every error body has the same shape, so the frontend can branch on `code`:

```json
{ "error": {
    "code": "insufficient_balance",
    "message": "You need 42,371 more coins to redeem Annual Fee Waiver + Lounge Pack.",
    "details": { "balance": 357629, "required": 400000, "shortfall": 42371 } } }
```

## 4.3 The shared WHERE builder

`repositories/filters.py` is ~90 lines and is the backbone of the whole design.

```python
def build_where(filters, *, alias="t", spend_only=False) -> tuple[str, dict]:
    ...
    return "WHERE " + "\n  AND ".join(clauses), params
```

- Every value is a **bound parameter**. Nothing is interpolated.
- `ORDER BY` maps an enum to a **whitelist** — user input never reaches it.
- Every sort carries `, t.id <dir>` as a tiebreaker, so pagination can't repeat or skip a row
  when two transactions share a timestamp or amount.
- `spend_only=True` is the one intentional divergence: analytics force-exclude refunds and the
  corrupt row, because "spend by category" means money going out.

## 4.4 Two SQL techniques worth pointing at

**Page and total in one round trip:**

```sql
SELECT ..., COUNT(*) OVER () AS total_count
FROM transactions t JOIN merchants m ... LEFT JOIN categories c ...
WHERE ...
ORDER BY t.occurred_at DESC, t.id DESC
LIMIT 25 OFFSET 50
```

The window function counts the *whole filtered set* while returning only the page. One query
instead of two, and the page and its total always describe the same snapshot.

**Every KPI in one pass:**

```sql
SELECT COUNT(*)                                             AS txn_count,
       SUM(amount) FILTER (WHERE NOT is_refund
                             AND NOT is_outlier
                             AND status='SUCCESS')          AS total_spend,
       ABS(SUM(amount)) FILTER (WHERE is_refund)            AS total_refunded,
       COUNT(*) FILTER (WHERE status='FAILED')              AS failed_count
FROM ...
```

`FILTER (WHERE …)` computes four differently-scoped aggregates in a single scan instead of four
round trips.

## 4.5 The UTC session pin — a bug worth knowing about

`db/pool.py` opens every connection with `options="-c timezone=UTC"`.

This is a correctness requirement, not a preference. A bare date in a filter
(`date_from=2026-03-01`) is cast to `timestamptz` using the **session** timezone, while the
monthly-trend query buckets with `AT TIME ZONE 'UTC'` (it has to — see §5.4). On a machine
running IST those disagreed by 5.5 hours, so *"all of March"* returned rows that bucketed into
February. Worse, the same request would have returned different results on a developer's laptop
and on a UTC production server.

Caught by an end-to-end check asserting that a single-month filter yields exactly one month in
the trend. It returned two.

---

# 5. Database — low-level design

## 5.1 Entity relationships

```
   categories ◄──────── merchants
        ▲                   ▲
        │ category_id       │ merchant_id
        │                   │
        └──────── transactions ────────► coin_ledger  (delta, reason=EARN)
                                              ▲
   users ─────────────────────────────────────┤
     │                                        │
     └──────► redemptions ────────────────────┘  (delta, reason=REDEEM)
                   │
                   ▼
               rewards
```

## 5.2 Tables

| Table | Purpose | Notable |
|---|---|---|
| `users` | Single demo user | Exists so redeem can take a real row lock |
| `categories` | 10 lookup rows | Carries the colour token, so chart and badge always match |
| `merchants` | 49 lookup rows | `default_category_id` is what powers the 200-row backfill |
| `transactions` | 10,000 rows | Surrogate PK; ingest flags stored as typed columns |
| `rewards` | 6 catalogue rows | `stock` NULL = unlimited |
| `redemptions` | Redemption records | `coin_cost` copied, not joined; unique idempotency key |
| `coin_ledger` | **Append-only** | Balance = `SUM(delta)`. Never UPDATE |
| `ingest_runs` | Seed audit | JSONB report served at `/api/meta/data-quality` |

## 5.3 Three schema decisions that mattered

**Surrogate primary key.** `transactions.id` is a `BIGSERIAL`; `external_id` is merely indexed.
40 source IDs appear twice with completely different payloads. Making `external_id` the PK would
either fail the seed on a unique violation or force dropping 40 real transactions — the single
easiest way to lose data in this project.

**Ingest flags are columns, not runtime derivations.** `is_refund`, `is_outlier`,
`category_backfilled`, `has_duplicate_external_id`, `source_ts_format` are computed once at
seed. Deriving `amount < 0` per request would be cheap; deriving *"was this category
inferred?"* would be impossible after the fact.

**Ledger, not a balance column.** A cached integer is one missed update away from being wrong,
with no way to recover the correct value. A partial unique index —
`UNIQUE (transaction_id) WHERE reason='EARN'` — means re-running the seed cannot double-credit
the user. The database enforces it, not the script's good behaviour.

## 5.4 Indexes

| Index | Shape | Serves |
|---|---|---|
| `idx_txn_occurred_at` | `(occurred_at DESC, id DESC)` | Default sort + stable paging |
| `idx_txn_amount` | `(amount DESC, id DESC)` | Sort by amount |
| `idx_txn_month` | `date_trunc('month', occurred_at AT TIME ZONE 'UTC')` | Monthly trend |
| `idx_merchants_name_trgm` | GIN trigram | `ILIKE` merchant search |
| `idx_txn_clean_spend` | Partial: `WHERE NOT is_refund AND NOT is_outlier` | Analytics scans |
| `idx_txn_status`, `_category`, `_merchant` | B-tree | Filters |

**The `AT TIME ZONE 'UTC'` on the month index is mandatory.** `date_trunc` over a `timestamptz`
is only `STABLE` — its result depends on the session `TimeZone` — and PostgreSQL refuses to
index a non-`IMMUTABLE` expression:

```
psycopg.errors.InvalidObjectDefinition: functions in index expression must be marked IMMUTABLE
```

Casting to a plain UTC timestamp first makes it `IMMUTABLE`. The analytics query uses the
*identical* expression — otherwise the index exists and is silently never used.

## 5.5 Measured performance (full 10,000 rows)

| Query | Time |
|---|---:|
| Transactions page 1 | 95 ms |
| Transactions page 200 | 94 ms |
| Sort by amount | 71 ms |
| Search + 3 filters | 34 ms |
| Analytics, unfiltered | 260 ms |
| Analytics, filtered | 275 ms |
| Facets | 76 ms |
| **Full seed** | **4.2 s** |

Page 200 costing the same as page 1 is the point: `OFFSET` stays cheap because the sort is
index-backed.

---

# 6. Frontend — low-level design

## 6.1 File map

```
frontend/src/
├── app/
│   ├── layout.tsx            blocking inline script applies the theme pre-paint
│   ├── providers.tsx         QueryClient (per-mount) + ToastProvider
│   ├── page.tsx              Suspense boundary (required by useSearchParams)
│   └── Dashboard.tsx         top-level composition
├── components/
│   ├── ui/                   Button · Card · Badge · Field · Modal · Toast · States
│   ├── transactions/         TransactionTable · FilterBar · TransactionDrawer
│   ├── analytics/            StatTiles · CategoryDonut · MonthlyTrend
│   ├── rewards/              CoinBalance · RewardGrid · RedeemDialog
│   └── layout/               AppShell
├── hooks/
│   ├── useFilterState.ts     ★ URL ↔ filters; the only writer
│   ├── useQueries.ts         ★ React Query hooks incl. optimistic redeem
│   ├── useFocusTrap.ts       focus trap + scroll lock for the hand-built modal
│   ├── useDebounce.ts        search-as-you-type
│   ├── useMounted.ts         SSR-safe portals
│   └── useTheme.ts
├── lib/
│   ├── api.ts                typed client, ApiError with .code
│   ├── types.ts              mirrors the API contract
│   ├── filters.ts            FilterState ↔ URLSearchParams ↔ API params
│   └── format.ts             ★ all money/date formatting, in one place
└── styles/
    ├── tokens.css            ★ primitive + semantic token layers
    └── globals.css           reset, focus policy, utilities
```

## 6.2 State model

| State | Lives in | Why |
|---|---|---|
| Filters, sort, page | **The URL** | Shareable, back-button-correct, refresh-safe, single source |
| Server data | **React Query** | Caching, dedup, loading/error, optimistic updates |
| Open drawer / dialog / tab | `useState` in `Dashboard` | Genuinely ephemeral |
| Search input text | `useState` in `FilterBar` | Must stay instant; debounced into the URL |
| Theme | `<html data-theme>` + localStorage | Applied before first paint |

There is no global client store, and therefore **no effect anywhere that syncs a store with the
URL** — which is where this class of bug normally lives.

## 6.3 The design token system

Two layers, in `styles/tokens.css`:

```css
/* 1. PRIMITIVES — the raw scale, theme-agnostic */
--violet-500: #6D5EF7;   --gold-500: #F0B429;
--space-4: 1rem;         --text-sm: 0.8125rem;   --radius-md: 10px;

/* 2. SEMANTIC — what components actually use */
--accent: var(--violet-500);
--surface-raised: var(--neutral-0);
--coin: var(--gold-600);
```

Components reference **only** the semantic layer. No component file contains a raw hex or a
magic pixel value. Adding a theme means remapping ~30 aliases, not auditing every component.

Dark mode is not an inversion: surfaces get *lighter* as they rise, borders soften, and contrast
replaces shadow — shadows barely read on dark backgrounds.

## 6.4 The hand-built table — the details that matter

Requirement | Implementation
---|---
Semantic markup | Real `<table>`/`<thead>`/`<tbody>`, `<caption class="srOnly">`, `scope="col"`
Stable columns | `<colgroup>` + `table-layout: fixed` — columns don't jump between pages
Sticky header | `position: sticky` + **`box-shadow: inset 0 -1px 0`**, not `border-bottom` — borders on sticky cells detach in Safari
Header opacity | A `::before` painting `--surface` — sticky cells are transparent, so rows would otherwise show through while scrolling under them
Sort a11y | `aria-sort="ascending\|descending\|none"` on `<th>`, plus `srOnly` text explaining what activation does
Row interaction | `tabIndex={0}`, `role="button"`, Enter/Space handled — a clickable row must behave like a button
Focus ring | `box-shadow: inset` on the cells — `overflow: hidden` would clip a real outline
Money alignment | `font-variant-numeric: tabular-nums` — non-negotiable in a financial table
Loading | Skeleton rows on first load; on refetch the old page **dims** (`keepPreviousData`) with an indeterminate progress bar
Empty | Distinguishes "no results for these filters" (offers *Clear all*) from "no data at all"
Error | Detects a dead API specifically and names the command to fix it
Row perf | `memo` on the row — without it every keystroke re-renders all 25 rows and their badges
≤720px | Becomes a **card list** via CSS grid. A 7-column financial table can't be shrunk into 360px; payment method moves to the drawer

## 6.5 The hand-built modal

`Modal.tsx` + `useFocusTrap.ts`:

- `role="dialog"`, `aria-modal="true"`, labelled by its own title
- Focus moves in on open, **and is restored to the trigger on close** — the part most hand-rolled
  traps miss. Without it, closing the drawer dumps a keyboard user at the top of the document
  instead of back on the row they came from.
- Tab/Shift+Tab cycle inside; a `focusin` listener pulls focus back if it escapes
- Escape closes — *suppressed while a redeem is in flight*, so the user must see the outcome
- Scroll lock compensates for the scrollbar width, so the page doesn't jolt sideways
- Portalled to `<body>`, gated on `useMounted()` so the portal can't cause a hydration mismatch
- **Overlay click closes only if the pointer went *down* on the overlay.** Otherwise, selecting
  text inside the dialog and releasing outside closes it and throws the user's work away.

## 6.6 Optimistic redeem, precisely

```ts
onMutate: async ({ coinCost }) => {
  await cancelQueries(balance); await cancelQueries(catalogue);
  const previousBalance   = getQueryData(balance);      // SNAPSHOT
  const previousCatalogue = getQueryData(catalogue);
  setQueryData(balance,   b => ({ ...b, balance: b.balance - coinCost }));
  setQueryData(catalogue, c => recomputeAffordability(c, c.balance - coinCost));
  return { previousBalance, previousCatalogue };
},
onError: (_e, _v, ctx) => {
  setQueryData(balance,   ctx.previousBalance);         // RESTORE, don't add back
  setQueryData(catalogue, ctx.previousCatalogue);
},
onSettled: () => invalidate(balance, catalogue, activity),
```

The catalogue is updated too, so every *other* card's affordability greys out immediately rather
than after the refetch.

---

# 7. Feature walkthroughs

## 7.1 Transactions dashboard

| Capability | How |
|---|---|
| 10,000 rows, smooth | Server-side paging; browser holds 25 |
| Filter by category | Multi-select chips → `?category=A&category=B` |
| Filter by date range | Two date inputs, bounded by real data min/max from `/facets` |
| Filter by amount range | Compared on **absolute value**, so a range matches refunds too |
| Filter by status / method | Multi-select chips |
| Combinable | All of the above AND together in one WHERE |
| Search merchants | 300 ms debounce → `ILIKE` on a GIN trigram index |
| Sort | Date, amount, merchant; click to flip; `id` tiebreaker keeps paging stable |
| Row detail | Right-hand drawer, painted instantly from the row already in hand |
| Active filters | Removable chips; "Clear all" keeps sort and page size |

## 7.2 Spend analytics

- **Category donut** — click a slice or a legend row to filter. The legend is real `<button>`s,
  which makes every slice keyboard-reachable; an SVG `<path>` is not.
- **Monthly trend** — click a month to set the date range to that month. Empty months are
  plotted (via `generate_series`), so a filtered range shows a real gap rather than silently
  joining across it.
- **Two-way** — filter the table any way at all and both charts recompute server-side over the
  same predicate.
- Clicking an already-selected slice or month **clears** it. The chart can always undo itself.
- Charts key on filters *without* sort/page, so paging the table doesn't re-animate them.

## 7.3 Rewards

| Rule | Value |
|---|---|
| Earning rate | 1 coin per ₹100 |
| Per-transaction cap | 100 coins (₹10,000 of spend) |
| Eligible | `SUCCESS` only |
| Refunds | Earn nothing; no clawback (can't be linked to their original) |
| Corrupt outlier | Earns nothing — it would otherwise mint 9,999,999 coins |
| Opening balance | **362,629 coins**, from 8,651 earning transactions; the cap bites on 1,620 |

Balance is visible in the header on every screen and every breakpoint. Six rewards, 1,200 →
400,000 coins. The most expensive is **deliberately priced above any achievable balance** so the
`409 insufficient_balance` path is demonstrable in the live UI; one has finite stock so the
sold-out branch is real too.

## 7.4 Data-quality surfacing

The app never pretends the data was clean:

- Dismissible banner on the dashboard with live counts
- Per-row flags: inferred category (ⓘ), corrupt amount (⚠), refunds shown `+` and green
- Detail drawer explains *this row's* issues and names the source timestamp format
- Duplicate-ID rows link to the other transaction sharing that ID
- Filter toggles to hide refunds or outliers
- `/api/meta/data-quality` returns the full ingest report

---

# 8. Troubleshooting

**API startup hangs, then `PoolTimeout` (Windows)**
You ran `uvicorn app.main:app`. Use `python run.py` — psycopg's async driver can't run on the
Proactor event loop.

**`Can't reach the server. Is the API running?` in the UI**
Backend isn't up, or `NEXT_PUBLIC_API_BASE_URL` is wrong. Check <http://localhost:8000/health>.
That variable is inlined at **build** time — change it and restart the dev server.

**`Demo user not found. Has the database been seeded?`**
Run the seed command.

**Seed: `transactions table already has rows`**
Intentional guard against double-loading. Add `--reset`.

**Seed: `functions in index expression must be marked IMMUTABLE`**
You're on a modified `schema.sql`. The month index needs `AT TIME ZONE 'UTC'` — see §5.4.

**`next start` serves a broken page**
`output: "standalone"` is set for Docker. Use `npm run dev`, or
`node .next/standalone/server.js`.

**Hydration mismatch on the toast viewport**
Portals must not render on the first pass. Gate on `useMounted()` — see §6.5.

**Tests all skip**
They skip cleanly when PostgreSQL is unreachable or unseeded. Set `DATABASE_URL` and seed first.

**Port 5433 already in use**
Change `POSTGRES_PORT` in `.env` and the port in `DATABASE_URL`.
