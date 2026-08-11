"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/States";
import { cx, formatCompact, formatCurrency, formatNumber, toNumber } from "@/lib/format";
import type { MonthPoint } from "@/lib/types";
import styles from "./Analytics.module.css";

interface MonthlyTrendProps {
  data: MonthPoint[];
  isLoading: boolean;
  isFetching: boolean;
  /** Currently filtered month (`YYYY-MM`), highlighted here. */
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
}

/**
 * Monthly spend trend.
 *
 * Clicking a month sets the table's date range to that month — the second half
 * of chart→table cross-filtering. Months with no matching transactions are
 * still plotted (the API fills the series with generate_series), so a filtered
 * range shows a genuine gap instead of quietly joining across it.
 */
export function MonthlyTrend({
  data,
  isLoading,
  isFetching,
  selectedMonth,
  onSelectMonth,
}: MonthlyTrendProps) {
  const points = data.map((point) => ({
    ...point,
    value: toNumber(point.total),
    // Short axis label — "Jul 2025" becomes "Jul '25".
    short: point.label.replace(/ (\d{2})(\d{2})$/, " '$2"),
  }));

  const peak = points.reduce((max, p) => Math.max(max, p.value), 0);
  const totalMonths = points.length;

  return (
    <Card>
      <CardHeader
        title="Monthly trend"
        subtitle={
          totalMonths > 0
            ? `${totalMonths} months · peak ${formatCompact(peak)}`
            : undefined
        }
        actions={
          <span className={styles.chartHint}>
            <CursorIcon />
            Click a month to filter
          </span>
        }
        bordered
      />
      <CardBody>
        {isLoading ? (
          <Skeleton height={280} />
        ) : points.length === 0 ? (
          <p className={styles.chartEmpty}>
            No successful spend matches the current filters.
          </p>
        ) : (
          <div className={cx(styles.chartBox, isFetching && styles.dimmed)}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={points}
                margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                onClick={(state: { activeLabel?: string }) => {
                  const point = points.find((p) => p.short === state?.activeLabel);
                  if (point) onSelectMonth(point.month);
                }}
                style={{ cursor: "pointer" }}
              >
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>

                {/* Horizontal rules only — vertical grid lines add clutter
                    without helping read a value off a continuous series. */}
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="short"
                  tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v: number) => formatCompact(v)}
                  tick={{ fill: "var(--text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip
                  content={<TrendTooltip />}
                  cursor={{ stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "4 4" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#spendFill)"
                  isAnimationActive={false}
                  activeDot={{
                    r: 4,
                    fill: "var(--accent)",
                    stroke: "var(--surface)",
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: unknown[];
}) {
  if (!active || !payload?.length) return null;
  const point = (payload[0] as { payload: MonthPoint & { value: number } }).payload;

  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTitle}>{point.label}</p>
      <p className={styles.tooltipRow}>
        <span>Spend</span>
        <span className={styles.tooltipValue}>{formatCurrency(point.total)}</span>
      </p>
      <p className={styles.tooltipRow}>
        <span>Payments</span>
        <span className={styles.tooltipValue}>{formatNumber(point.count)}</span>
      </p>
      <p className={styles.tooltipRow}>
        <span>Coins</span>
        <span className={styles.tooltipValue}>+{formatNumber(point.coins)}</span>
      </p>
      <p className={styles.tooltipHint}>Click to filter to this month</p>
    </div>
  );
}

function CursorIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M2.5 1.5l7 3.2-3 1-1 3-3-7.2z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
