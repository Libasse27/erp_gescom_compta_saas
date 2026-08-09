import { PrismaClient } from "@prisma/client";
import { PERMISSION_KEYS } from "@erp/permissions";

// Idempotent : peut être exécuté à chaque déploiement (`prisma db seed`)
// sans dupliquer ni supprimer de lignes. N'insère que le catalogue global
// Permission — les Role par entreprise sont créés au provisioning (Phase 6).
async function main() {
  const prisma = new PrismaClient();

  try {
    for (const key of PERMISSION_KEYS) {
      await prisma.permission.upsert({
        where: { key },
        create: { key },
        update: {},
      });
    }
    console.log(`Catalogue de permissions synchronisé (${PERMISSION_KEYS.length} clés).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
