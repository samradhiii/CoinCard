"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { useDebounce } from "@/hooks/useDebounce";
import type { UseFilterStateResult } from "@/hooks/useFilterState";
import { cx } from "@/lib/format";
import type { Facets, PaymentMethod, PaymentStatus } from "@/lib/types";
import styles from "./FilterBar.module.css";

interface FilterBarProps {
  facets: Facets | undefined;
  controller: UseFilterStateResult;
  isSearching: boolean;
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  SUCCESS: "Success",
  FAILED: "Failed",
  PENDING: "Pending",
};

/**
 * Filter toolbar.
 *
 * Search deserves a note. The input is *locally* controlled and pushed to the
 * URL only after a 300ms pause. Binding it straight to the URL would mean every
 * keystroke triggers a router navigation — the caret jumps, the field feels
 * laggy, and the history fills with one entry per letter. Local state keeps
 * typing instant; the debounce keeps the network quiet.
 */
export function FilterBar({ facets, controller, isSearching }: FilterBarProps) {
  const { filters, activeChips, activeCount, setFilters, toggleValue, clearAll, clearChip } =
    controller;

  const [searchInput, setSearchInput] = useState(filters.search);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const debouncedSearch = useDebounce(searchInput, 300);

  // Push the settled search value into the URL.
  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      setFilters({ search: debouncedSearch });
    }
    // `filters.search` is intentionally omitted: including it would re-run this
    // on the resulting URL change and fight the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Pull external URL changes back into the input — e.g. "Clear all", or the
  // browser back button. Guarded so it cannot clobber in-flight typing.
  useEffect(() => {
    if (filters.search !== debouncedSearch) {
      setSearchInput(filters.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const bounds = facets?.bounds;

  return (
    <div className={styles.bar}>
      <div className={styles.topRow}>
        <Input
          className={styles.search}
          type="search"
          placeholder="Search merchants…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onClear={() => setSearchInput("")}
          pending={isSearching && searchInput !== ""}
          leadingIcon={<SearchIcon />}
          aria-label="Search merchants"
        />

        <span className={styles.spacer} />

        <div className={styles.toggleWrap}>
          <Button
            variant={expanded ? "secondary" : "ghost"}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            leadingIcon={<FilterIcon />}
            trailingIcon={activeCount > 0 ? <span className={styles.count}>{activeCount}</span> : undefined}
          >
            Filters
          </Button>
        </div>

        {activeCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear all
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <div className={styles.panel} id={panelId}>
          {/* ------------------------------------------------ categories */}
          <fieldset className={styles.chipGroup}>
            <legend className={styles.rangeLabel}>Category</legend>
            <div className={styles.chipList}>
              {facets?.categories.map((category) => {
                const on = filters.categories.includes(category.name);
                return (
                  <button
                    key={category.slug}
                    type="button"
                    className={cx(styles.chipToggle, on && styles.chipToggleOn)}
                    onClick={() => toggleValue("categories", category.name)}
                    aria-pressed={on}
                  >
                    <span
                      className={styles.chipSwatch}
                      style={{ backgroundColor: category.color }}
                      aria-hidden="true"
                    />
                    {category.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* --------------------------------------------------- status */}
          <fieldset className={styles.chipGroup}>
            <legend className={styles.rangeLabel}>Status</legend>
            <div className={styles.chipList}>
              {(["SUCCESS", "FAILED", "PENDING"] as PaymentStatus[]).map((status) => {
                const on = filters.statuses.includes(status);
                return (
                  <button
                    key={status}
                    type="button"
                    className={cx(styles.chipToggle, on && styles.chipToggleOn)}
                    onClick={() => toggleValue("statuses", status)}
                    aria-pressed={on}
                  >
                    {STATUS_LABELS[status]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* --------------------------------------------------- method */}
          <fieldset className={styles.chipGroup}>
            <legend className={styles.rangeLabel}>Payment method</legend>
            <div className={styles.chipList}>
              {(["Credit Card", "Debit Card", "UPI", "Netbanking"] as PaymentMethod[]).map((method) => {
                const on = filters.methods.includes(method);
                return (
                  <button
                    key={method}
                    type="button"
                    className={cx(styles.chipToggle, on && styles.chipToggleOn)}
                    onClick={() => toggleValue("methods", method)}
                    aria-pressed={on}
                  >
                    {method}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* ----------------------------------------------- date range */}
          <div className={styles.rangeGroup}>
            <span className={styles.rangeLabel}>Date range</span>
            <div className={styles.rangeInputs}>
              <Input
                type="date"
                value={filters.dateFrom}
                min={bounds?.min_date ?? undefined}
                max={filters.dateTo || bounds?.max_date || undefined}
                onChange={(e) => setFilters({ dateFrom: e.target.value })}
                aria-label="From date"
              />
              <span className={styles.rangeSeparator} aria-hidden="true">–</span>
              <Input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || bounds?.min_date || undefined}
                max={bounds?.max_date ?? undefined}
                onChange={(e) => setFilters({ dateTo: e.target.value })}
                aria-label="To date"
              />
            </div>
          </div>

          {/* --------------------------------------------- amount range */}
          <div className={styles.rangeGroup}>
            <span className={styles.rangeLabel}>Amount (₹)</span>
            <div className={styles.rangeInputs}>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Min"
                value={filters.amountMin}
                onChange={(e) => setFilters({ amountMin: e.target.value })}
                aria-label="Minimum amount"
              />
              <span className={styles.rangeSeparator} aria-hidden="true">–</span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Max"
                value={filters.amountMax}
                onChange={(e) => setFilters({ amountMax: e.target.value })}
                aria-label="Maximum amount"
              />
            </div>
          </div>

          {/* -------------------------------------------- data-quality */}
          <div className={styles.checkGroup}>
            <span className={styles.rangeLabel}>Data quality</span>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={filters.includeRefunds}
                onChange={(e) => setFilters({ includeRefunds: e.target.checked })}
              />
              Show refunds (negative)
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={filters.includeOutliers}
                onChange={(e) => setFilters({ includeOutliers: e.target.checked })}
              />
              Show flagged outliers
            </label>
          </div>
        </div>
      ) : null}

      {activeChips.length > 0 ? (
        <div className={styles.activeRow}>
          <span className={styles.activeLabel}>Active</span>
          {activeChips.map((chip, index) => (
            <span key={`${chip.key}-${chip.item ?? index}`} className={styles.activeChip}>
              <span className={styles.activeChipText}>
                <span className={styles.activeChipKey}>{chip.label}:</span> {chip.value}
              </span>
              <button
                type="button"
                className={styles.activeChipRemove}
                onClick={() => clearChip(chip)}
                aria-label={`Remove ${chip.label} filter ${chip.value}`}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                  <path d="M6.5 1.5l-5 5M1.5 1.5l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M1.5 3h11M3.5 7h7M6 11h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
