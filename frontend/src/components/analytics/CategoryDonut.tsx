"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/States";
import { cx, formatCompact, formatCurrency, formatNumber, toNumber } from "@/lib/format";
import type { CategorySlice } from "@/lib/types";
import styles from "./Analytics.module.css";

interface CategoryDonutProps {
  data: CategorySlice[];
  isLoading: boolean;
  isFetching: boolean;
  /** Categories currently filtered — highlighted here, dimming the rest. */
  selected: string[];
  onSelect: (category: string) => void;
}

/**
 * Category breakdown.
 *
 * Cross-filtering runs both ways:
 *   · click a slice (or a legend row) → the transaction table filters to it;
 *   · filter the table any other way → this chart is recomputed server-side
 *     over the same predicate, so the slices reshape to match.
 *
 * Clicking an already-selected slice clears it, so the chart can always undo
 * itself without the user hunting for the filter chip.
 */
export function CategoryDonut({
  data,
  isLoading,
  isFetching,
  selected,
  onSelect,
}: CategoryDonutProps) {
  const total = data.reduce((sum, slice) => sum + toNumber(slice.total), 0);
  const hasSelection = selected.length > 0;

  return (
    <Card>
      <CardHeader
        title="Spend by category"
        subtitle={
          data.length > 0
            ? `${formatNumber(data.length)} categories · ${formatCompact(total)} total`
            : undefined
        }
        actions={
          <span className={styles.chartHint}>
            <CursorIcon />
            Click to filter
          </span>
        }
        bordered
      />
      <CardBody>
        {isLoading ? (
          <div className={styles.donutWrap}>
            <Skeleton height={236} radius="var(--radius-full)" />
            <div className={styles.legend}>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={22} />
              ))}
            </div>
          </div>
        ) : data.length === 0 ? (
          <p className={styles.chartEmpty}>
            No successful spend matches the current filters.
          </p>
        ) : (
          <div className={cx(styles.donutWrap, isFetching && styles.dimmed)}>
            <div className={styles.donutChart}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey={(slice: CategorySlice) => toNumber(slice.total)}
                    nameKey="category"
                    innerRadius="58%"
                    outerRadius="88%"
                    paddingAngle={2}
                    // Animating on every filter change is distracting when the
                    // chart updates as fast as you can click.
                    isAnimationActive={false}
                    onClick={(entry: unknown) => {
                      const slice = entry as { payload?: CategorySlice };
                      if (slice?.payload) onSelect(slice.payload.category);
                    }}
                  >
                    {data.map((slice) => {
                      const isOn = selected.includes(slice.category);
                      return (
                        <Cell
                          key={slice.slug}
                          fill={slice.color}
                          className={styles.slice}
                          // Dim the unselected slices rather than hiding them,
                          // so the selection stays legible in context.
                          opacity={!hasSelection || isOn ? 1 : 0.24}
                          stroke={isOn ? "var(--text-primary)" : "transparent"}
                          strokeWidth={isOn ? 1.5 : 0}
                        />
                      );
                    })}
                  </Pie>
                  <Tooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              <div className={styles.donutCenter}>
                <span className={styles.donutCenterLabel}>Total</span>
                <span className={styles.donutCenterValue}>{formatCompact(total)}</span>
              </div>
            </div>

            {/* The legend is a list of real buttons, which makes every slice
                reachable by keyboard — a <path> in an SVG is not. */}
            <div className={styles.legend} role="list">
              {data.map((slice) => {
                const isOn = selected.includes(slice.category);
                return (
                  <button
                    key={slice.slug}
                    type="button"
                    role="listitem"
                    className={cx(styles.legendItem, isOn && styles.legendActive)}
                    onClick={() => onSelect(slice.category)}
                    aria-pressed={isOn}
                  >
                    <span
                      className={styles.legendSwatch}
                      style={{ backgroundColor: slice.color }}
                      aria-hidden="true"
                    />
                    <span className={styles.legendName}>{slice.category}</span>
                    <span className={styles.legendValue}>{slice.share.toFixed(1)}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DonutTooltip({ active, payload }: { active?: boolean; payload?: unknown[] }) {
  if (!active || !payload?.length) return null;
  const slice = (payload[0] as { payload: CategorySlice }).payload;

  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTitle}>
        <span
          className={styles.legendSwatch}
          style={{ backgroundColor: slice.color }}
          aria-hidden="true"
        />
        {slice.category}
      </p>
      <p className={styles.tooltipRow}>
        <span>Spend</span>
        <span className={styles.tooltipValue}>{formatCurrency(slice.total)}</span>
      </p>
      <p className={styles.tooltipRow}>
        <span>Share</span>
        <span className={styles.tooltipValue}>{slice.share.toFixed(1)}%</span>
      </p>
      <p className={styles.tooltipRow}>
        <span>Payments</span>
        <span className={styles.tooltipValue}>{formatNumber(slice.count)}</span>
      </p>
      <p className={styles.tooltipRow}>
        <span>Average</span>
        <span className={styles.tooltipValue}>{formatCurrency(slice.average)}</span>
      </p>
      <p className={styles.tooltipHint}>Click to filter the table</p>
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
