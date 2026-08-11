"use client";

import type { CSSProperties, ReactNode } from "react";

import { Badge, CategoryBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { useTransactionDetail } from "@/hooks/useQueries";
import {
  cx,
  formatCurrency,
  formatDateLong,
  formatTime,
  formatTimestampSource,
  toNumber,
} from "@/lib/format";
import type { Transaction } from "@/lib/types";
import styles from "./TransactionDrawer.module.css";

interface TransactionDrawerProps {
  transactionId: number | null;
  /** Row data already in hand, so the drawer paints instantly on click. */
  fallback: Transaction | null;
  onClose: () => void;
  onSelectRelated: (id: number) => void;
}

/**
 * Transaction detail, in a right-hand drawer.
 *
 * Two deliberate touches:
 *
 * 1. It renders immediately from the row the user clicked (`fallback`) and
 *    upgrades in place when the detail request lands. No spinner for data the
 *    app already has.
 *
 * 2. It is honest about the dirty source data — showing which timestamp format
 *    the row arrived in, whether its category was inferred, and any *other*
 *    transaction sharing its (non-unique) source id. That last one turns a
 *    data-integrity trap into a visible product feature.
 */
export function TransactionDrawer({
  transactionId,
  fallback,
  onClose,
  onSelectRelated,
}: TransactionDrawerProps) {
  const { data, isLoading, error, refetch } = useTransactionDetail(transactionId);

  const txn = data?.transaction ?? fallback;
  const collisions = data?.id_collisions ?? [];
  const open = transactionId !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="drawer"
      title="Transaction detail"
      description={txn ? txn.external_id : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && !txn ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !txn ? (
        <div className={styles.loading}>
          <Skeleton height={52} width={52} radius="var(--radius-lg)" />
          <Skeleton height={34} width="60%" />
          <Skeleton height={16} width="40%" />
          <Skeleton height={200} />
        </div>
      ) : (
        <TransactionBody
          txn={txn}
          collisions={collisions}
          collisionsLoading={isLoading && txn.has_duplicate_external_id}
          onSelectRelated={onSelectRelated}
        />
      )}
    </Modal>
  );
}

function TransactionBody({
  txn,
  collisions,
  collisionsLoading,
  onSelectRelated,
}: {
  txn: Transaction;
  collisions: Transaction[];
  collisionsLoading: boolean;
  onSelectRelated: (id: number) => void;
}) {
  const amount = toNumber(txn.amount);

  return (
    <>
      <div className={styles.hero}>
        <span
          className={styles.avatar}
          style={{ "--cat-color": txn.category_color } as CSSProperties}
          aria-hidden="true"
        >
          {txn.merchant.charAt(0).toUpperCase()}
        </span>

        <p
          className={cx(
            styles.amount,
            txn.is_refund && styles.amountRefund,
            txn.is_outlier && styles.amountOutlier,
          )}
        >
          {txn.is_refund ? "+" : "−"}
          {formatCurrency(Math.abs(amount))}
        </p>

        <p className={styles.merchant}>{txn.merchant}</p>
        <p className={styles.when}>
          {formatDateLong(txn.occurred_at)} · {formatTime(txn.occurred_at)}
        </p>

        <div className={styles.heroBadges}>
          <StatusBadge status={txn.status} />
          <CategoryBadge name={txn.category} color={txn.category_color} />
          {txn.is_refund ? <Badge tone="success">Refund</Badge> : null}
          {txn.coins_earned > 0 ? (
            <Badge tone="coin">+{txn.coins_earned} coins</Badge>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------- data-quality notes */}
      {txn.is_outlier ? (
        <Note
          tone="warn"
          title="Implausible amount"
          body="This amount is roughly 28,000× the 99th percentile of the dataset and is
                almost certainly corrupt. It is shown here but excluded from all spend
                analytics and earns no coins."
        />
      ) : null}

      {txn.category_backfilled ? (
        <Note
          tone="info"
          title="Category was inferred"
          body={`The source record had no category. It was backfilled to "${txn.category}"
                 from this merchant, which maps to exactly one category across the dataset.`}
        />
      ) : null}

      {txn.is_refund ? (
        <Note
          tone="info"
          title="Treated as a refund"
          body="The source amount is negative. It is counted as money returned rather than
                spend, so it is excluded from spend totals and earns no coins."
        />
      ) : null}

      {/* ------------------------------------------------------------ details */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Payment</h3>
        <dl className={styles.list}>
          <Row term="Amount">
            <span className={styles.tabular}>{formatCurrency(amount)}</span>
          </Row>
          <Row term="Currency">{txn.currency}</Row>
          <Row term="Method">{txn.method}</Row>
          <Row term="Status">{txn.status.charAt(0) + txn.status.slice(1).toLowerCase()}</Row>
          <Row term="Coins earned">
            <span className={cx(styles.tabular, txn.coins_earned > 0 && styles.coinValue)}>
              {txn.coins_earned > 0 ? `+${txn.coins_earned}` : "None"}
            </span>
          </Row>
        </dl>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Record</h3>
        <dl className={styles.list}>
          <Row term="Transaction ID">
            <span className={styles.mono}>{txn.external_id}</span>
          </Row>
          <Row term="Internal ID">
            <span className={styles.mono}>{txn.id}</span>
          </Row>
          <Row term="Occurred at">
            <span className={styles.tabular}>
              {formatDateLong(txn.occurred_at)}, {formatTime(txn.occurred_at)}
            </span>
          </Row>
          <Row term="Source format">{formatTimestampSource(txn.source_ts_format)}</Row>
        </dl>
      </section>

      {/* --------------------------------------------------- id collisions */}
      {txn.has_duplicate_external_id ? (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Shares this transaction ID</h3>
          <Note
            tone="warn"
            title="Duplicate source ID"
            body="Another unrelated transaction in the feed carries this same ID. Both are
                  kept — the app keys off its own internal ID instead."
          />
          {collisionsLoading ? (
            <Skeleton height={62} />
          ) : (
            collisions.map((other) => (
              <button
                key={other.id}
                type="button"
                className={styles.collision}
                onClick={() => onSelectRelated(other.id)}
              >
                <span className={styles.collisionMain}>
                  <span className={styles.collisionMerchant}>{other.merchant}</span>
                  <span className={styles.collisionMeta}>
                    {formatDateLong(other.occurred_at)} · {other.category}
                  </span>
                </span>
                <span className={styles.collisionAmount}>
                  {formatCurrency(toNumber(other.amount))}
                </span>
              </button>
            ))
          )}
        </section>
      ) : null}
    </>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.term}>{term}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}

function Note({
  tone,
  title,
  body,
}: {
  tone: "info" | "warn";
  title: string;
  body: string;
}) {
  return (
    <div className={cx(styles.note, tone === "warn" ? styles.noteWarn : styles.noteInfo)}>
      <span className={styles.noteIcon} aria-hidden="true">
        {tone === "warn" ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1.8l5.2 9.4H1.8L7 1.8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M7 5.8v2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="7" cy="9.7" r="0.7" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7 6.4v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="7" cy="4.4" r="0.7" fill="currentColor" />
          </svg>
        )}
      </span>
      <span>
        <span className={styles.noteTitle}>{title}</span>
        {body}
      </span>
    </div>
  );
}
