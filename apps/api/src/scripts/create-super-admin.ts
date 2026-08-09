import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { passwordSchema } from "@erp/validation";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../auth/password.service";
import { MfaService } from "../auth/mfa.service";

// Seul moyen de créer un compte Super Admin — aucune route HTTP ne le
// permet (docs/PROMPT-MAITRE-SAAS.md, Phase 2, Test 5 ; CLAUDE.md §6).
// La MFA est activée dès la création : un Super Admin sans MFA ne peut
// jamais se connecter (voir AuthService.login).

export interface CreateSuperAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface CreateSuperAdminDeps {
  prisma: Pick<PrismaService, "user">;
  passwordService: PasswordService;
  mfaService: MfaService;
}

export interface CreateSuperAdminResult {
  userId: string;
  provisioningUri: string;
}

export async function createSuperAdmin(
  deps: CreateSuperAdminDeps,
  input: CreateSuperAdminInput,
): Promise<CreateSuperAdminResult> {
  const parsedPassword = passwordSchema.safeParse(input.password);
  if (!parsedPassword.success) {
    throw new Error(`Mot de passe invalide : ${parsedPassword.error.issues.map((issue) => issue.message).join(", ")}`);
  }

  const existing = await deps.prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new Error(`Un compte existe déjà avec l'email ${input.email}`);
  }

  const mfaSecret = deps.mfaService.generateSecret();
  const passwordHash = await deps.passwordService.hash(input.password);

  const user = await deps.prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      isSuperAdmin: true,
      enterpriseId: null,
      status: "ACTIVE",
      mfaEnabled: true,
      mfaSecret: deps.mfaService.encryptSecret(mfaSecret),
      emailVerifiedAt: new Date(),
    },
  });

  return { userId: user.id, provisioningUri: deps.mfaService.provisioningUri(mfaSecret, input.email) };
}

function parseArgs(argv: string[]): CreateSuperAdminInput {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index !== -1 ? argv[index + 1] : undefined;
  };

  const email = get("--email");
  const password = get("--password");
  const firstName = get("--first-name");
  const lastName = get("--last-name");

  if (!email || !password || !firstName || !lastName) {
    throw new Error(
      "Usage : pnpm create-super-admin --email <email> --password <password> --first-name <prenom> --last-name <nom>",
    );
  }

  return { email, password, firstName, lastName };
}

async function run(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const result = await createSuperAdmin(
      {
        prisma: app.get(PrismaService),
        passwordService: app.get(PasswordService),
        mfaService: app.get(MfaService),
      },
      input,
    );

    console.log(`Super Admin créé : ${result.userId} (${input.email})`);
    console.log("");
    console.log("Configurez votre application d'authentification (Google Authenticator, 1Password, ...)");
    console.log("avec cette URI — elle ne sera plus jamais affichée :");
    console.log(result.provisioningUri);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
