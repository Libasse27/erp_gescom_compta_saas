import { z } from "zod";

// Miroir de sales.ts (module 5), avec une différence : unitCostExcludingTax
// est fourni par le client (le coût négocié auprès du fournisseur, pas une
// donnée catalogue — voir schema.prisma, model PurchaseLine). vatRateBasisPoints
// reste résolu côté serveur depuis Product, comme pour une vente.
export const createPurchaseLineInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
  unitCostExcludingTax: z.number().int().min(0),
});
export type CreatePurchaseLineInput = z.infer<typeof createPurchaseLineInputSchema>;

export const createPurchaseSchema = z.object({
  supplierId: z.string().uuid(),
  notes: z.string().trim().min(1).optional(),
  lines: z.array(createPurchaseLineInputSchema).min(1),
});
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export const purchaseStatusSchema = z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]);
export type PurchaseStatusInput = z.infer<typeof purchaseStatusSchema>;

export const listPurchasesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  status: purchaseStatusSchema.optional(),
});
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
