"use client";

import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/States";
import { cx, formatCoins, formatCurrencyWhole } from "@/lib/format";
import type { Balance } from "@/lib/types";
import styles from "./Rewards.module.css";

interface CoinBalanceProps {
  balance: Balance | undefined;
  isLoading: boolean;
  /** True while an optimistic redeem is in flight. */
  isPending?: boolean;
  coinsPerRupee: number;
}

/**
 * The coin balance. The brief requires it to be visible at all times, so this
 * sits in the sticky header on desktop and at the top of the rewards panel.
 *
 * The value shown is whatever React Query holds — which during an optimistic
 * redeem is the already-debited figure. That is the point: the number moves the
 * instant the user confirms, and `useRedeem`'s snapshot rollback puts it back
 * if the server refuses.
 */
export function CoinBalance({ balance, isLoading, isPending = false, coinsPerRupee }: CoinBalanceProps) {
  if (isLoading || !balance) {
    return (
      <Card className={styles.balanceCard}>
        <div className={styles.balanceInner}>
          <Skeleton height={11} width="35%" />
          <Skeleton height={36} width="55%" />
          <Skeleton height={30} width="80%" />
        </div>
      </Card>
    );
  }

  return (
    <Card className={styles.balanceCard}>
      <div className={styles.balanceInner}>
        <span className={styles.balanceLabel}>
          <CoinIcon />
          Coin balance
        </span>

        <p className={styles.balanceValue} aria-live="polite">
          <span className={cx(isPending && styles.balancePending)}>
            {formatCoins(balance.balance)}
          </span>
          <span className={styles.balanceUnit}>coins</span>
        </p>

        <div className={styles.balanceMeta}>
          <span className={styles.balanceStat}>
            <span className={styles.balanceStatLabel}>Lifetime earned</span>
            <span className={styles.balanceStatValue}>
              {formatCoins(balance.lifetime_earned)}
            </span>
          </span>
          <span className={styles.balanceStat}>
            <span className={styles.balanceStatLabel}>Redeemed</span>
            <span className={styles.balanceStatValue}>
              {formatCoins(balance.lifetime_redeemed)}
            </span>
          </span>
          <span className={styles.balanceStat}>
            <span className={styles.balanceStatLabel}>Card</span>
            <span className={styles.balanceStatValue}>•••• {balance.user.card_last4}</span>
          </span>
        </div>

        <p className={styles.cardHint}>
          Earn 1 coin per {formatCurrencyWhole(coinsPerRupee)} on successful payments.
        </p>
      </div>
    </Card>
  );
}

function CoinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4.2v5.6M5.4 5.6h3.2M5.4 8.4h3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
