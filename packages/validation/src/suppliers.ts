import { z } from "zod";
import { CUSTOMER_TYPES } from "@erp/types";

// Copie conforme de customers.ts (module 2 de la Phase 8) — mêmes règles,
// mêmes choix (NINEA/RCCM format libre, isActive sans z.coerce.boolean(),
// voir le commentaire dans customers.ts pour le piège évité).
const optionalTrimmedString = z.string().trim().min(1).optional();

export const createSupplierSchema = z.object({
  type: z.enum(CUSTOMER_TYPES).default("COMPANY"),
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: optionalTrimmedString,
  address: optionalTrimmedString,
  city: optionalTrimmedString,
  country: z.string().trim().min(1).default("Sénégal"),
  ninea: optionalTrimmedString,
  rccm: optionalTrimmedString,
  notes: optionalTrimmedString,
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const listSuppliersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
