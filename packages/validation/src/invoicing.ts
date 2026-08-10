import { z } from "zod";

// Module 7 de la Phase 8 (Facturation) : contrairement à sales.ts/purchases.ts,
// pas de lignes ici — une facture transforme une vente CONFIRMED déjà
// existante, ses lignes ne sont jamais ressaisies (voir schema.prisma, model
// SalesInvoice).
export const createSalesInvoiceSchema = z.object({
  saleId: z.string().uuid(),
});
export type CreateSalesInvoiceInput = z.infer<typeof createSalesInvoiceSchema>;

// Sous-ensemble de l'enum Prisma InvoiceStatus : DRAFT n'est jamais atteint
// par ce module (une facture est émise directement à la création), donc pas
// exposé comme filtre valide ici.
export const salesInvoiceStatusSchema = z.enum(["ISSUED", "PAID", "VOID"]);
export type SalesInvoiceStatusInput = z.infer<typeof salesInvoiceStatusSchema>;

export const listSalesInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  status: salesInvoiceStatusSchema.optional(),
});
export type ListSalesInvoicesQuery = z.infer<typeof listSalesInvoicesQuerySchema>;
