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
      "src/scripts/**",
      "src/users/invitations.service.ts",
      // AuditLog est écrit aussi bien avant qu'un tenant soit connu (ex:
      // LOGIN_FAILED sur un email inconnu) que depuis un contexte tenant —
      // et n'est encore jamais lu via une liste scopée tenant. Reste sur la
      // connexion d'identité tant qu'aucun endpoint ne consulte les logs
      // d'une entreprise (voir docs/adr/0008-...).
      "src/common/audit/**",
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
