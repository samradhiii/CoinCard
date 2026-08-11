# Assumptions

Product calls made where the brief left something open. Each one records what was ambiguous,
what I chose, and what I'd want to confirm with a product owner.

---

## Rewards

### 1. The per-transaction coin cap is 100 coins (₹10,000 of spend)

The brief says coins are "capped per transaction" but not at what. I set
`MAX_COINS_PER_TRANSACTION = 100`, in line with how Indian card reward programmes cap points
per swipe.

On this dataset the cap is not cosmetic — it's the difference between **616,129** coins and
**362,629**, and it bites on 1,620 transactions. A much higher cap would make the education and
insurance transactions (which run to ₹40,000+) dominate the entire balance.

It's a single constant in `backend/app/domain/coins.py`; changing it and re-seeding is a
one-line change.

### 2. Only `SUCCESS` payments earn coins

`FAILED` is obvious. `PENDING` is the judgement call: a pending payment might still fail, and
paying out coins that later need clawing back is worse than paying them slightly late. So
pending earns nothing, and would earn on settlement in a real system.

### 3. Refunds don't claw back coins

148 transactions have negative amounts. I treat them as refunds: they earn no coins, but they
also don't *remove* coins already earned on the original payment.

Rationale: the dataset gives no way to link a refund to the payment it reverses (no parent ID,
and amounts don't pair up cleanly), so any clawback would be guesswork. Punishing a user for a
refund the app can't trace is worse than being slightly generous. A real system would link them
and reverse the earn.

### 4. The corrupt ₹999,999,999 transaction earns nothing

Without this rule that single row mints 9,999,999 coins — roughly 27× the entire legitimate
balance — and the rewards feature becomes meaningless. It's flagged as an outlier at ingest and
excluded from earning.

### 5. Catalogue: six rewards, one deliberately unaffordable

The brief asks for four to six. I defined six, priced from 1,200 to 400,000 coins.

The most expensive (Annual Fee Waiver, 400,000) is **priced above the maximum balance this
dataset can produce**. That's intentional: it makes the `409 insufficient_balance` path — which
the brief explicitly asks the backend to handle — demonstrable in the live UI rather than only
in a test. One reward also carries finite stock (25) so the sold-out branch is real too.

### 6. Redemptions are instant and irreversible

Select → confirm → done, as specified. No pending state, no cancellation. The schema supports
reversal (`redemption_status.REVERSED`, `ledger_reason.REVERSAL`) but no UI exposes it.

---

## Dirty data

### 7. Nothing is discarded — rows are repaired and flagged

The single biggest product call. Every problematic row is kept, corrected where possible, and
marked. A financial app that silently deletes a user's transactions because a field was
malformed is worse than one that shows them with a caveat.

The app is visibly honest about this: a dismissible data-quality banner, per-row flags in the
table, explanatory notes in the detail drawer, and a `/api/meta/data-quality` endpoint.

### 8. Missing categories are inferred from the merchant

200 rows have no usable category (50 missing the key, 100 `null`, 50 empty string). Profiling
showed all 49 merchants map to **exactly one** category, so `Swiggy → Food & Dining` is
unambiguous rather than a guess.

Backfilled rows are marked `category_backfilled` and carry an "inferred" note in the drawer, so
the inference is visible rather than passed off as source data. Had a merchant spanned multiple
categories, the most frequent would win — and rows for a merchant that *never* carries a
category would be left as "Uncategorised" rather than invented.

### 9. Negative amounts are refunds, not data errors

They're all `SUCCESS`, spread evenly across categories, and plausibly sized. That reads as
refunds, not corruption. So: shown in the table (with a `+` and in green, since money came
back), excluded from spend totals and charts, earning no coins.

### 10. ₹999,999,999 is corruption, not a real payment

It's ~28,000× the 99th percentile (₹49,852) and the only value above ₹1,000,000 in the entire
dataset. The threshold is a constant (`OUTLIER_AMOUNT_THRESHOLD`), not a hardcoded match on
that value.

It's kept and shown — a user should be able to see the weird charge on their statement — but
excluded from analytics, because one row shouldn't flatten every chart to a single pixel. A
filter toggle lets you include it.

### 11. Duplicate transaction IDs are distinct transactions

40 source IDs appear twice with entirely different merchants, dates and amounts. They are
therefore two real transactions that happen to share a broken ID, **not** duplicates to
deduplicate.

So `external_id` is not the primary key — a surrogate `bigserial` is. Assuming otherwise would
either break the seed on a unique constraint or silently drop 40 real transactions. The detail
drawer surfaces the collision and links to the other row.

### 12. Slash-dates are day-first

`12/10/2025` is 12 October, not 10 December. Confirmed rather than assumed: the dataset contains
first-components up to 30, which cannot be months. Consistent with the INR/Indian-merchant
context.

### 13. Date-only timestamps are anchored to 00:00 UTC

715 rows have a date with no clock time. Midnight UTC keeps sort order deterministic; using
ingest time would make the same row sort differently on every seed.

### 14. All timestamps are stored as UTC

Sources arrive in five shapes, including `+05:30` offsets. Everything converts to UTC on the way
in and formats to the browser's locale on the way out. Monthly bucketing also pins to UTC
explicitly, so the trend chart doesn't shift with the server's timezone.

---

## Filtering and UI

### 15. Amount filters compare absolute value

A range of ₹500–₹2,000 matches a −₹700 refund. Users think of an amount range as "transactions
around this size", not "signed values in this interval". Debatable — flagged in the README's
known issues.

### 16. Date filters are inclusive of the whole end day

Picking `2026-03-31` includes everything that day, not just 00:00:00. The user picked a date,
not an instant.

### 17. Analytics measure *successful spend*

Charts and the spend total count `SUCCESS` payments with positive amounts, excluding the
outlier. Refunds, failures and pending amounts get their own stat tiles rather than being
silently folded into "spend".

### 18. Clicking an already-selected chart slice clears the filter

Chart clicks toggle. Whatever the chart does, the chart can undo — the user never has to hunt
for the filter chip to reverse a click.

### 19. Filter changes reset to page 1

Landing on "page 40 of 3" after narrowing a filter is a classic dashboard bug. Handled centrally
in `useFilterState` so no individual control can forget it.

### 20. Sort and page size are view preferences, not filters

"Clear all filters" keeps them. Only things that change *which rows match* are cleared.

### 21. Below 720px the table becomes a card list

A 7-column financial table can't be made readable at 360px by shrinking it. Payment method — the
least useful field on a phone — moves to the detail drawer.

---

## Scope

### 22. Single user, no authentication

The brief describes one consumer viewing *their own* spending, and building a login would have
consumed frontend time the brief explicitly wants spent elsewhere. The dataset has no user
dimension either.

There's a real `users` table and every route resolves the user through one dependency
(`get_current_user`), so swapping in a token check is a one-function change rather than a
refactor.

### 23. Transactions are read-only

No bill-payment flow. The brief scopes the build to the transactions / analytics / rewards core,
and the dataset is historical.

### 24. The dataset spans Jun 2025 – Jul 2026

14 months, partly in the future relative to a mid-2026 "today". I treated it as-is rather than
filtering to the past — it's clearly synthetic and the trend chart is more useful whole.

### 25. Default page size is 25

Comfortable on a laptop without scrolling; 50 and 100 are available. Combined with server-side
paging, the browser holds 25 rows regardless of dataset size.
