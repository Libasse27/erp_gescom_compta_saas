import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Corrige BIL-20 (docs/audit/BILLING-AUDIT.md) : `assertSubscriptionTransition`
// n'est structurellement rien de plus qu'une fonction ordinaire — rien
// n'empêche un futur développeur d'écrire `subscription.update({ data: {
// status } })` en la contournant. Même patron que auth-throttling.spec.ts
// (BIL-14) : découverte dynamique par lecture du système de fichiers,
// aucune liste manuelle de fichiers à tenir à jour. Deux invariants, parce
// que le dépôt a deux formes légitimes d'écriture (voir
// subscription-lifecycle.service.ts et payments-webhook.service.ts) :
//
//   A. une écriture directe `.subscription.update(Many)({ data: { status } })`
//      doit être précédée, dans le même fichier, d'un appel
//      assertSubscriptionTransition(...) — sauf la primitive CAS
//      `updateSubscriptionStatus` elle-même (cross-tenant.repository.ts),
//      qui reporte délibérément la garde à ses appelants (BIL-03 : elle est
//      appelée depuis un batch en mémoire, l'assertion doit se faire avant
//      l'appel, pas dans la primitive générique) ;
//   B. tout appel à cette primitive (`.updateSubscriptionStatus(`) doit à
//      son tour être précédé, dans le fichier appelant, d'un
//      assertSubscriptionTransition(...).
//
// Un futur écrivain non gardé — direct ou via la primitive — fait échouer
// ce test, quel que soit le fichier où il apparaît.

const SRC_DIR = join(__dirname, "..");

// Fenêtre de proximité généreuse (quelques lignes de code/commentaires),
// assez étroite pour exiger une garde réellement immédiate plutôt qu'un
// appel sans rapport situé plus haut dans un gros fichier.
const GUARD_PROXIMITY_CHARS = 800;

interface SourceFile {
  path: string;
  relativePath: string;
  content: string;
}

function collectSourceFiles(dir: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      files.push({ path: fullPath, relativePath: relative(SRC_DIR, fullPath), content: readFileSync(fullPath, "utf8") });
    }
  }
  return files;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

// Extrait le texte entre une parenthèse/accolade ouvrante à `openIndex` et
// sa fermante correspondante, par comptage de profondeur (suffisant ici :
// le code source ne contient pas de parenthèses/accolades non équilibrées
// dans des chaînes/commentaires au point d'appel de ces primitives).
function extractBalanced(content: string, openIndex: number, openChar: string, closeChar: string): string {
  let depth = 0;
  for (let i = openIndex; i < content.length; i += 1) {
    if (content[i] === openChar) depth += 1;
    else if (content[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return content.slice(openIndex, i + 1);
    }
  }
  throw new Error(`Parenthèse/accolade non équilibrée à partir de l'index ${openIndex}`);
}

function hasNearbyGuard(content: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - GUARD_PROXIMITY_CHARS);
  return content.slice(windowStart, matchIndex).includes("assertSubscriptionTransition(");
}

function nearestEnclosingMethodName(content: string, matchIndex: number): string | undefined {
  const before = content.slice(0, matchIndex);
  const methodDeclPattern = /\n {2}(?:private |protected |public |async )*([a-zA-Z_][\w]*)\s*\(/g;
  let name: string | undefined;
  for (const match of before.matchAll(methodDeclPattern)) {
    name = match[1];
  }
  return name;
}

describe("Subscription.status write guard (BIL-20)", () => {
  const sourceFiles = collectSourceFiles(SRC_DIR);

  // A. Écritures directes `.subscription.update(Many)(...)` contenant
  // `status` dans leur objet `data`.
  const directWrites: { relativePath: string; line: number; enclosingMethod: string | undefined; guarded: boolean }[] = [];

  const callPattern = /\.subscription\.(update|updateMany)\s*\(/g;

  for (const file of sourceFiles) {
    for (const match of file.content.matchAll(callPattern)) {
      const openParenIndex = match.index! + match[0].length - 1;
      const callArgs = extractBalanced(file.content, openParenIndex, "(", ")");

      const dataKeyMatch = /data\s*:\s*\{/.exec(callArgs);
      if (!dataKeyMatch) continue;
      const dataObjectOpenIndex = dataKeyMatch.index + dataKeyMatch[0].length - 1;
      const dataObject = extractBalanced(callArgs, dataObjectOpenIndex, "{", "}");

      if (!/(?<![A-Za-z0-9_])status\s*:/.test(dataObject)) continue;

      const enclosingMethod = nearestEnclosingMethodName(file.content, match.index!);
      // La primitive CAS elle-même reporte délibérément la garde à
      // l'appelant (voir invariant B ci-dessous) — ce n'est pas une
      // exception ad hoc par fichier, mais par identité de méthode.
      if (enclosingMethod === "updateSubscriptionStatus") continue;

      directWrites.push({
        relativePath: file.relativePath,
        line: lineOf(file.content, match.index!),
        enclosingMethod,
        guarded: hasNearbyGuard(file.content, match.index!),
      });
    }
  }

  it("finds the currently known direct write sites (sanity check against a silently broken scanner)", () => {
    // Preuve que le scanner fonctionne réellement, sans figer une liste de
    // fichiers autorisés : si ce nombre change, c'est le signal qu'un
    // écrivain a été ajouté ou retiré — à vérifier manuellement, pas une
    // liste blanche que ce test maintiendrait pour vous.
    expect(directWrites).toHaveLength(1);
    expect(directWrites[0]!.relativePath).toBe(join("payments", "payments-webhook.service.ts"));
  });

  it("never finds an unguarded direct write of Subscription.status", () => {
    const unguarded = directWrites.filter((w) => !w.guarded);
    expect(unguarded).toEqual([]);
  });

  // B. Tout appel à la primitive CAS `updateSubscriptionStatus` doit à son
  // tour être gardé dans le fichier appelant.
  const casCallPattern = /\.updateSubscriptionStatus\(/g;
  const casCallSites: { relativePath: string; line: number; guarded: boolean }[] = [];

  for (const file of sourceFiles) {
    for (const match of file.content.matchAll(casCallPattern)) {
      casCallSites.push({
        relativePath: file.relativePath,
        line: lineOf(file.content, match.index!),
        guarded: hasNearbyGuard(file.content, match.index!),
      });
    }
  }

  it("finds the currently known caller(s) of the updateSubscriptionStatus CAS primitive", () => {
    expect(casCallSites).toHaveLength(1);
    expect(casCallSites[0]!.relativePath).toBe(join("subscriptions", "subscription-lifecycle.service.ts"));
  });

  it("never finds an unguarded call to the updateSubscriptionStatus CAS primitive", () => {
    const unguarded = casCallSites.filter((c) => !c.guarded);
    expect(unguarded).toEqual([]);
  });
});
