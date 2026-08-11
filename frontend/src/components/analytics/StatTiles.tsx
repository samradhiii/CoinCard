"use client";

import type { CSSProperties } from "react";

import { Skeleton } from "@/components/ui/States";
import { formatCoins, formatCurrencyWhole, formatNumber } from "@/lib/format";
import type { SpendSummary } from "@/lib/types";
import styles from "./Analytics.module.css";

interface StatTilesProps {
  summary: SpendSummary | undefined;
  balance: number | undefined;
  isLoading: boolean;
}

/**
 * Headline metrics. Recomputed server-side for the current filter set, so these
 * describe *what the user is looking at*, not the whole dataset.
 */
export function StatTiles({ summary, balance, isLoading }: StatTilesProps) {
  if (isLoading || !summary) {
    return (
      <div className={styles.statGrid}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.stat}>
            <Skeleton height={11} width="45%" />
            <Skeleton height={26} width="72%" />
            <Skeleton height={11} width="55%" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.statGrid}>
      <Stat
        label="Total spend"
        value={formatCurrencyWhole(summary.total_spend)}
        meta={`${formatNumber(summary.spend_count)} successful payments`}
        accent="var(--accent)"
      />
      <Stat
        label="Average payment"
        value={formatCurrencyWhole(summary.avg_transaction)}
        meta={`Across ${formatNumber(summary.merchant_count)} merchants`}
        accent="var(--info)"
      />
      <Stat
        label="Refunded"
        value={formatCurrencyWhole(summary.total_refunded)}
        meta={
          summary.refund_count > 0
            ? `${formatNumber(summary.refund_count)} refunds returned`
            : "No refunds in range"
        }
        accent="var(--success)"
      />
      <Stat
        label="Coin balance"
        value={balance !== undefined ? formatCoins(balance) : "—"}
        meta={`+${formatNumber(summary.coins_earned)} earned in this view`}
        accent="var(--coin)"
        coin
      />
    </div>
  );
}

function Stat({
  label,
  value,
  meta,
  accent,
  coin = false,
}: {
  label: string;
  value: string;
  meta: string;
  accent: string;
  coin?: boolean;
}) {
  return (
    <div
      className={coin ? `${styles.stat} ${styles.statCoin}` : styles.stat}
      style={{ "--stat-accent": accent } as CSSProperties}
    >
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} title={value}>
        {value}
      </span>
      <span className={styles.statMeta}>{meta}</span>
    </div>
  );
}
