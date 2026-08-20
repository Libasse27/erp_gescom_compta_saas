import "reflect-metadata";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PATH_METADATA } from "@nestjs/common/constants";
import { Throttle } from "@nestjs/throttler";
import { AUTH_RATE_LIMIT } from "./rate-limit";
import { ProvisioningController } from "../provisioning/provisioning.controller";

// Corrige BIL-14 (docs/audit/BILLING-AUDIT.md) : le throttling renforcé de
// `/auth/*` (CLAUDE.md §6) reposait uniquement sur la discipline du
// développeur — chaque contrôleur du préfixe `auth` devait penser à porter
// @Throttle(AUTH_RATE_LIMIT) lui-même, sans aucun mécanisme qui le
// garantisse (ProvisioningController l'avait oublié). Ce test découvre
// dynamiquement, à partir du système de fichiers, tous les *.controller.ts
// du dépôt dont @Controller() porte le préfixe "auth" : si un futur
// contrôleur `@Controller("auth/xxx")` est ajouté sans throttling, ce test
// échoue automatiquement, sans qu'aucune liste manuelle n'ait besoin d'être
// tenue à jour.

type NestControllerClass = new (...args: unknown[]) => unknown;

const SRC_DIR = join(__dirname, "..");

function collectControllerFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectControllerFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".controller.ts") && !entry.name.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function isNestController(candidate: unknown): candidate is NestControllerClass {
  return typeof candidate === "function" && Reflect.hasMetadata(PATH_METADATA, candidate);
}

async function findAuthPrefixedControllers(): Promise<NestControllerClass[]> {
  const controllers: NestControllerClass[] = [];
  for (const file of collectControllerFiles(SRC_DIR)) {
    const moduleExports: Record<string, unknown> = await import(file);
    for (const candidate of Object.values(moduleExports)) {
      if (!isNestController(candidate)) {
        continue;
      }
      const path = Reflect.getMetadata(PATH_METADATA, candidate) as string;
      if (path === "auth" || path.startsWith("auth/")) {
        controllers.push(candidate);
      }
    }
  }
  return controllers;
}

// Classe de référence : on ne recopie jamais les clés de métadonnées privées
// de @nestjs/throttler (non exportées par le package) — on demande au
// décorateur lui-même de les poser sur une classe témoin, puis on compare.
class ThrottleReferenceProbe {}
Throttle(AUTH_RATE_LIMIT)(ThrottleReferenceProbe);
const referenceMetadataKeys = Reflect.getMetadataKeys(ThrottleReferenceProbe);

function expectSameThrottling(target: NestControllerClass): void {
  expect(referenceMetadataKeys.length).toBeGreaterThan(0);
  for (const key of referenceMetadataKeys) {
    expect(Reflect.getMetadata(key, target)).toEqual(Reflect.getMetadata(key, ThrottleReferenceProbe));
  }
}

describe("Throttling du préfixe /auth/* (BIL-14)", () => {
  it("découvre au moins les contrôleurs auth et provisioning connus", async () => {
    const controllers = await findAuthPrefixedControllers();
    const names = controllers.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["AuthController", "ProvisioningController"]));
  });

  it("applique AUTH_RATE_LIMIT à tout contrôleur découvert sous le préfixe auth", async () => {
    const controllers = await findAuthPrefixedControllers();
    for (const controller of controllers) {
      expectSameThrottling(controller);
    }
  });

  // Cas nominal explicite, lisible sans comprendre le mécanisme de
  // découverte ci-dessus — demandé par la Definition of Done de BIL-14.
  it("applique explicitement AUTH_RATE_LIMIT à ProvisioningController", () => {
    expectSameThrottling(ProvisioningController);
  });
});
