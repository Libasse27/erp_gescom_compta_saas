import { z } from "zod";

// Amorce un Payment(PENDING) côté Super Admin, en attendant un vrai flux de
// checkout (Phase 6/7) — voir docs/PROMPT-MAITRE-SAAS.md Phase 5.
//
// BIL-05 (docs/audit/BILLING-AUDIT.md) : amount/currency ne viennent jamais
// du client (CLAUDE.md §6) — seule la périodicité est acceptée, le montant
// est dérivé côté serveur du prix du plan de l'abonnement visé.
export const createPendingPaymentSchema = z.object({
  provider: z.enum(["WAVE", "ORANGE_MONEY", "FREE_MONEY", "STRIPE", "CARD"]),
  providerReference: z.string().trim().min(1),
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]),
});
export type CreatePendingPaymentInput = z.infer<typeof createPendingPaymentSchema>;

// Enveloppe générique d'un événement webhook, une fois la signature vérifiée
// et le corps brut parsé en JSON (docs/adr/0010-...). Le schéma exact d'un
// vrai fournisseur remplacera ceci quand l'intégration réelle existera.
export const paymentWebhookEventSchema = z.object({
  reference: z.string().trim().min(1),
  status: z.enum(["succeeded", "failed"]),
  amount: z.number().int().positive(),
  currency: z.string().trim().length(3).default("XOF"),
});
export type PaymentWebhookEventInput = z.infer<typeof paymentWebhookEventSchema>;
