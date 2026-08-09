import { z } from "zod";
import { passwordSchema } from "./auth";

// Combine les étapes 1 (compte), 2 (entreprise) et 3 (forfait) de l'assistant
// d'inscription (docs/SPECIFICATIONS-SAAS.md §7) en un seul appel API — le
// découpage en étapes est une préoccupation d'UX (Phase 7), pas de contrat API.
export const registerSchema = z.object({
  // Étape 1 — compte administrateur
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().optional(),
  password: passwordSchema,

  // Étape 2 — entreprise. Seul enterpriseName est requis (docs/SPECIFICATIONS-SAAS.md
  // §7 étape 2 — NINEA/RCCM non exigés à l'inscription, voir schema.prisma Enterprise).
  enterpriseName: z.string().trim().min(1),
  legalName: z.string().trim().optional(),
  ninea: z.string().trim().optional(),
  rccm: z.string().trim().optional(),
  sector: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  country: z.string().trim().length(2).default("SN"),
  enterprisePhone: z.string().trim().optional(),
  enterpriseEmail: z.string().trim().toLowerCase().email().optional(),

  // Étape 3 — forfait
  planId: z.string().uuid(),
});
export type RegisterInput = z.infer<typeof registerSchema>;
