"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useRedeem } from "@/hooks/useQueries";
import { ApiError } from "@/lib/api";
import { formatCoins, formatCurrencyWhole } from "@/lib/format";
import type { Redemption, Reward } from "@/lib/types";
import styles from "./Rewards.module.css";

interface RedeemDialogProps {
  reward: Reward | null;
  balance: number;
  onClose: () => void;
}

type Phase = "confirm" | "done";

/**
 * The redeem flow: **select → confirm → done**, exactly as the brief specifies.
 *
 * The failure path is the part that matters. `useRedeem` optimistically debits
 * the balance on confirm and restores its pre-mutation snapshot if the request
 * fails, so the balance can never be left wrong. This component's job is to
 * keep the dialog *open* on failure, show what went wrong, and let the user
 * retry — rather than closing and stranding them somewhere with no explanation.
 *
 * The idempotency key is generated once per dialog opening. A retry after a
 * timeout therefore reuses it, and the backend returns the original redemption
 * instead of charging twice.
 */
export function RedeemDialog({ reward, balance, onClose }: RedeemDialogProps) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [redemption, setRedemption] = useState<Redemption | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);

  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string>("");
  const { mutate, isPending } = useRedeem();
  const { toast } = useToast();

  // Reset per opening, and mint a fresh idempotency key for this attempt.
  useEffect(() => {
    if (reward) {
      setPhase("confirm");
      setRedemption(null);
      setError(null);
      setCopied(false);
      idempotencyKey.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `redeem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }, [reward]);

  if (!reward) return null;

  const remaining = balance - reward.coin_cost;

  function handleConfirm() {
    if (!reward) return;
    setError(null);

    mutate(
      {
        rewardId: reward.id,
        coinCost: reward.coin_cost,
        idempotencyKey: idempotencyKey.current,
      },
      {
        onSuccess: (data) => {
          setRedemption(data.redemption);
          setPhase("done");
          toast({
            tone: "success",
            title: "Reward redeemed",
            description: `${reward.title} — ${formatCoins(reward.coin_cost)} coins deducted.`,
          });
        },
        onError: (err) => {
          // The balance has already been rolled back by useRedeem's onError.
          // All that is left is telling the user why, without closing the
          // dialog — closing it here would hide the reason.
          setError(err);
          toast({
            tone: "error",
            title: err.isInsufficientBalance ? "Not enough coins" : "Redemption failed",
            description: `${err.message} Your balance is unchanged.`,
          });
        },
      },
    );
  }

  async function handleCopy() {
    if (!redemption) return;
    try {
      await navigator.clipboard.writeText(redemption.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ tone: "info", title: "Couldn't copy", description: "Select the code manually." });
    }
  }

  return (
    <Modal
      open={reward !== null}
      onClose={onClose}
      size="sm"
      title={phase === "done" ? "Reward redeemed" : "Confirm redemption"}
      description={phase === "done" ? undefined : "Review the details before confirming."}
      initialFocusRef={confirmButtonRef}
      // While the request is in flight, neither Escape nor an overlay click may
      // dismiss the dialog — the user must see the outcome.
      closeOnEscape={!isPending}
      closeOnOverlayClick={!isPending}
      footer={
        phase === "done" ? (
          <Button variant="primary" onClick={onClose} block>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              ref={confirmButtonRef}
              variant="coin"
              onClick={handleConfirm}
              loading={isPending}
              disabled={!reward.affordable && !error}
            >
              {isPending ? "Redeeming…" : error ? "Try again" : `Redeem for ${formatCoins(reward.coin_cost)}`}
            </Button>
          </>
        )
      }
    >
      {phase === "done" && redemption ? (
        <div className={styles.success}>
          <span className={styles.successIcon} aria-hidden="true">
            <CheckIcon />
          </span>
          <p className={styles.successTitle}>{reward.title}</p>
          <p className={styles.successMessage}>
            {formatCoins(redemption.coin_cost)} coins were deducted. Use the code below —
            we&rsquo;ve also emailed it to you.
          </p>
          <p className={styles.code}>
            {redemption.code}
            <button
              type="button"
              className={styles.copyButton}
              onClick={handleCopy}
              aria-label="Copy redemption code"
            >
              {copied ? <CheckIcon small /> : <CopyIcon />}
            </button>
          </p>
        </div>
      ) : (
        <div className={styles.confirm}>
          <div className={styles.confirmHero}>
            <span className={styles.confirmIcon} aria-hidden="true">
              {reward.icon}
            </span>
            <span className={styles.confirmText}>
              <span className={styles.confirmTitle}>{reward.title}</span>
              <span className={styles.confirmDesc}>{reward.description}</span>
            </span>
          </div>

          <div className={styles.ledger}>
            <div className={styles.ledgerRow}>
              <span className={styles.ledgerLabel}>Current balance</span>
              <span className={styles.ledgerValue}>{formatCoins(balance)} coins</span>
            </div>
            <div className={styles.ledgerRow}>
              <span className={styles.ledgerLabel}>Cost</span>
              <span className={`${styles.ledgerValue} ${styles.ledgerCost}`}>
                −{formatCoins(reward.coin_cost)} coins
              </span>
            </div>
            <div className={styles.ledgerRow}>
              <span className={`${styles.ledgerLabel} ${styles.ledgerTotal}`}>
                Balance after
              </span>
              <span className={`${styles.ledgerValue} ${styles.ledgerTotal}`}>
                {formatCoins(Math.max(0, remaining))} coins
              </span>
            </div>
            <div className={styles.ledgerRow}>
              <span className={styles.ledgerLabel}>Reward value</span>
              <span className={styles.ledgerValue}>
                {formatCurrencyWhole(reward.value_inr)}
              </span>
            </div>
          </div>

          {error ? (
            <div className={styles.errorBanner} role="alert">
              <span className={styles.errorIcon} aria-hidden="true">
                <AlertIcon />
              </span>
              <span>
                <span className={styles.errorTitle}>
                  {error.isInsufficientBalance
                    ? "Not enough coins"
                    : error.isUnavailable
                      ? "Reward unavailable"
                      : "Redemption failed"}
                </span>
                {error.message} Your balance was not changed.
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function CheckIcon({ small = false }: { small?: boolean }) {
  const size = small ? 13 : 24;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="8" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9.5 4.5v-1a1.5 1.5 0 00-1.5-1.5H3a1.5 1.5 0 00-1.5 1.5V8A1.5 1.5 0 003 9.5h1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 4.2v3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="9.7" r="0.7" fill="currentColor" />
    </svg>
  );
}
