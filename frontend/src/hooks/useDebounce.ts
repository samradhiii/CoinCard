"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Debounce a value.
 *
 * Used for search-as-you-type: the input stays fully controlled and responsive
 * at every keystroke, while the network request waits for a pause. Without
 * this, typing "Amazon" fires six queries and the results flicker through five
 * wrong states before settling.
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Debounce a callback, keeping the latest arguments.
 *
 * The ref indirection means a re-render that recreates `callback` does not
 * restart the timer — otherwise a parent re-rendering on every keystroke would
 * make the debounce never fire.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay = 250,
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (...args: Args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => callbackRef.current(...args), delay);
  };
}
