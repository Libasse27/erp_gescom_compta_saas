import { z } from "zod";
import { CUSTOMER_TYPES } from "@erp/types";

// NINEA/RCCM : format libre, comme Enterprise.ninea/rccm (registration.ts) —
// aucune règle de format officielle n'est encore documentée dans le projet ;
// inventer une regex non validée serait plus trompeur qu'utile. Validation
// de format réelle à ajouter le jour où la règle exacte est fournie.
const optionalTrimmedString = z.string().trim().min(1).optional();

export const createCustomerSchema = z.object({
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
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

// Toutes les propriétés optionnelles (édition partielle) — mais si un champ
// est fourni, il reste soumis aux mêmes règles qu'à la création.
export const updateCustomerSchema = createCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// z.coerce.number() : les query params HTTP arrivent toujours en string.
// isActive n'utilise volontairement PAS z.coerce.boolean() : Boolean("false")
// vaut true en JS, ce qui inverserait silencieusement le filtre pour
// ?isActive=false — piège classique de z.coerce.boolean() sur des query params.
export const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
