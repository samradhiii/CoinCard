"use client";

/**
 * The app's central state hook: filters live in the URL, and this is the only
 * thing allowed to write them.
 *
 * Two details that matter:
 *
 * 1. Any filter change resets to page 1. Landing on "page 40 of 3" after
 *    narrowing a filter is a classic dashboard bug; centralising the reset here
 *    means no individual control can forget it.
 *
 * 2. Navigation uses `replace`, not `push` — except for explicit page changes.
 *    Typing "amazon" would otherwise push six history entries and the back
 *    button would walk letter by letter.
 */

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  DEFAULT_FILTERS,
  type FilterState,
  describeActiveFilters,
  parseFilters,
  serializeFilters,
} from "@/lib/filters";

export interface UseFilterStateResult {
  filters: FilterState;
  activeChips: ReturnType<typeof describeActiveFilters>;
  activeCount: number;
  /** Patch any subset of fields. Resets to page 1 unless `page` is in the patch. */
  setFilters: (patch: Partial<FilterState>, options?: { push?: boolean }) => void;
  /** Add/remove one value of a multi-select field. */
  toggleValue: (key: "categories" | "statuses" | "methods" | "merchants", value: string) => void;
  /** Set a field to exactly one value, or clear it if already the only one. */
  selectOnly: (key: "categories" | "statuses" | "methods" | "merchants", value: string) => void;
  setPage: (page: number) => void;
  /** Cycle a column's sort: same field flips direction, new field starts desc. */
  toggleSort: (field: FilterState["sort"]) => void;
  clearAll: () => void;
  clearChip: (chip: { key: keyof FilterState; item?: string }) => void;
}

export function useFilterState(): UseFilterStateResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const commit = useCallback(
    (next: FilterState, push = false) => {
      const qs = serializeFilters(next);
      const url = qs ? `${pathname}?${qs}` : pathname;
      // scroll:false keeps the viewport still — re-filtering shouldn't yank the
      // user back to the top of the page.
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [pathname, router],
  );

  const setFilters = useCallback(
    (patch: Partial<FilterState>, options?: { push?: boolean }) => {
      const next: FilterState = {
        ...filters,
        ...patch,
        page: patch.page ?? 1,
      };
      commit(next, options?.push);
    },
    [filters, commit],
  );

  const toggleValue = useCallback(
    (key: "categories" | "statuses" | "methods" | "merchants", value: string) => {
      const current = filters[key] as string[];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      setFilters({ [key]: next } as Partial<FilterState>);
    },
    [filters, setFilters],
  );

  const selectOnly = useCallback(
    (key: "categories" | "statuses" | "methods" | "merchants", value: string) => {
      const current = filters[key] as string[];
      // Clicking the same chart slice twice clears it — the filter acts as a
      // toggle, so a chart click is always reversible from the chart itself.
      const isOnlySelection = current.length === 1 && current[0] === value;
      setFilters({ [key]: isOnlySelection ? [] : [value] } as Partial<FilterState>);
    },
    [filters, setFilters],
  );

  const setPage = useCallback(
    (page: number) => {
      // Paging is a real navigation step, so it goes into history.
      commit({ ...filters, page }, true);
    },
    [filters, commit],
  );

  const toggleSort = useCallback(
    (field: FilterState["sort"]) => {
      const isSame = filters.sort === field;
      // Dates and amounts are most useful newest/largest first.
      const order = isSame ? (filters.order === "asc" ? "desc" : "asc") : "desc";
      setFilters({ sort: field, order });
    },
    [filters, setFilters],
  );

  const clearAll = useCallback(() => {
    // Page size and sort are view preferences, not filters — they survive.
    commit({
      ...DEFAULT_FILTERS,
      sort: filters.sort,
      order: filters.order,
      pageSize: filters.pageSize,
    });
  }, [filters, commit]);

  const clearChip = useCallback(
    (chip: { key: keyof FilterState; item?: string }) => {
      if (chip.item) {
        const current = filters[chip.key] as string[];
        setFilters({
          [chip.key]: current.filter((v) => v !== chip.item),
        } as Partial<FilterState>);
        return;
      }
      switch (chip.key) {
        case "search":
          setFilters({ search: "" });
          break;
        case "dateFrom":
        case "dateTo":
          setFilters({ dateFrom: "", dateTo: "" });
          break;
        case "amountMin":
        case "amountMax":
          setFilters({ amountMin: "", amountMax: "" });
          break;
        case "includeRefunds":
          setFilters({ includeRefunds: true });
          break;
        case "includeOutliers":
          setFilters({ includeOutliers: true });
          break;
        default:
          break;
      }
    },
    [filters, setFilters],
  );

  const activeChips = useMemo(() => describeActiveFilters(filters), [filters]);

  return {
    filters,
    activeChips,
    activeCount: activeChips.length,
    setFilters,
    toggleValue,
    selectOnly,
    setPage,
    toggleSort,
    clearAll,
    clearChip,
  };
}
