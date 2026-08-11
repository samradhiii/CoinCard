# Technical decisions

The choices that actually mattered, and why.

---

## 1. Server-side pagination, not client-side virtualization

**Decision:** The API does pagination, filtering, sorting and aggregation in PostgreSQL. The
browser receives 25 rows at a time.

**Why:** The brief said either was acceptable but asked me to be ready to explain the pick.

Virtualization solves *rendering* 10,000 rows. It doesn't solve fetching them, holding them in
memory, or sorting them in JavaScript — and it puts the browser one order of magnitude away from
falling over. Server-side pushes filtering and sorting to indexes built for it:

- Constant browser memory regardless of dataset size — 10k or 10M behaves the same.
- Aggregations run in one indexed pass instead of iterating 10,000 objects per keystroke.
- The markup stays a real `<table>`: accessible, Ctrl-F-able, screen-reader-navigable. A
  windowed list of `<div>`s is none of those.
- URLs are shareable, because page and filters are already in the query string.

**Cost:** every filter change is a network round trip. Mitigated with a 300ms search debounce
and `keepPreviousData`, so the table dims rather than flashing empty.

**When I'd switch:** an offline-first app, or a genuinely fixed small dataset.

---

## 2. URL as the single source of truth for view state

**Decision:** Filters, sort, and page live in the query string. `useFilterState` is the only
thing that writes them. No Redux/Zustand/Context store for view state.

**Why:** This is state the *user* owns, and it's exactly what a URL is for. The consequences
fall out for free rather than being built:

- Shareable, bookmarkable views.
- Back/forward works through filter changes.
- Refresh-safe.
- The table and the charts **cannot** drift out of sync, because both derive their query from
  the same parsed object.

The alternative — a store that must be mirrored into the URL — needs a sync effect in both
directions, which is where this class of bug lives.

**Details that mattered:**
- Navigations use `replace`, not `push`, except explicit page changes. Otherwise typing
  "amazon" pushes six history entries and back walks letter by letter.
- The search input is *locally* controlled and debounced into the URL. Binding it directly makes
  the caret jump on every keystroke.
- Every parsed value is whitelisted, so a hand-edited `?sort=nonsense` degrades to the default.

---

## 3. React Query for server state, and nothing else

**Decision:** TanStack Query owns caching, loading/error states, deduplication and the
optimistic redeem. No global client store at all.

**Why:** The clean split is *URL = what you're looking at, React Query = what the server said
about it*. Almost all the "state management" in a dashboard like this is really server-cache
management, and hand-rolling it means reimplementing request deduplication, cancellation and
stale-while-revalidate — badly.

The line that matters most for feel is `placeholderData: keepPreviousData`: while page 2 loads,
page 1 stays rendered and dims. Without it the table collapses to a skeleton on every page
click and the layout jumps.

Analytics queries deliberately key on filters *without* sort/page, so paging the table doesn't
refetch or re-animate the charts — paging doesn't change what they show.

---

## 4. Raw SQL over psycopg 3, not an ORM

**Decision:** Hand-written SQL in a repository layer.

**Why:** The interesting work here *is* the query shape — a window function that returns the
page and its total count in one round trip, `FILTER (WHERE …)` aggregates that compute spend,
refunds and failures in a single pass, `generate_series` to fill empty months,
`SELECT … FOR UPDATE` on redeem. Expressing those through an ORM means fighting it and then
dropping to raw SQL anyway, with the actual behaviour hidden behind a query builder.

An ORM earns its keep on large CRUD surfaces with lots of relationship traversal. This is four
read endpoints and one carefully-written transaction.

**Guardrail:** SQL lives *only* in `repositories/`. Every user value is a bound parameter;
`ORDER BY` maps an enum to a whitelist and never interpolates input.

---

## 5. One shared WHERE-clause builder for the table and the charts

**Decision:** `repositories/filters.py` builds the predicate once. Both `/api/transactions` and
`/api/analytics` accept identical filter params and pass them through it.

