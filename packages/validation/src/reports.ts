import { z } from "zod";

// Module 9 de la Phase 8 (Rapports) — lecture seule, aucune écriture. Les
// trois rapports (ventes, achats, compte de résultat) partagent la même
// forme de filtre : une période optionnelle, le défaut (mois en cours) est
// appliqué côté repository, jamais figé dans le schéma (un z.date().default()
// statique fixerait "aujourd'hui" au chargement du module, pas à la requête).
export const reportPeriodQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type ReportPeriodQuery = z.infer<typeof reportPeriodQuerySchema>;
