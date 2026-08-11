"use client";

import { useCallback, useMemo, useState } from "react";

import { CategoryDonut } from "@/components/analytics/CategoryDonut";
import { MonthlyTrend } from "@/components/analytics/MonthlyTrend";
import { StatTiles } from "@/components/analytics/StatTiles";
import { AppShell, type TabKey } from "@/components/layout/AppShell";
import { CoinBalance } from "@/components/rewards/CoinBalance";
import { RedeemDialog } from "@/components/rewards/RedeemDialog";
import { RewardGrid } from "@/components/rewards/RewardGrid";
import { FilterBar } from "@/components/transactions/FilterBar";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { TransactionTable } from "@/components/transactions/TransactionTable";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { useFilterState } from "@/hooks/useFilterState";
import {
  useActivity,
  useAnalytics,
  useBalance,
  useCatalogue,
  useDataQuality,
  useFacets,
  useTransactions,
} from "@/hooks/useQueries";
import { cx, formatCoins, formatDate, formatNumber } from "@/lib/format";
import type { Reward, Transaction } from "@/lib/types";
import styles from "./Dashboard.module.css";

/**
 * Top-level composition.
 *
 * All view state lives in the URL via `useFilterState`; all server state lives
 * in React Query. This component owns only genuinely ephemeral UI state — which
 * drawer is open, which tab is showing — and wires the pieces together.
 */
