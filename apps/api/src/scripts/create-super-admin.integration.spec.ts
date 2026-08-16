import { authenticator } from "otplib";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { MfaService } from "../auth/mfa.service";
import { createSuperAdmin } from "./create-super-admin";

describe("createSuperAdmin (integration)", () => {
  const prisma = new RawDbClient();
  const passwordService = new PasswordService();
  const mfaService = new MfaService();
  const deps = { prisma, passwordService, mfaService };

  const createdUserIds: string[] = [];

  beforeAll(() => {
    process.env.MFA_ENCRYPTION_KEY ??= "integration-test-mfa-encryption-key";
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it("creates a Super Admin with MFA already enabled and no enterprise", async () => {
    const email = `super-${randomUUID()}@platform.test`;

    const result = await createSuperAdmin(deps, {
      email,
      password: "SuperSecretPassw0rd!",
      firstName: "Super",
      lastName: "Admin",
    });
    createdUserIds.push(result.userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.isSuperAdmin).toBe(true);
    expect(user.enterpriseId).toBeNull();
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).not.toBeNull();
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerifiedAt).not.toBeNull();

    // L'URI de provisioning contient bien le secret déchiffrable stocké en base.
    const storedSecret = mfaService.decryptSecret(user.mfaSecret!);
    const code = authenticator.generate(storedSecret);
    expect(mfaService.verifyCode(storedSecret, code)).toBe(true);
    expect(result.provisioningUri).toContain(encodeURIComponent(email));
  });

  it("rejects a password that fails the shared password policy, without creating a row", async () => {
    const email = `super-${randomUUID()}@platform.test`;

    await expect(
      createSuperAdmin(deps, { email, password: "weak", firstName: "Super", lastName: "Admin" }),
    ).rejects.toThrow(/Mot de passe invalide/);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it("rejects creating a second account with the same email", async () => {
    const email = `super-${randomUUID()}@platform.test`;
    const first = await createSuperAdmin(deps, {
      email,
      password: "SuperSecretPassw0rd!",
      firstName: "Super",
      lastName: "Admin",
    });
    createdUserIds.push(first.userId);

    await expect(
      createSuperAdmin(deps, { email, password: "AnotherPassword9!", firstName: "Super", lastName: "Admin2" }),
    ).rejects.toThrow(/existe déjà/);
  });
});
