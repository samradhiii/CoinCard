"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/States";
import { cx, formatCoins, formatCurrencyWhole } from "@/lib/format";
import type { Reward } from "@/lib/types";
import styles from "./Rewards.module.css";

interface RewardGridProps {
  rewards: Reward[];
  isLoading: boolean;
  onSelect: (reward: Reward) => void;
}

export function RewardGrid({ rewards, isLoading, onSelect }: RewardGridProps) {
  if (isLoading) {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i}>
            <div className={styles.reward}>
              <Skeleton height={42} width={42} radius="var(--radius-md)" />
              <Skeleton height={16} width="75%" />
              <Skeleton height={30} />
              <Skeleton height={32} />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {rewards.map((reward) => (
        <RewardCard key={reward.id} reward={reward} onSelect={onSelect} />
      ))}
    </div>
  );
}

function RewardCard({
  reward,
  onSelect,
}: {
  reward: Reward;
  onSelect: (reward: Reward) => void;
}) {
  const locked = !reward.affordable;
  const lowStock =
    reward.stock_remaining !== null && reward.stock_remaining > 0 && reward.stock_remaining <= 10;

  return (
    <Card interactive className={cx(locked && styles.rewardLocked)}>
      <div className={styles.reward}>
        <div className={styles.rewardTop}>
          <span className={styles.rewardIcon} aria-hidden="true">
            {reward.icon}
          </span>
          <Badge tone="neutral">Worth {formatCurrencyWhole(reward.value_inr)}</Badge>
        </div>

        <div className={styles.rewardBody}>
          <h3 className={styles.rewardTitle}>{reward.title}</h3>
          <p className={styles.rewardDescription}>{reward.description}</p>
          {reward.sold_out ? (
            <Badge tone="danger">Out of stock</Badge>
          ) : lowStock ? (
            <Badge tone="warning">Only {reward.stock_remaining} left</Badge>
          ) : null}
        </div>

        <div className={styles.rewardFooter}>
          <span className={styles.rewardCost}>
            {formatCoins(reward.coin_cost)}
            <span className={styles.rewardCostUnit}>coins</span>
          </span>

          <Button
            variant={locked ? "secondary" : "coin"}
            size="sm"
            onClick={() => onSelect(reward)}
            disabled={locked}
            // A disabled button gives a screen reader no reason; this does.
            aria-label={
              reward.sold_out
                ? `${reward.title} is out of stock`
                : locked
                  ? `${reward.title} needs ${formatCoins(reward.coins_short)} more coins`
                  : `Redeem ${reward.title} for ${formatCoins(reward.coin_cost)} coins`
            }
          >
            {reward.sold_out ? "Sold out" : locked ? "Locked" : "Redeem"}
          </Button>
        </div>

        {locked && !reward.sold_out ? (
          <span className={styles.shortfall}>
            {formatCoins(reward.coins_short)} more coins needed
          </span>
        ) : null}
      </div>
    </Card>
  );
}
