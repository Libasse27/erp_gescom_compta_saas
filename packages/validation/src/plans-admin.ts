import { z } from "zod";

// Catalogue Super Admin (BIL-12, docs/audit/BILLING-AUDIT.md) — distinct de
// subscriptions.ts (changeSubscriptionPlanSchema affecte un plan existant à
// une entreprise) : ici on édite le catalogue de plans lui-même. Prix en
// XOF, toujours des entiers (CLAUDE.md §7).
export const createPlanSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  priceMonthly: z.number().int().min(0),
  priceYearly: z.number().int().min(0).optional(),
  trialDays: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = createPlanSchema.partial();
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const setPlanFeatureSchema = z.object({ enabled: z.boolean() });
export type SetPlanFeatureInput = z.infer<typeof setPlanFeatureSchema>;

// value: number | null strict, jamais optionnel — le client doit exprimer
// une intention explicite (schema.prisma: "value = NULL signifie illimité").
// undefined (clé absente) est rejeté, contrairement à un champ .optional().
export const setPlanLimitSchema = z.object({ value: z.number().int().min(0).nullable() });
export type SetPlanLimitInput = z.infer<typeof setPlanLimitSchema>;
