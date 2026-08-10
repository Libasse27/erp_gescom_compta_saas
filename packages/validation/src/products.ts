import { z } from "zod";

// Contrairement à customers.ts/suppliers.ts (tiers), un produit a un prix :
// toujours un entier (XOF, jamais de flottant — CLAUDE.md §7). Le prix est
// stocké HT ; le TTC se calcule à l'affichage à partir de vatRateBasisPoints
// (1800 = 18 %), jamais stocké (évite la dérive de données).
const optionalTrimmedString = z.string().trim().min(1).optional();

export const createProductSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: optionalTrimmedString,
  unit: z.string().trim().min(1).default("pièce"),
  category: optionalTrimmedString,
  barcode: optionalTrimmedString,
  sellingPriceExcludingTax: z.number().int().min(0),
  vatRateBasisPoints: z.number().int().min(0).max(10_000).default(1_800),
  trackStock: z.boolean().default(true),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// isActive n'utilise volontairement pas z.coerce.boolean() — voir le
// commentaire équivalent dans customers.ts (Boolean("false") === true en JS).
export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
