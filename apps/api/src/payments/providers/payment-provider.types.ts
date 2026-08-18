export interface PaymentWebhookEvent {
  providerReference: string;
  status: "SUCCEEDED" | "FAILED";
  amount: number;
  currency: string;
}

// Point de variation unique par fournisseur (docs/adr/0010-...). Tout le
// reste (idempotence, machine à états, facturation) est indépendant de
// l'implémentation concrète.
export interface PaymentProviderAdapter {
  // timestampHeader (BIL-06, docs/audit/BILLING-AUDIT.md) : requis pour que
  // la signature borne dans le temps la validité du corps signé — un futur
  // adaptateur dédié à un fournisseur réel doit exposer la même fraîcheur,
  // que le schéma exact du fournisseur la porte dans un en-tête séparé ou
  // combinée à la signature (ex. Stripe-Signature).
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined, timestampHeader: string | undefined): boolean;
  parseEvent(rawBody: Buffer): PaymentWebhookEvent;
}
