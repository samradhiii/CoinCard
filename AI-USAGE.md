# AI usage

## Summary

I built CoinCard myself — architecture, product calls, data modelling, and the features the
brief asked for. AI was a **helper**, not the author. I used it the way I'd use a search engine
or a junior pair: to speed up repetitive work, unblock on syntax, and get a first draft to react
to. Every suggestion was read, often changed, and always run locally before it stayed.

If something mattered — how dirty data is handled, how coins are earned, how filters stay in sync
between the table and charts, how redeem avoids double-charging — I decided that first and
implemented (or corrected) it myself. AI did not design the app; it occasionally suggested code I
then had to fix or throw away.

---

## Tools I used

| Tool | How I used it |
|---|---|
| **Claude (via Claude Code / Cursor)** | Drafting boilerplate, exploring SQL shapes, first passes on docs, sanity-checking ideas |
| **Cursor Composer** | Occasional help with local setup commands and repo housekeeping (e.g. `.gitignore`, push) |

I did **not** paste a prompt and ship the output. The workflow was: decide → implement or sketch →
ask AI for a draft where it saves time → edit → run tests / hit the API / click through the UI →
keep or discard.

---

## Where AI helped (and where it stopped)

**Helpful — I kept the idea, often rewrote the code**

- **Boilerplate.** Pydantic schemas, repetitive repository queries, CSS token scaffolding. Tedious
  to type; fine to draft with AI and then align to my naming and layering rules.
- **SQL starting points.** Patterns like `COUNT(*) OVER ()` for page + total, `FILTER (WHERE …)`
  aggregates, `generate_series` for empty months. I chose the approach; AI helped with the first
  syntax pass.
- **Docs structure.** README / DECISIONS outlines. I rewrote most of it — the AI drafts explained
  *what* but rarely *why*, which is the part that actually matters.

**Mostly mine — AI input was minimal or rejected**

- **Dataset profiling and schema.** I profiled all 10,000 rows first (timestamp shapes, duplicate
  IDs, missing categories). The surrogate primary key, merchant→category backfill, and ingest
  flags came from that analysis, not from a model suggestion.
- **Architecture.** Routes → services → repositories → domain; URL as filter state; one shared
  WHERE builder for table + analytics; append-only coin ledger. I rejected AI's first idea of a
  cached `users.coin_balance` column — a mutable balance is one bug away from being unrecoverable.
- **Product behaviour.** Two-way chart cross-filtering, optimistic redeem with snapshot rollback,
  409 for unaffordable redeems, amount filter on absolute value. These are deliberate calls
  documented in `DECISIONS.md` and `ASSUMPTIONS.md`.
- **UI craft.** Hand-built table, modal focus trap, responsive card layout, theme tokens. AI
  drafts were starting points; layout, accessibility, and polish were done by hand after trying
  them in the browser.

---

## Real examples where I threw away or fixed AI output

These are genuine cases where I did **not** accept the suggestion as-is.

### 1. PostgreSQL index the model proposed — and I had to finish the job

AI suggested:

```sql
CREATE INDEX idx_txn_month ON transactions (date_trunc('month', occurred_at));
```

PostgreSQL rejected it (`functions in index expression must be marked IMMUTABLE`). I fixed the
index to cast through UTC, then **also** updated the analytics query to use the identical
expression — otherwise the index exists and is never used. The model gave half a fix; making it
correct was on me.

### 2. Windows async startup — wrong remedy for my Python version

Pool timeouts on Windows led AI to suggest `WindowsSelectorEventLoopPolicy()`. That is the old
answer; on newer Python it does not help. I wrote `backend/run.py` with an explicit selector
loop instead. Later, on a Python 3.10 machine, the 3.12-only `loop_factory` kwarg crashed — I
added a version branch myself. AI pointed at the problem; the working entrypoint was mine after
reading psycopg's actual error output.

### 3. Money rounding default I did not trust

```python
return value.quantize(Decimal("0.01"))  # defaults to ROUND_HALF_EVEN
```

A test failed. I changed it to explicit `ROUND_HALF_UP`. Small thing, but I am not leaving currency
behaviour to an implicit default the model copied from a blog post.

### 4. Dockerfile that could not build

```dockerfile
COPY ../data /data
```

Docker cannot copy outside the build context. I restructured the build context to the repo root
so the seed data is available in the image. AI generated something that looks plausible and fails
every time.

### 5. Tests that were wrong — I fixed the tests, not the code

- Epoch-ms expectation written as `datetime(2026, 1, 13, 1, 65 % 60, 9)` — nonsense; correct
  answer is 00:45:09.
- Voucher test forbidding `I`/`O` in the whole code, but the SKU prefix `SPOTIFY` legitimately
  contains both.

Easy to "fix" production code until a bad test passes. I did not.

### 6. Smaller drafts I corrected before shipping

- Hallucinated CSS token (`--text-tertiary: #78welcome;`).
- TypeScript helper that did not handle `ReactNode &&` narrowing.
- Inline styles and wrong CSS module imports in the dashboard — replaced with real classes.
- `output: "standalone"` breaking local `next start` — caught by running the build, not by trusting
  a green CI-style check.

---

## How I actually worked

1. **Read the brief and the data** before generating code.
2. **Decide** the non-obvious parts (see `DECISIONS.md`).
3. **Implement** the core paths myself; use AI for drafts on repetitive sections.
4. **Verify** — seed the real 10k file, hit `/docs`, click through filters/charts/redeem, run
   `pytest` (58 passing), `tsc --noEmit`, and `next build`.
5. **Delete or rewrite** anything that fails that bar.

AI saved time on typing. It did not save me from thinking. The failures above were caught because
I ran the app — several would have shipped if I had treated the model as an author instead of a
tool.
