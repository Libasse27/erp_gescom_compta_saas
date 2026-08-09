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
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  parseEvent(rawBody: Buffer): PaymentWebhookEvent;
}
