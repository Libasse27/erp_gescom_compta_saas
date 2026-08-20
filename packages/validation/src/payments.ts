import { z } from "zod";

// Amorce un Payment(PENDING) côté Super Admin, en attendant un vrai flux de
// checkout (Phase 6/7) — voir docs/PROMPT-MAITRE-SAAS.md Phase 5.
//
// BIL-05 (docs/audit/BILLING-AUDIT.md) : amount/currency ne viennent jamais
// du client (CLAUDE.md §6) — seule la périodicité est acceptée, le montant
// est dérivé côté serveur du prix du plan de l'abonnement visé.
//
// .strict() (BIL-16, docs/audit/BILLING-AUDIT.md) : une clé inattendue dans
// le corps (ex. amount/currency forgés) est désormais rejetée (400) plutôt
// que silencieusement ignorée — contrat d'entrée explicite, cohérent avec
// paymentWebhookEventSchema ci-dessous.
export const createPendingPaymentSchema = z
  .object({
    provider: z.enum(["WAVE", "ORANGE_MONEY", "FREE_MONEY", "STRIPE", "CARD"]),
    providerReference: z.string().trim().min(1),
    billingPeriod: z.enum(["MONTHLY", "YEARLY"]),
  })
  .strict();
export type CreatePendingPaymentInput = z.infer<typeof createPendingPaymentSchema>;

// Enveloppe générique d'un événement webhook, une fois la signature vérifiée
// et le corps brut parsé en JSON (docs/adr/0010-...). Le schéma exact d'un
// vrai fournisseur remplacera ceci quand l'intégration réelle existera.
//
// .strict() + currency en enum (BIL-16, docs/audit/BILLING-AUDIT.md) : une
// dérive de schéma côté fournisseur (champ renommé, `amount_net` ajouté en
// plus d'`amount`) est désormais rejetée (400) plutôt que silencieusement
// ignorée. currency resserré à XOF tant que seule cette devise est
// supportée par la plateforme (CLAUDE.md §7).
export const paymentWebhookEventSchema = z
  .object({
    reference: z.string().trim().min(1),
    status: z.enum(["succeeded", "failed"]),
    amount: z.number().int().positive(),
    currency: z.enum(["XOF"]).default("XOF"),
  })
  .strict();
export type PaymentWebhookEventInput = z.infer<typeof paymentWebhookEventSchema>;
