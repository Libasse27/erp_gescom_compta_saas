import { readFileSync } from "node:fs";
import { join } from "node:path";

// Corrige BIL-21 (docs/audit/BILLING-AUDIT.md) : constat positif confirmé —
// aucun champ Float/Decimal dans le schéma aujourd'hui, tous les montants en
// Int (CLAUDE.md §7). Ce test verrouille cet acquis : il fait échouer la CI
// si un futur champ Prisma est déclaré Float ou Decimal, avant même toute
// migration.
//
// Reconnaît uniquement une déclaration de champ Prisma (`nomChamp Type`,
// éventuellement suivi de `?`/`[]` puis d'attributs `@...`) — jamais un
// simple mot "Float"/"Decimal" trouvé n'importe où dans le fichier (un
// commentaire mentionnant ces mots, ou un attribut comme `@db.Decimal(...)`
// sur un champ dont le type Prisma reste `Int`, ne doivent jamais déclencher
// ce garde). Les lignes de commentaire (`//`, `///`) et les en-têtes de bloc
// (`model`/`enum`/`datasource`/`generator`/`type`/`view`) sont exclus.
//
// Fichier placé sous src/ (pas apps/api/prisma/) : jest.config.js fixe
// `rootDir: "src"`, un *.spec.ts en dehors n'y serait jamais découvert.

const SCHEMA_PATH = join(__dirname, "..", "..", "prisma", "schema.prisma");
const BLOCK_KEYWORDS = new Set(["model", "enum", "datasource", "generator", "type", "view"]);
const FORBIDDEN_MONEY_TYPES = new Set(["Float", "Decimal"]);

// Un champ candidat, jamais un en-tête de bloc, un attribut de bloc (@@...)
// ni une valeur d'enum isolée (un seul token, sans type derrière).
const FIELD_DECLARATION_PATTERN = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\?|\[\])?/;

interface ParsedField {
  line: number;
  name: string;
  type: string;
}

function stripComment(rawLine: string): string {
  const commentIndex = rawLine.indexOf("//");
  return commentIndex === -1 ? rawLine : rawLine.slice(0, commentIndex);
}

function parseFieldDeclarations(schemaText: string): ParsedField[] {
  const fields: ParsedField[] = [];
  const lines = schemaText.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = stripComment(lines[i]!).trim();
    if (line.length === 0 || line.startsWith("@@") || line === "}") continue;

    const match = FIELD_DECLARATION_PATTERN.exec(line);
    if (!match) continue;

    const [, name, type] = match;
    if (BLOCK_KEYWORDS.has(name!)) continue; // en-tête de bloc, ex: "model Payment {"

    fields.push({ line: i + 1, name: name!, type: type! });
  }

  return fields;
}

describe("Money fields never use Float/Decimal in schema.prisma (BIL-21)", () => {
  const schemaText = readFileSync(SCHEMA_PATH, "utf8");
  const fields = parseFieldDeclarations(schemaText);

  it("actually analyzed a realistic number of field declarations (sanity check against a silently broken parser)", () => {
    // Seuil délibérément bas par rapport au compte réel (~300+ aujourd'hui) :
    // suffisant pour détecter un parseur cassé qui ne trouverait presque
    // rien, sans que ce test doive être retouché à chaque évolution normale
    // du schéma.
    expect(fields.length).toBeGreaterThan(200);
  });

  it("never declares a field of type Float or Decimal", () => {
    const offenders = fields.filter((f) => FORBIDDEN_MONEY_TYPES.has(f.type));
    expect(offenders).toEqual([]);
  });

  it("ignores Float/Decimal mentioned only in comments", () => {
    const commentedOut = parseFieldDeclarations("// amount Float\n/// price Decimal\nid String @id\n");
    expect(commentedOut).toHaveLength(1);
    expect(commentedOut[0]).toMatchObject({ name: "id", type: "String" });
  });

  it("still flags a field whose type carries a nullable/array marker or trailing attributes", () => {
    const withAttributes = parseFieldDeclarations(
      "amount Decimal?\nprice Decimal @db.Decimal(10, 2)\nquantity Float[]\n",
    );
    const offenders = withAttributes.filter((f) => FORBIDDEN_MONEY_TYPES.has(f.type));
    expect(offenders).toHaveLength(3);
  });
});
