import { PrismaClient } from "@prisma/client";
import { PERMISSION_KEYS } from "@erp/permissions";

// Prix indicatifs en FCFA (XOF, entiers) — modifiables ensuite par le Super
// Admin (docs/SPECIFICATIONS-SAAS.md §8) : jamais codés en dur ailleurs que
// dans ce seed initial. maxUsers=null => illimité (voir PlanLimit.value).
const PLANS = [
  { code: "STARTER", name: "Starter", priceMonthly: 15_000, priceYearly: 150_000, trialDays: 14, sortOrder: 1, maxUsers: 3 },
  { code: "STANDARD", name: "Standard", priceMonthly: 35_000, priceYearly: 350_000, trialDays: 14, sortOrder: 2, maxUsers: 10 },
  { code: "PROFESSIONNEL", name: "Professionnel", priceMonthly: 75_000, priceYearly: 750_000, trialDays: 14, sortOrder: 3, maxUsers: 25 },
  { code: "ENTERPRISE", name: "Entreprise", priceMonthly: 150_000, priceYearly: 1_500_000, trialDays: 14, sortOrder: 4, maxUsers: null as number | null },
];

// Idempotent : peut être exécuté à chaque déploiement (`prisma db seed`)
// sans dupliquer ni supprimer de lignes.
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

    const usersLimit = await prisma.limit.upsert({
      where: { key: "users" },
      create: { key: "users", label: "Utilisateurs" },
      update: {},
    });

    // Features booléennes des modules ERP (Phase 8), une entrée par module
    // migré, toutes activées sur les 4 forfaits — pas de quota chiffré tant
    // que la grille tarifaire réelle des limites ERP n'est pas validée
    // (docs/PROMPT-MAITRE-SAAS.md Phase 8).
    const ERP_FEATURES = [
      { key: "clients", label: "Clients" },
      { key: "suppliers", label: "Fournisseurs" },
    ];
    const erpFeatures = await Promise.all(
      ERP_FEATURES.map((feature) =>
        prisma.feature.upsert({ where: { key: feature.key }, create: feature, update: {} }),
      ),
    );

    for (const planData of PLANS) {
      const { maxUsers, ...data } = planData;
      const plan = await prisma.plan.upsert({
        where: { code: data.code },
        create: data,
        update: data,
      });
      await prisma.planLimit.upsert({
        where: { planId_limitId: { planId: plan.id, limitId: usersLimit.id } },
        create: { planId: plan.id, limitId: usersLimit.id, value: maxUsers },
        update: { value: maxUsers },
      });
      for (const feature of erpFeatures) {
        await prisma.planFeature.upsert({
          where: { planId_featureId: { planId: plan.id, featureId: feature.id } },
          create: { planId: plan.id, featureId: feature.id, enabled: true },
          update: { enabled: true },
        });
      }
    }
    console.log(`Catalogue de forfaits synchronisé (${PLANS.length} forfaits).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
