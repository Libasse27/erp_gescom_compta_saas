// @ts-check
const tseslint = require("typescript-eslint");
const baseConfig = require("../../eslint.config.js");

// Config locale : les glob "files"/"ignores" du config partagé sont résolus
// relativement au dossier depuis lequel eslint est invoqué, pas à
// l'emplacement du fichier eslint.config.js lui-même. La règle ci-dessous
// est donc spécifique à apps/api et vit ici plutôt que dans le config racine.
module.exports = tseslint.config(
  ...baseConfig,
  // Phase 3 (multi-tenancy) — voir docs/adr/0008-deux-roles-postgres-identite-vs-tenant.md.
  // PrismaService (rôle sans RLS) est réservé aux résolutions pré-tenant ;
  // tout le reste doit passer par TenantScopedPrismaService (RLS forcée).
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/prisma/**",
      "src/auth/**",
      "src/tenant/tenant-scoped-prisma.service.ts",
      // Seul point d'accès cross-tenant autorisé pour le Super Admin
      // (docs/CLAUDE.md §5, "CrossTenantRepository explicite, journalisé
      // dans l'audit log") — volontairement sans RLS, un Super Admin agit
      // hors de tout tenant.
      "src/tenant/cross-tenant.repository.ts",
      "src/scripts/**",
      "src/users/invitations.service.ts",
      // AuditLog est écrit aussi bien avant qu'un tenant soit connu (ex:
      // LOGIN_FAILED sur un email inconnu) que depuis un contexte tenant —
      // et n'est encore jamais lu via une liste scopée tenant. Reste sur la
      // connexion d'identité tant qu'aucun endpoint ne consulte les logs
      // d'une entreprise (voir docs/adr/0008-...).
      "src/common/audit/**",
      // Même raisonnement que AuditLog : les notifications sont créées
      // avant qu'un tenant soit connu (webhook de paiement, Phase 5) comme
      // depuis un contexte tenant, et rien ne les lit encore via une liste
      // scopée tenant.
      "src/notifications/notifications.service.ts",
      // Le webhook de paiement (Phase 5) n'a pas de JWT, donc pas de
      // TenantContext — flux pré-tenant au même titre que AuthService
      // (docs/adr/0008-...). Chaque requête re-vérifie explicitement
      // l'enterpriseId/subscriptionId contre le Payment déjà en base,
      // jamais depuis le payload du webhook lui-même.
      "src/payments/payments-webhook.service.ts",
      // Le provisioning crée le tenant lui-même : aucun TenantContext ne peut
      // exister avant que l'entreprise n'existe (docs/adr/0008-..., même
      // catégorie qu'AuthService/InvitationsService.acceptInvitation).
      "src/provisioning/provisioning.service.ts",
      "**/*.spec.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/prisma/prisma.service", "**/prisma.service"],
              message:
                "PrismaService est réservé aux résolutions pré-tenant (docs/adr/0008-...). Utilisez TenantScopedPrismaService pour du code exécuté dans un contexte tenant authentifié.",
            },
          ],
          paths: [
            {
              name: "@prisma/client",
              importNames: ["PrismaClient"],
              message:
                "N'instanciez pas PrismaClient directement en dehors de prisma/ et tenant/ (docs/adr/0008-...).",
            },
          ],
        },
      ],
    },
  },
);
