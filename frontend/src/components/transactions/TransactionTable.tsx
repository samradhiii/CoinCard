"use client";

import { memo, useCallback, type CSSProperties, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/Button";
import { CategoryBadge, StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import type { FilterState } from "@/lib/filters";
import { PAGE_SIZES } from "@/lib/filters";
import {
  cx,
  formatCurrency,
  formatDate,
  formatNumber,
  formatTime,
  toNumber,
} from "@/lib/format";
import type { Page, SortField, Transaction } from "@/lib/types";
import styles from "./TransactionTable.module.css";

interface TransactionTableProps {
  data: Page<Transaction> | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  filters: FilterState;
  selectedId: number | null;
  hasActiveFilters: boolean;
  onSort: (field: SortField) => void;
  onSelect: (transaction: Transaction) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onClearFilters: () => void;
  onRetry: () => void;
}

interface ColumnDef {
  key: string;
  label: string;
  sortField?: SortField;
  width: string;
  align?: "left" | "right" | "center";
  /** Class applied to the <td> so the mobile grid can place it. */
  cellClass: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "date", label: "Date", sortField: "date", width: "13%", cellClass: styles.cellDate! },
  { key: "merchant", label: "Merchant", sortField: "merchant", width: "26%", cellClass: styles.cellMerchant! },
  { key: "category", label: "Category", width: "15%", cellClass: styles.cellCategory! },
  { key: "method", label: "Method", width: "13%", cellClass: styles.cellMethod! },
  { key: "status", label: "Status", width: "11%", align: "center", cellClass: styles.cellStatus! },
  { key: "amount", label: "Amount", sortField: "amount", width: "14%", align: "right", cellClass: styles.cellAmount! },
  { key: "coins", label: "Coins", width: "8%", align: "right", cellClass: styles.cellCoins! },
];

/**
 * The transactions table. Hand-built with semantic `<table>` markup — no
 * component library, as the brief requires.
 *
 * Why pagination rather than virtualization (see DECISIONS.md): the server
 * already filters and sorts, so the browser only ever holds ~25 rows. That is
 * both faster than virtualizing 10,000 client-side rows and keeps the markup a
 * real, accessible, Ctrl-F-able table instead of a windowed div soup.
 */
export function TransactionTable({
  data,
  isLoading,
  isFetching,
  error,
  filters,
  selectedId,
  hasActiveFilters,
  onSort,
  onSelect,
  onPageChange,
  onPageSizeChange,
  onClearFilters,
  onRetry,
}: TransactionTableProps) {
  const items = data?.items ?? [];
  // `isFetching && !isLoading` is a *background* refresh — keepPreviousData is
  // still showing the previous page, so dim rather than replace.
  const isRefreshing = isFetching && !isLoading;

  if (error && !data) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.scroller}>
        {isRefreshing ? <div className={styles.progressBar} aria-hidden="true" /> : null}

        <table
          className={cx(styles.table, isRefreshing && styles.refreshing)}
          aria-busy={isFetching}
        >
          <caption className="srOnly">
            Transactions, sorted by {filters.sort} {filters.order === "asc" ? "ascending" : "descending"}.
            {data ? ` Showing page ${data.page} of ${data.total_pages || 1}, ${formatNumber(data.total)} results.` : ""}
          </caption>

          {/* Explicit widths + table-layout:fixed = columns that never jump
              between pages, however long a merchant name is. */}
          <colgroup>
            {COLUMNS.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
          </colgroup>

          <thead className={styles.head}>
            <tr>
              {COLUMNS.map((col) => (
                <HeaderCell
                  key={col.key}
                  column={col}
                  activeSort={filters.sort}
                  activeOrder={filters.order}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <SkeletonRows rows={filters.pageSize > 25 ? 12 : 8} />
            ) : (
              items.map((txn) => (
                <TransactionRow
                  key={txn.id}
                  transaction={txn}
                  selected={txn.id === selectedId}
                  onSelect={onSelect}
                />
              ))
            )}
          </tbody>
        </table>

        {!isLoading && items.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? "No transactions match these filters" : "No transactions yet"}
            message={
              hasActiveFilters
                ? "Try widening the date or amount range, or clearing a filter."
                : "Once the database is seeded, transactions will appear here."
            }
            action={
              hasActiveFilters ? (
                <Button variant="secondary" onClick={onClearFilters}>
                  Clear all filters
                </Button>
              ) : null
            }
          />
        ) : null}
      </div>

      {data && items.length > 0 ? (
        <TableFooter
          data={data}
          pageSize={filters.pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Header cell                                                                */
/* -------------------------------------------------------------------------- */

function HeaderCell({
  column,
  activeSort,
  activeOrder,
  onSort,
}: {
  column: ColumnDef;
  activeSort: SortField;
  activeOrder: "asc" | "desc";
  onSort: (field: SortField) => void;
}) {
  const isActive = column.sortField === activeSort;

  return (
    <th
      scope="col"
      className={cx(
        column.align === "right" && styles.alignRight,
        column.align === "center" && styles.alignCenter,
      )}
      // aria-sort on the <th> is how a screen reader announces sort state.
      aria-sort={
        isActive ? (activeOrder === "asc" ? "ascending" : "descending") : column.sortField ? "none" : undefined
      }
    >
      <div className={styles.headCell}>
        {column.sortField ? (
          <button
            type="button"
            className={cx(styles.sortButton, isActive && styles.sortActive)}
            onClick={() => onSort(column.sortField!)}
          >
            {column.label}
            <SortIcon active={isActive} descending={isActive && activeOrder === "desc"} />
            <span className="srOnly">
              {isActive
                ? `, sorted ${activeOrder === "asc" ? "ascending" : "descending"}. Activate to reverse.`
                : ", not sorted. Activate to sort."}
            </span>
          </button>
        ) : (
          column.label
        )}
      </div>
    </th>
  );
}

function SortIcon({ active, descending }: { active: boolean; descending: boolean }) {
  return (
    <svg
      className={cx(styles.sortIcon, descending && styles.sortDesc)}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      {active ? (
        <path d="M5 1.5v7M2.5 6L5 8.5 7.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M3 4L5 2l2 2M3 6l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `memo` matters here: without it, every parent re-render (a keystroke in the
 * search box, a hover elsewhere) re-renders all 25 rows and their badges.
 */
const TransactionRow = memo(function TransactionRow({
  transaction,
  selected,
  onSelect,
}: {
  transaction: Transaction;
  selected: boolean;
  onSelect: (transaction: Transaction) => void;
}) {
  const amount = toNumber(transaction.amount);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>) => {
      // A clickable row must behave like a button for keyboard users.
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(transaction);
      }
    },
    [onSelect, transaction],
  );

  return (
    <tr
      className={cx(styles.row, selected && styles.rowSelected)}
      onClick={() => onSelect(transaction)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${transaction.merchant}, ${formatCurrency(transaction.amount)} on ${formatDate(transaction.occurred_at)}. View details.`}
    >
      <td className={styles.cellDate}>
        <span className={styles.dateCell}>
          <span className={styles.datePrimary}>{formatDate(transaction.occurred_at)}</span>
          <span className={styles.dateSecondary}>{formatTime(transaction.occurred_at)}</span>
        </span>
      </td>

      <td className={styles.cellMerchant}>
        <span className={styles.merchantCell}>
          <span
            className={styles.avatar}
            style={{ "--cat-color": transaction.category_color } as CSSProperties}
            aria-hidden="true"
          >
            {transaction.merchant.charAt(0).toUpperCase()}
          </span>
          <span className={styles.merchantText}>
            <span className={styles.merchantName}>{transaction.merchant}</span>
            <span className={styles.merchantMeta}>{transaction.external_id}</span>
          </span>
        </span>
      </td>

      <td className={styles.cellCategory}>
        <CategoryBadge name={transaction.category} color={transaction.category_color} />
        {transaction.category_backfilled ? (
          <span
            className={styles.flag}
            title="Category was missing in the source data and inferred from the merchant."
          >
            <InfoDot />
          </span>
        ) : null}
      </td>

      <td className={styles.cellMethod}>{transaction.method}</td>

      <td className={cx(styles.cellStatus, styles.centerCell)}>
        <StatusBadge status={transaction.status} />
      </td>

      <td
        className={cx(
          styles.cellAmount,
          styles.amountCell,
          transaction.is_refund && styles.amountRefund,
          transaction.is_outlier && styles.amountOutlier,
        )}
      >
        {transaction.is_refund ? "+" : ""}
        {formatCurrency(Math.abs(amount))}
        {transaction.is_outlier ? (
          <span className={styles.flag} title="Implausible amount — excluded from spend analytics.">
            <WarnIcon />
          </span>
        ) : null}
      </td>

      <td className={cx(styles.cellCoins, styles.coinsCell, transaction.coins_earned === 0 && styles.coinsZero)}>
        {transaction.coins_earned > 0 ? `+${transaction.coins_earned}` : "—"}
      </td>
    </tr>
  );
});

/* -------------------------------------------------------------------------- */
/* Skeleton + footer                                                          */
/* -------------------------------------------------------------------------- */

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className={styles.skeletonRow}>
          <td><Skeleton height={14} width="70%" /></td>
          <td><Skeleton height={14} width="80%" /></td>
          <td><Skeleton height={14} width="60%" /></td>
          <td><Skeleton height={14} width="65%" /></td>
          <td><Skeleton height={14} width="55%" /></td>
          <td><Skeleton height={14} width="75%" /></td>
          <td><Skeleton height={14} width="40%" /></td>
        </tr>
      ))}
    </>
  );
}

function TableFooter({
  data,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  data: Page<Transaction>;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const from = (data.page - 1) * data.page_size + 1;
  const to = Math.min(data.page * data.page_size, data.total);

  return (
    <div className={styles.footer}>
      <span className={styles.footerInfo}>
        Showing <strong>{formatNumber(from)}</strong>–<strong>{formatNumber(to)}</strong> of{" "}
        <strong>{formatNumber(data.total)}</strong>
      </span>

      <div className={styles.footerControls}>
        <label className={styles.pageSize}>
          <span className="srOnly">Rows per page</span>
          <select
            className={styles.pageSizeSelect}
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </label>

        <Button
          size="sm"
          variant="secondary"
          iconOnly
          onClick={() => onPageChange(data.page - 1)}
          disabled={!data.has_prev}
          aria-label="Previous page"
        >
          <ChevronIcon direction="left" />
        </Button>

        <span className={styles.pageIndicator} aria-live="polite">
          Page {formatNumber(data.page)} of {formatNumber(data.total_pages || 1)}
        </span>

        <Button
          size="sm"
          variant="secondary"
          iconOnly
          onClick={() => onPageChange(data.page + 1)}
          disabled={!data.has_next}
          aria-label="Next page"
        >
          <ChevronIcon direction="right" />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d={direction === "left" ? "M8.5 3.5L5 7l3.5 3.5" : "M5.5 3.5L9 7l-3.5 3.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoDot() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 5.4v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="3.6" r="0.65" fill="currentColor" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5l4.5 8h-9l4.5-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="8.3" r="0.6" fill="currentColor" />
    </svg>
  );
}