**Why:** This is what makes two-way cross-filtering *structurally* correct rather than a matter
of discipline. If the table and the charts each interpreted "category=Travel, Jan–Mar" in their
own code, they would eventually disagree, and the charts would quietly describe a different set
of rows than the table below them. Sharing the builder makes that class of bug impossible.

The one intentional divergence is explicit: aggregates pass `spend_only=True`, which forces out
refunds and the corrupt row, because "spend by category" means money going out.

---

## 6. Coin balance derived from an append-only ledger

**Decision:** `coin_ledger` is append-only; balance is `SUM(delta)`. There is no mutable
`users.coin_balance` column.

**Why:** A cached integer is one missed update away from being wrong, and once wrong there's no
way to tell what the right value was. A ledger makes the balance reconstructible, every coin
traceable to the transaction or redemption that moved it, and double-crediting preventable by
the database: a partial unique index enforces one `EARN` row per transaction, so re-running the
seed can't inflate the balance.

**Cost:** balance is an aggregate, not a lookup. At ~8,700 rows it's instant. At millions I'd
add a periodically-materialised snapshot plus a delta — but I'd still keep the ledger as truth.

---

## 7. Redeem: one transaction, a row lock, and an idempotency key

**Decision:** The whole redeem runs in one DB transaction. It locks the user row
(`SELECT … FOR UPDATE`), *then* reads the balance, then writes the redemption and the debit
together. Clients may send an idempotency key.

**Why:** This is the one place in the app where a bug costs the user money.

Without the lock, two concurrent redeems both read a 5,000-coin balance and both approve a
4,000-coin reward — the balance goes negative. Locking the user row serialises them, so the
second re-reads the ledger *after* the first commits and is correctly rejected. The balance is
read inside the lock and never trusted from the client.

The idempotency key handles the other failure: a request that timed out may well have succeeded.
Retrying with the same key returns the original redemption instead of charging twice — which is
what makes the UI's "Try again" button safe. Mutations also have `retry: false`, so React Query
never silently retries a POST on its own.

**Status codes:** `409` for an unaffordable redeem, not `400` — the payload is valid; it's the
*current server state* that makes it fail, and it would succeed after earning more. `404` for a
reward that doesn't exist, `409` for one that's inactive or sold out, `422` for a malformed body.

---

## 8. Optimistic UI with snapshot rollback

**Decision:** `useRedeem` debits the balance immediately in the cache, and on failure restores
the **snapshot taken before the mutation** — it does not add the cost back.

**Why:** Adding the cost back is the obvious implementation and it's wrong. If a background
refetch lands between the optimistic update and the failure, "add it back" produces a balance
that never existed. Restoring a snapshot cannot. `onSettled` then invalidates so the server
always gets the last word.

The dialog also stays *open* on failure and shows the reason, rather than closing and leaving
the user to work out what happened. The brief asked for exactly this: recover cleanly rather
than leaving the balance in a wrong state.

---

## 9. Normalised schema, not JSON-in-a-column

**Decision:** `categories` and `merchants` are lookup tables; `transactions` references them by
FK. Enums for status and payment method. Data-quality findings are persisted as typed boolean
columns, not recomputed per request.

**Why:** The brief was explicit about not dumping the JSON into one column, and a real schema
pays for itself here: the category filter is an indexed FK comparison, category colours live in
one place so the chart and the table badge can't disagree, and `merchants.default_category_id`
is what makes the 200-row category backfill possible.

The ingest flags (`is_refund`, `is_outlier`, `category_backfilled`,
`has_duplicate_external_id`, `source_ts_format`) are computed once at seed time. Deriving
`amount < 0` per request would be cheap; deriving "was this category inferred?" would be
impossible after the fact.

**Indexes** are shaped for the actual queries: composite `(occurred_at DESC, id DESC)` and
`(amount DESC, id DESC)` because the table always sorts by one of those with a stable
tiebreaker; a GIN trigram index on merchant names for `ILIKE` search; a partial index on the
non-refund, non-outlier subset that analytics always scan.

