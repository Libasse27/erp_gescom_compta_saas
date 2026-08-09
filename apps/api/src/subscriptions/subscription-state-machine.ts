import { SubscriptionStatus } from "@prisma/client";

// Transitions autorisées du cycle de vie d'un abonnement
// (docs/PROMPT-MAITRE-SAAS.md, Phase 1). CANCELLED et EXPIRED sont
// terminaux : un réabonnement crée une nouvelle Subscription, il ne
// réutilise jamais une ligne existante (voir schema.prisma).
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIAL: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELLED],
  ACTIVE: [SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED],
  PAST_DUE: [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED],
  SUSPENDED: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  CANCELLED: [],
  EXPIRED: [],
};

export class InvalidSubscriptionTransitionError extends Error {
  constructor(
    public readonly from: SubscriptionStatus,
    public readonly to: SubscriptionStatus,
  ) {
    super(`Transition d'abonnement invalide : ${from} → ${to}`);
    this.name = "InvalidSubscriptionTransitionError";
  }
}

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertSubscriptionTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (!canTransitionSubscription(from, to)) {
    throw new InvalidSubscriptionTransitionError(from, to);
  }
}
