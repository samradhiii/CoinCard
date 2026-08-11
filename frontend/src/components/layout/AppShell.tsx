"use client";

import type { ReactNode } from "react";

import { useTheme } from "@/hooks/useTheme";
import { cx, formatCoins } from "@/lib/format";
import styles from "./AppShell.module.css";

export type TabKey = "overview" | "rewards";

interface AppShellProps {
  balance: number | undefined;
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  children: ReactNode;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Transactions" },
  { key: "rewards", label: "Rewards" },
];

export function AppShell({ balance, activeTab, onTabChange, children }: AppShellProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <LogoIcon />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>CoinCard</span>
            <span className={styles.brandTag}>Spend, track, earn</span>
          </span>
        </div>

        <span className={styles.headerSpacer} />

        <div className={styles.headerActions}>
          {/* Balance is always visible, on every tab and every breakpoint. */}
          <button
            type="button"
            className={styles.coinPill}
            onClick={() => onTabChange("rewards")}
            aria-label={
              balance !== undefined
                ? `${formatCoins(balance)} coins. Go to rewards.`
                : "Loading coin balance"
            }
          >
            <CoinIcon />
            {balance !== undefined ? formatCoins(balance) : "—"}
            <span className={styles.coinPillUnit}>coins</span>
          </button>

          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>
              {activeTab === "overview" ? "Your spending" : "Rewards"}
            </h1>
            <p className={styles.pageSubtitle}>
              {activeTab === "overview"
                ? "Every payment on your card, with filters and live analytics."
                : "Turn the coins you've earned into vouchers and cashback."}
            </p>
          </div>

          <nav className={styles.tabs} aria-label="Sections">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={cx(styles.tab, activeTab === tab.key && styles.tabActive)}
                onClick={() => onTabChange(tab.key)}
                aria-current={activeTab === tab.key ? "page" : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {children}
      </main>

      <footer className={styles.footer}>
        CoinCard — built for the Digital Alpha take-home. Next.js · FastAPI · PostgreSQL 18.
      </footer>
    </div>
  );
}

function LogoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11.5" cy="9.8" r="1.6" fill="currentColor" />
    </svg>
  );
}

function CoinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 4.2v5.6M5.4 5.6h3.2M5.4 8.4h3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 9.6A5.8 5.8 0 016.4 2.5a5.8 5.8 0 107.1 7.1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
