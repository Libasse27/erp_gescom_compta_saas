import { z } from "zod";

// Contrairement à customers.ts/suppliers.ts/products.ts (des fiches) et
// stock.ts (un mouvement isolé), une vente a des lignes : createSaleSchema
// ne prend que productId/quantity par ligne — le prix et la TVA sont résolus
// côté serveur depuis Product au moment de la création, jamais transmis par
// le client (voir schema.prisma, model SaleLine).
export const createSaleLineInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
});
export type CreateSaleLineInput = z.infer<typeof createSaleLineInputSchema>;

export const createSaleSchema = z.object({
  customerId: z.string().uuid(),
  notes: z.string().trim().min(1).optional(),
  lines: z.array(createSaleLineInputSchema).min(1),
});
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const saleStatusSchema = z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]);
export type SaleStatusInput = z.infer<typeof saleStatusSchema>;

export const listSalesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  status: saleStatusSchema.optional(),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
