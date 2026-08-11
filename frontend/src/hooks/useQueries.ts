"use client";

/**
 * Server-state hooks.
 *
 * Split of responsibilities:
 *   - URL          -> what the user is looking at (filters, sort, page)
 *   - React Query  -> what the server said about it (cache, loading, errors)
 *
 * Neither duplicates the other, so there is no "sync the store with the URL"
 * effect anywhere in this codebase.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ApiError, api } from "@/lib/api";
import { type FilterState, toApiFilterParams, toApiTableParams } from "@/lib/filters";
import type { Balance, Catalogue, RedeemResponse } from "@/lib/types";

export const queryKeys = {
  transactions: (params: unknown) => ["transactions", params] as const,
  transaction: (id: number) => ["transaction", id] as const,
  facets: () => ["facets"] as const,
  analytics: (params: unknown) => ["analytics", params] as const,
  balance: () => ["balance"] as const,
  catalogue: () => ["catalogue"] as const,
  activity: () => ["activity"] as const,
  dataQuality: () => ["data-quality"] as const,
};

/** Don't retry a 4xx — the request is wrong, repeating it won't help. */
const retryPolicy = (failureCount: number, error: unknown) => {
  if (error instanceof ApiError && !error.isRetryable) return false;
  return failureCount < 2;
};

export function useTransactions(filters: FilterState) {
  const params = toApiTableParams(filters);
  return useQuery({
    queryKey: queryKeys.transactions(params),
    queryFn: ({ signal }) => api.transactions.list(params, signal),
    // The single most important line for how the table *feels*: while page 2
    // loads, keep rendering page 1 instead of collapsing to a skeleton. The
    // table dims rather than flashing empty.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retryPolicy,
  });
}

export function useAnalytics(filters: FilterState) {
  // Deliberately excludes sort/page — paging the table must not refetch or
  // re-animate the charts, because it does not change what they show.
  const params = toApiFilterParams(filters);
  return useQuery({
    queryKey: queryKeys.analytics(params),
    queryFn: ({ signal }) => api.analytics.overview(params, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: retryPolicy,
  });
}

export function useTransactionDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.transaction(id ?? -1),
    queryFn: ({ signal }) => api.transactions.detail(id as number, signal),
    enabled: id !== null,
    staleTime: 5 * 60_000,
    retry: retryPolicy,
  });
}

export function useFacets() {
  return useQuery({
    queryKey: queryKeys.facets(),
    queryFn: ({ signal }) => api.transactions.facets(signal),
    // Categories and merchants don't change while the app is open.
    staleTime: Infinity,
    retry: retryPolicy,
  });
}

export function useBalance() {
  return useQuery({
    queryKey: queryKeys.balance(),
    queryFn: ({ signal }) => api.rewards.balance(signal),
    staleTime: 30_000,
    retry: retryPolicy,
  });
}

export function useCatalogue() {
  return useQuery({
    queryKey: queryKeys.catalogue(),
    queryFn: ({ signal }) => api.rewards.catalogue(signal),
    staleTime: 30_000,
    retry: retryPolicy,
  });
}

export function useActivity() {
  return useQuery({
    queryKey: queryKeys.activity(),
    queryFn: ({ signal }) => api.rewards.activity(signal),
    staleTime: 30_000,
    retry: retryPolicy,
  });
}

export function useDataQuality() {
  return useQuery({
    queryKey: queryKeys.dataQuality(),
    queryFn: ({ signal }) => api.meta.dataQuality(signal),
    staleTime: Infinity,
    retry: retryPolicy,
  });
}

/* -------------------------------------------------------------------------- */
/* Redeem — optimistic, with a real rollback                                  */
/* -------------------------------------------------------------------------- */

interface RedeemVariables {
  rewardId: number;
  coinCost: number;
  idempotencyKey: string;
}

/**
 * Optimistic redeem.
 *
 * The balance drops the instant the user confirms, so the UI feels immediate.
 * The important part is `onError`: it restores the *exact snapshot* taken in
 * `onMutate` rather than adding the cost back. Re-adding would corrupt the
 * balance if a background refetch had landed in between; restoring a snapshot
 * cannot. `onSettled` then refetches so the server always gets the last word.
 *
 * The brief calls this out specifically: "the UI has to recover cleanly rather
 * than leaving the balance in a wrong state".
 */
export function useRedeem() {
  const queryClient = useQueryClient();

  return useMutation<
    RedeemResponse,
    ApiError,
    RedeemVariables,
    { previousBalance?: Balance; previousCatalogue?: Catalogue }
  >({
    mutationFn: ({ rewardId, idempotencyKey }) => api.rewards.redeem(rewardId, idempotencyKey),

    onMutate: async ({ coinCost }) => {
      // Stop in-flight refetches from overwriting the optimistic value.
      await queryClient.cancelQueries({ queryKey: queryKeys.balance() });
      await queryClient.cancelQueries({ queryKey: queryKeys.catalogue() });

      const previousBalance = queryClient.getQueryData<Balance>(queryKeys.balance());
      const previousCatalogue = queryClient.getQueryData<Catalogue>(queryKeys.catalogue());

      if (previousBalance) {
        queryClient.setQueryData<Balance>(queryKeys.balance(), {
          ...previousBalance,
          balance: previousBalance.balance - coinCost,
          lifetime_redeemed: previousBalance.lifetime_redeemed + coinCost,
        });
      }

      if (previousCatalogue) {
        const nextBalance = previousCatalogue.balance - coinCost;
        queryClient.setQueryData<Catalogue>(queryKeys.catalogue(), {
          balance: nextBalance,
          // Affordability across the whole catalogue shifts too, so other cards
          // grey out immediately rather than after the refetch.
          items: previousCatalogue.items.map((item) => ({
            ...item,
            affordable: nextBalance >= item.coin_cost && !item.sold_out,
            coins_short: Math.max(0, item.coin_cost - nextBalance),
          })),
        });
      }

      return { previousBalance, previousCatalogue };
    },

    onError: (_error, _variables, context) => {
      if (context?.previousBalance) {
        queryClient.setQueryData(queryKeys.balance(), context.previousBalance);
      }
      if (context?.previousCatalogue) {
        queryClient.setQueryData(queryKeys.catalogue(), context.previousCatalogue);
      }
    },

    onSettled: () => {
      // Success or failure, the server is the authority on the balance.
      void queryClient.invalidateQueries({ queryKey: queryKeys.balance() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogue() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity() });
    },
  });
}
