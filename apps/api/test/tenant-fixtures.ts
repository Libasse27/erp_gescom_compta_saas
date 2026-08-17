import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PERMISSION_KEYS } from "@erp/permissions";
import { RawDbClient } from "../src/prisma/raw-db-client";
import { PasswordService } from "../src/auth/password.service";

// Couvre tous les modules ERP dotés d'un endpoint tenant-scoped (voir
// *.controller.ts, décorateur @RequiresFeature) — un fixture partagé doit
// activer TOUT, contrairement aux anciens `setupAdmin` locaux qui
// n'activaient que la feature de leur propre module (docs/audit/
// PROJECT-AUDIT.md, couverture générique du test:tenant "toute liste ne
// contient que des documents de A").
const ALL_FEATURE_KEYS = [
  "clients",
  "suppliers",
  "products",
  "sales",
  "purchases",
  "invoicing",
  "stock",
  "accounting",
  "reports",
] as const;

export interface TenantFixture {
  enterpriseId: string;
  accessToken: string;
}

export interface TenantFixtureTracking {
  enterpriseIds: string[];
  planIds: string[];
}

export function createTenantFixtureTracking(): TenantFixtureTracking {
  return { enterpriseIds: [], planIds: [] };
}

// Remplace les `setupAdmin` locaux dupliqués dans chaque *.tenant.spec.ts —
// admin avec TOUTES les permissions et TOUTES les features activées (pas
// seulement celles du module testé) : plus réaliste qu'un admin à accès
// restreint, et réutilisable tel quel par le test générique table-driven
// des endpoints de liste (apps/api/src/tenant/list-endpoints.tenant.spec.ts).
// Un appel crée un tenant isolé ; appeler deux fois pour obtenir tenant A et B.
export function createSetupAdmin(
  app: INestApplication,
  prisma: RawDbClient,
  passwordService: PasswordService,
  tracking: TenantFixtureTracking,
): (label: string) => Promise<TenantFixture> {
  return async (label: string) => {
    const features = await Promise.all(
      ALL_FEATURE_KEYS.map((key) =>
        prisma.feature.upsert({ where: { key }, create: { key, label: key }, update: {} }),
      ),
    );

    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test (toutes fonctionnalités)",
        priceMonthly: 5_000,
        planFeatures: { create: features.map((feature) => ({ featureId: feature.id, enabled: true })) },
      },
    });
    tracking.planIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `${label} ${randomUUID()}` } });
    tracking.enterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({
      where: { id: enterprise.id },
      data: { currentSubscriptionId: subscription.id },
    });

    // Nom unique par appel (pas juste "ADMIN") : les rôles créés pour tenant
    // A et B doivent rester distinguables si un futur test les utilise comme
    // marqueur (voir list-endpoints.tenant.spec.ts, endpoint GET /roles).
    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: `ADMIN-${randomUUID()}` } });
    for (const key of PERMISSION_KEYS) {
      const permission = await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }

    const password = "TestPassword9!";
    const user = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: label,
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password })
      .expect(200);

    return { enterpriseId: enterprise.id, accessToken: loginRes.body.accessToken as string };
  };
}

// Nettoyage symétrique à createSetupAdmin — un seul endroit à maintenir
// désormais. Ne supprime PAS les données métier créées par les tests
// eux-mêmes (customers, products...) : chaque describe() reste responsable
// de nettoyer ses propres entités métier AVANT d'appeler cette fonction
// (contrainte FK sur enterpriseId), cette fonction ne nettoie que ce que
// createSetupAdmin a lui-même créé (tenant/plan/abonnement/rôle/utilisateur).
export async function cleanupTenantFixtures(prisma: RawDbClient, tracking: TenantFixtureTracking): Promise<void> {
  const { enterpriseIds, planIds } = tracking;
  if (enterpriseIds.length > 0) {
    await prisma.enterprise.updateMany({
      where: { id: { in: enterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.userRole.deleteMany({ where: { user: { enterpriseId: { in: enterpriseIds } } } });
    await prisma.user.deleteMany({ where: { enterpriseId: { in: enterpriseIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { enterpriseId: { in: enterpriseIds } } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: enterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: enterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: enterpriseIds } } });
  }
  if (planIds.length > 0) {
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
  }
}
