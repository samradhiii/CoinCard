"use client";

import { useEffect, useState } from "react";

/**
 * `false` during SSR and on the client's first render; `true` afterwards.
 *
 * Required by anything using `createPortal`. A portal has no server-rendered
 * counterpart — `document.body` doesn't exist during SSR — so if the client
 * renders it on the very first pass, React finds a `<div>` where the server
 * emitted nothing and throws a hydration mismatch.
 *
 * Gating on this defers the portal to the first post-hydration render, so the
 * server and client agree on pass one. Checking `typeof document !== "undefined"`
 * is *not* sufficient: it is already true on the client's first render.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
