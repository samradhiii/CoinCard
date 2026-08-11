"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ToastProvider } from "@/components/ui/Toast";

/**
 * The QueryClient is created in `useState` rather than at module scope.
 *
 * A module-level client is shared across every request on the server, which in
 * a Next.js App Router app means one user's cached data can leak into another
 * user's render. Creating it per-mount avoids that entirely.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The dataset is static once seeded; refetching because the user
            // tabbed back to the window is pure noise.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            gcTime: 5 * 60_000,
          },
          mutations: {
            // Redeem must never auto-retry: a retried POST that actually
            // succeeded the first time would charge the user twice. The
            // idempotency key makes a *deliberate* retry safe instead.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
