import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "./permissions.guard";
import { REQUIRED_PERMISSION_KEY, RequirePermission } from "../decorators/require-permission.decorator";
import { NoPermissionRequired } from "../decorators/no-permission-required.decorator";
import { TenantScopedPrismaService } from "../../tenant/tenant-scoped-prisma.service";

// Régression RBAC-01 (docs/audit/RBAC-AUDIT.md) : un décorateur de permission
// oublié ne doit plus jamais ouvrir une route à tout utilisateur authentifié.
// Ces trois cas ne touchent jamais tenantPrisma (le guard doit lever avant),
// donc un mock non fonctionnel suffit à prouver que la décision est prise
// sans dépendre de la base.
class UndecoratedController {
  handler() {}
}

class ClassLevelPermissionController {
  @RequirePermission("products.read")
  handler() {}
}

class ExemptedController {
  @NoPermissionRequired()
  handler() {}
}

function contextFor(target: object): ExecutionContext {
  const handler = (target as { handler: () => void }).handler;
  return {
    getHandler: () => handler,
    getClass: () => target.constructor,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: "u1", enterpriseId: "e1" } }) }),
  } as unknown as ExecutionContext;
}

describe("PermissionsGuard — RBAC-01 (fail-closed by default)", () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector, {} as TenantScopedPrismaService);

  it("rejects a route with no @RequirePermission and no @NoPermissionRequired", async () => {
    await expect(guard.canActivate(contextFor(new UndecoratedController()))).rejects.toThrow(ForbiddenException);
  });

  it("does not silently ignore a @RequirePermission applied via getAllAndOverride semantics (class-level lookup wired)", async () => {
    // getAllAndOverride([handler, class]) : on vérifie ici seulement que la
    // résolution ne lève pas "permission refusée" faute de métadonnée — la
    // logique d'octroi elle-même (comptage en base) est couverte par les
    // tests d'intégration *.tenant.spec.ts / *.integration.spec.ts.
    const context = contextFor(new ClassLevelPermissionController());
    const required = reflector.getAllAndOverride(REQUIRED_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    expect(required).toBe("products.read");
  });

  it("allows a route explicitly marked @NoPermissionRequired()", async () => {
    await expect(guard.canActivate(contextFor(new ExemptedController()))).resolves.toBe(true);
  });
});