export function Dashboard() {
  const controller = useFilterState();
  const { filters, activeCount, setFilters, selectOnly, setPage, toggleSort, clearAll } = controller;

  const [tab, setTab] = useState<TabKey>("overview");
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);
  const [selectedTxnId, setSelectedTxnId] = useState<number | null>(null);
  const [rewardToRedeem, setRewardToRedeem] = useState<Reward | null>(null);
  const [qualityDismissed, setQualityDismissed] = useState(false);

  const transactionsQuery = useTransactions(filters);
  const analyticsQuery = useAnalytics(filters);
  const facetsQuery = useFacets();
  const balanceQuery = useBalance();
  const catalogueQuery = useCatalogue();
  const activityQuery = useActivity();
  const dataQualityQuery = useDataQuality();

  /* ---------------------------------------------------------- handlers */

  const handleSelectTransaction = useCallback((txn: Transaction) => {
    setSelectedTxn(txn);
    setSelectedTxnId(txn.id);
  }, []);

  const handleSelectRelated = useCallback((id: number) => {
    // Jumping to a colliding-id sibling: clear the fallback so the drawer shows
    // its own loading state rather than the previous transaction's data.
    setSelectedTxn(null);
    setSelectedTxnId(id);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedTxnId(null);
    setSelectedTxn(null);
  }, []);

  /** Chart → table: filter to one month by setting the date range. */
  const handleSelectMonth = useCallback(
    (month: string) => {
      const [year, monthNum] = month.split("-").map(Number);
      if (!year || !monthNum) return;

      const from = `${month}-01`;
      // Day 0 of the next month is the last day of this one — avoids a 28/30/31
      // lookup table and handles leap years for free.
      const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
      const to = `${month}-${String(lastDay).padStart(2, "0")}`;

      // Clicking the already-selected month clears it, so the chart can undo
      // its own filter.
      if (filters.dateFrom === from && filters.dateTo === to) {
        setFilters({ dateFrom: "", dateTo: "" });
      } else {
        setFilters({ dateFrom: from, dateTo: to });
      }
    },
    [filters.dateFrom, filters.dateTo, setFilters],
  );

  /** Which month, if any, the current date range exactly covers. */
  const selectedMonth = useMemo(() => {
    if (!filters.dateFrom || !filters.dateTo) return null;
    const from = filters.dateFrom;
    if (!from.endsWith("-01")) return null;
    const prefix = from.slice(0, 7);
    return filters.dateTo.startsWith(prefix) ? prefix : null;
  }, [filters.dateFrom, filters.dateTo]);

  const analytics = analyticsQuery.data;
  const quality = dataQualityQuery.data;

  /* ------------------------------------------------------------ render */

  return (
    <AppShell balance={balanceQuery.data?.balance} activeTab={tab} onTabChange={setTab}>
      {tab === "overview" ? (
        <div className={styles.stack}>
          {quality && !qualityDismissed ? (
            <DataQualityBanner
              refunds={quality.live.refunds}
              outliers={quality.live.outliers}
              backfilled={quality.live.backfilled}
              duplicateIds={quality.live.duplicate_ids}
              formats={quality.timestamp_formats.length}
              onDismiss={() => setQualityDismissed(true)}
            />
          ) : null}

          <StatTiles
            summary={analytics?.summary}
            balance={balanceQuery.data?.balance}
            isLoading={analyticsQuery.isLoading}
          />

          <div className={styles.chartGrid}>
            <CategoryDonut
              data={analytics?.by_category ?? []}
              isLoading={analyticsQuery.isLoading}
              isFetching={analyticsQuery.isFetching && !analyticsQuery.isLoading}
              selected={filters.categories}
              onSelect={(category) => selectOnly("categories", category)}
            />
            <MonthlyTrend
              data={analytics?.by_month ?? []}
              isLoading={analyticsQuery.isLoading}
              isFetching={analyticsQuery.isFetching && !analyticsQuery.isLoading}
              selectedMonth={selectedMonth}
              onSelectMonth={handleSelectMonth}
            />
          </div>

          <Card className={styles.tableCard}>
            <CardHeader
              title="Transactions"
              subtitle={
                transactionsQuery.data
                  ? `${formatNumber(transactionsQuery.data.total)} matching`
                  : "Loading…"
              }
              headingLevel={2}
            />
            <FilterBar
              facets={facetsQuery.data}
              controller={controller}
              isSearching={transactionsQuery.isFetching}
            />
            <TransactionTable
              data={transactionsQuery.data}
              isLoading={transactionsQuery.isLoading}
              isFetching={transactionsQuery.isFetching}
              error={transactionsQuery.error}
              filters={filters}
              selectedId={selectedTxnId}
              hasActiveFilters={activeCount > 0}
              onSort={toggleSort}
              onSelect={handleSelectTransaction}
              onPageChange={setPage}
              onPageSizeChange={(size) => setFilters({ pageSize: size })}
              onClearFilters={clearAll}
              onRetry={() => void transactionsQuery.refetch()}
            />
          </Card>
        </div>
      ) : (
        <div className={styles.rewardsLayout}>
          <aside className={styles.rewardsAside}>
            <CoinBalance
              balance={balanceQuery.data}
              isLoading={balanceQuery.isLoading}
              coinsPerRupee={quality?.rules.rupees_per_coin ?? 100}
            />

            <Card>
              <CardHeader title="Recent coin activity" bordered />
              <CardBody tight>
                {activityQuery.isError ? (
                  <ErrorState
                    error={activityQuery.error}
                    onRetry={() => void activityQuery.refetch()}
                  />
                ) : (activityQuery.data?.ledger ?? []).length === 0 ? (
                  <p className={styles.activityEmpty}>
                    No coin activity yet. Redeem a reward to see it here.
                  </p>
                ) : (
                  <div>
                    {(activityQuery.data?.ledger ?? []).slice(0, 8).map((entry) => (
                      <ActivityRow
                        key={entry.id}
                        title={
                          entry.reason === "EARN"
                            ? (entry.merchant ?? "Payment")
                            : (entry.reward_title ?? "Redemption")
                        }
                        meta={`${entry.reason === "EARN" ? "Earned" : "Redeemed"} · ${formatDate(entry.created_at)}`}
                        delta={entry.delta}
                      />
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </aside>

          <div className={styles.rewardsMain}>
            <div>
              <h2 className={styles.sectionHeading}>Redeem your coins</h2>
              <p className={styles.sectionSub}>
                {catalogueQuery.data
                  ? `${catalogueQuery.data.items.filter((r) => r.affordable).length} of ${catalogueQuery.data.items.length} rewards available with ${formatCoins(catalogueQuery.data.balance)} coins.`
                  : "Loading catalogue…"}
              </p>
            </div>

            {catalogueQuery.isError ? (
              <ErrorState
                error={catalogueQuery.error}
                onRetry={() => void catalogueQuery.refetch()}
              />
            ) : (
              <RewardGrid
                rewards={catalogueQuery.data?.items ?? []}
                isLoading={catalogueQuery.isLoading}
                onSelect={setRewardToRedeem}
              />
            )}
          </div>
        </div>
      )}

      <TransactionDrawer
        transactionId={selectedTxnId}
        fallback={selectedTxn}
        onClose={handleCloseDrawer}
        onSelectRelated={handleSelectRelated}
      />

      <RedeemDialog
        reward={rewardToRedeem}
        balance={balanceQuery.data?.balance ?? 0}
        onClose={() => setRewardToRedeem(null)}
      />
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Data-quality banner                                                        */
/* -------------------------------------------------------------------------- */

/**
 * States plainly what the ingest had to repair.
 *
 * The dataset is deliberately dirty, and quietly cleaning it would make the app
 * look simpler than it is. Surfacing the counts is both honest to the user and
 * the clearest evidence that the pipeline noticed.
 */
function DataQualityBanner({
  refunds,
  outliers,
  backfilled,
  duplicateIds,
  formats,
  onDismiss,
}: {
  refunds: number;
  outliers: number;
  backfilled: number;
  duplicateIds: number;
  formats: number;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.qualityBanner}>
      <span className={styles.qualityIcon} aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.2v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="8" cy="5" r="0.8" fill="currentColor" />
        </svg>
      </span>

      <div className={styles.qualityBody}>
        <span className={styles.qualityTitle}>The source data needed cleaning</span>
        This dataset arrived with inconsistencies. They were repaired at ingest and flagged
        rather than dropped — nothing was thrown away.
        <ul className={styles.qualityList}>
          <li className={styles.qualityItem}>
            <span className={styles.qualityCount}>{formats}</span> timestamp formats
          </li>
          <li className={styles.qualityItem}>
            <span className={styles.qualityCount}>{formatNumber(backfilled)}</span> categories
            inferred
          </li>
          <li className={styles.qualityItem}>
            <span className={styles.qualityCount}>{formatNumber(refunds)}</span> refunds
          </li>
          <li className={styles.qualityItem}>
            <span className={styles.qualityCount}>{formatNumber(duplicateIds)}</span> duplicate IDs
          </li>
          <li className={styles.qualityItem}>
            <span className={styles.qualityCount}>{formatNumber(outliers)}</span> corrupt amount
          </li>
        </ul>
      </div>

      <button
        type="button"
        className={styles.qualityDismiss}
        onClick={onDismiss}
        aria-label="Dismiss data quality notice"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M8 2L2 8M2 2l6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function ActivityRow({
  title,
  meta,
  delta,
}: {
  title: string;
  meta: string;
  delta: number;
}) {
  return (
    <div className={styles.activityRow}>
      <span className={styles.activityMain}>
        <span className={styles.activityTitle}>{title}</span>
        <span className={styles.activityMeta}>{meta}</span>
      </span>
      <span
        className={cx(
          styles.activityDelta,
          delta > 0 ? styles.deltaPositive : styles.deltaNegative,
        )}
      >
        {delta > 0 ? "+" : ""}
        {formatCoins(delta)}
      </span>
    </div>
  );
}
