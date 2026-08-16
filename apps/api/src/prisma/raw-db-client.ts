import { PrismaClient } from "@prisma/client";

// Connexion "propriétaire" (DATABASE_URL, rôle erp — réservé aux migrations
// depuis la correction de MT-01, voir docs/audit/MULTI-TENANT-AUDIT.md et
// docs/adr/0018-role-identite-bypassrls-non-superuser.md), utilisée
// EXCLUSIVEMENT par les fixtures de test : création/nettoyage de données à
// travers toutes les tables, indépendamment du périmètre restreint de la
// connexion identité applicative (erp_app_identity). Le code sous test
// continue de passer par PrismaService/TenantScopedPrismaService comme en
// production ; seule la préparation/le nettoyage de fixtures passe par
// cette classe.
//
// Ne jamais importer ce fichier depuis un module applicatif (hors
// *.spec.ts) : ce serait réintroduire exactement l'accès superuser que
// MT-01 corrige.
export class RawDbClient extends PrismaClient {}
