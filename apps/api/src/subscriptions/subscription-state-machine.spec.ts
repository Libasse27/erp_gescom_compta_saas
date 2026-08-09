import { SubscriptionStatus } from "@prisma/client";
import {
  assertSubscriptionTransition,
  canTransitionSubscription,
  InvalidSubscriptionTransitionError,
} from "./subscription-state-machine";

const ALL_STATUSES = Object.values(SubscriptionStatus);

const VALID_TRANSITIONS: [SubscriptionStatus, SubscriptionStatus][] = [
  [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.TRIAL, SubscriptionStatus.EXPIRED],
  [SubscriptionStatus.TRIAL, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
  [SubscriptionStatus.ACTIVE, SubscriptionStatus.SUSPENDED],
  [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.PAST_DUE, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.PAST_DUE, SubscriptionStatus.SUSPENDED],
  [SubscriptionStatus.PAST_DUE, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.SUSPENDED, SubscriptionStatus.ACTIVE],
  [SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED],
];

describe("subscription state machine", () => {
  it.each(VALID_TRANSITIONS)("allows %s → %s", (from, to) => {
    expect(canTransitionSubscription(from, to)).toBe(true);
    expect(() => assertSubscriptionTransition(from, to)).not.toThrow();
  });

  it("rejects every transition out of a terminal state (CANCELLED, EXPIRED)", () => {
    for (const terminal of [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED]) {
      for (const to of ALL_STATUSES) {
        expect(canTransitionSubscription(terminal, to)).toBe(false);
      }
    }
  });

  it("rejects transitions not explicitly listed as valid", () => {
    const validPairs = new Set(VALID_TRANSITIONS.map(([from, to]) => `${from}->${to}`));

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const isValid = validPairs.has(`${from}->${to}`);
        expect(canTransitionSubscription(from, to)).toBe(isValid);
      }
    }
  });

  it("throws InvalidSubscriptionTransitionError with from/to on an invalid transition", () => {
    expect(() =>
      assertSubscriptionTransition(SubscriptionStatus.CANCELLED, SubscriptionStatus.ACTIVE),
    ).toThrow(InvalidSubscriptionTransitionError);

    try {
      assertSubscriptionTransition(SubscriptionStatus.TRIAL, SubscriptionStatus.SUSPENDED);
      throw new Error("expected assertSubscriptionTransition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSubscriptionTransitionError);
      expect((error as InvalidSubscriptionTransitionError).from).toBe(SubscriptionStatus.TRIAL);
      expect((error as InvalidSubscriptionTransitionError).to).toBe(SubscriptionStatus.SUSPENDED);
    }
  });

  it("rejects a no-op self-transition for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionSubscription(status, status)).toBe(false);
    }
  });
});
