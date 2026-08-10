import { z } from "zod";

// Contrairement à customers.ts/suppliers.ts/products.ts (des fiches),
// StockMovement est un mouvement de grand livre : quantity porte des règles
// différentes selon type (voir schema.prisma, model StockMovement) —
// magnitude positive pour IN/OUT (le signe est porté par `type`), delta
// signé non nul pour ADJUSTMENT (corrige un écart dans un sens ou l'autre).
export const stockMovementTypeSchema = z.enum(["IN", "OUT", "ADJUSTMENT"]);
export type StockMovementTypeInput = z.infer<typeof stockMovementTypeSchema>;

export const createStockMovementSchema = z
  .object({
    productId: z.string().uuid(),
    type: stockMovementTypeSchema,
    quantity: z.number().int(),
    note: z.string().trim().min(1).optional(),
  })
  .refine((value) => (value.type === "ADJUSTMENT" ? value.quantity !== 0 : value.quantity > 0), {
    message: "La quantité doit être strictement positive pour IN/OUT, non nulle pour ADJUSTMENT",
    path: ["quantity"],
  });
export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;

// isActive n'existe pas ici (pas de suppression logique sur un grand livre
// append-only) : filtre uniquement sur les produits qui suivent le stock,
// géré côté repository, pas par ce schéma.
export const listStockQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
});
export type ListStockQuery = z.infer<typeof listStockQuerySchema>;

export const listStockMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;