**One real constraint found:** `date_trunc('month', occurred_at)` on a `timestamptz` is only
`STABLE` — its result depends on the session timezone — so PostgreSQL refuses to index it.
Casting to `AT TIME ZONE 'UTC'` first makes it `IMMUTABLE` *and* makes month bucketing
independent of the server's timezone. The analytics query uses the identical expression so it
can actually use the index.

---

## 10. Surrogate primary key, because the source ID isn't unique

**Decision:** `transactions.id` is a `BIGSERIAL`. `external_id` is merely indexed.

**Why:** 40 source IDs appear twice with completely different payloads. Making `external_id` the
PK would either fail the seed on a unique violation or force dropping 40 real transactions.
Treating it as a natural key would have been the single easiest way to lose data in this
project.

---

## 11. CSS Modules with a two-layer token system, not Tailwind

**Decision:** Plain CSS in modules, on design tokens split into *primitive* (`--violet-500`,
`--space-4`) and *semantic* (`--accent`, `--surface-raised`) layers. Only the semantic layer is
re-pointed per theme.

**Why:** The brief said CSS craft is a primary evaluation criterion and asked for "design tokens
for colour, spacing and type" — so the CSS should be legible as CSS, not as utility strings.
Modules give scoping without a build-time abstraction, and the two-layer split means adding a
theme is remapping ~30 aliases rather than auditing every component.

Dark mode is not an inversion: surfaces get *lighter* as they rise, borders soften, and contrast
replaces shadow, because shadows barely read on dark backgrounds.

---

## 12. The table is hand-built; the modal is too

**Decision:** No component library anywhere — required for the table, chosen for everything else.

**Why (table):** required by the brief. It's semantic `<table>` markup with `<colgroup>` +
`table-layout: fixed` so columns don't jump between pages, a sticky header using
`box-shadow: inset` rather than `border-bottom` (borders on sticky cells detach in Safari), an
opaque `::before` backdrop so rows don't show through while scrolling under it, `aria-sort` on
sortable headers, and rows that respond to Enter/Space like buttons.

**Why (modal):** the brief called a hand-built one "a nice signal". It has a focus trap, focus
*restoration* to the trigger on close (the part most hand-rolled traps miss — without it,
closing the drawer dumps a keyboard user at the top of the document), Escape to close,
`role="dialog"` + `aria-modal`, portal rendering so no ancestor's `overflow` can clip it, and
scroll lock that compensates for the scrollbar width so the page doesn't jolt sideways.

One subtlety worth the code: overlay-click-to-close only fires if the pointer *went down* on the
overlay. Otherwise, selecting text inside the dialog and releasing outside closes it and throws
the user's work away.

**Charts** use Recharts — explicitly permitted, and hand-rolling SVG charts would have spent
time the brief wants on the table.

---

## 13. Tests target the money paths, not coverage

**Decision:** 58 tests, concentrated on the redeem endpoint and the dirty-data normalisers. No
frontend component tests.

**Why:** The brief said "even one meaningful test on the redeem endpoint counts". The redeem
tests run against a **real PostgreSQL instance**, because what needs proving is transactional
behaviour — `FOR UPDATE`, the ledger constraints, rollback on error. A mocked repository would
assert that functions get called in an order, which proves nothing about whether the balance can
go negative. Each test runs inside a rolled-back transaction, so the suite never mutates the
seeded data.

The normaliser tests are pure-function unit tests with no database — which is precisely why that
logic lives in `domain/` rather than inside the seed script. Each case is a real quirk found by
profiling, not a hypothetical.

---

## 14. Bulk load via `COPY`, and a seed that reports what it repaired

**Decision:** The seed uses `COPY … FROM STDIN` (~10× faster than 10,000 `INSERT`s; full run is
4.2 seconds), posts the coin ledger with one set-based `INSERT … SELECT`, and stores a JSONB
report of every repair in `ingest_runs`.

**Why:** The report is generated from the actual file rather than hardcoded, so it's a live
description of the data instead of a comment that rots. It's also served at
`/api/meta/data-quality`, which is what lets the UI be honest with the user about what was
cleaned rather than hiding it.
