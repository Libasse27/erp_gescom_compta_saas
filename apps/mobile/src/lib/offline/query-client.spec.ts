// query-client.ts déclenche des effets de bord au chargement du module
// (setupOnlineManager(), startPersisting()) — ./network et ./persister sont
// mockés pour que ces effets restent inertes (./persister importe ./db,
// real expo-sqlite openDatabaseSync() au chargement sans ce mock).
jest.mock("./network", () => ({
  setupOnlineManager: jest.fn(),
}));
jest.mock("./persister", () => ({
  sqlitePersister: {
    persistClient: jest.fn().mockResolvedValue(undefined),
    restoreClient: jest.fn().mockResolvedValue(undefined),
    removeClient: jest.fn().mockResolvedValue(undefined),
  },
}));

import { isAllowedToPersist } from "./query-client";

// C'est le seul contrôle qui décide de ce qui atterrit en clair sur
// erp-offline.db (revue sécurité Phase 9.4) — une régression ici doit être
// visible en CI, pas découverte a posteriori.
describe("isAllowedToPersist", () => {
  it("autorise les clés customers (liste et fiche)", () => {
    expect(isAllowedToPersist(["customers"])).toBe(true);
    expect(isAllowedToPersist(["customers", { page: 1, pageSize: 20 }])).toBe(true);
    expect(isAllowedToPersist(["customers", "c1"])).toBe(true);
  });

  it("autorise les clés suppliers (liste et fiche)", () => {
    expect(isAllowedToPersist(["suppliers"])).toBe(true);
    expect(isAllowedToPersist(["suppliers", { page: 1, pageSize: 20 }])).toBe(true);
    expect(isAllowedToPersist(["suppliers", "s1"])).toBe(true);
  });

  it("autorise les clés products (liste et fiche)", () => {
    expect(isAllowedToPersist(["products"])).toBe(true);
    expect(isAllowedToPersist(["products", { page: 1, pageSize: 20 }])).toBe(true);
    expect(isAllowedToPersist(["products", "p1"])).toBe(true);
  });

  it("autorise les clés stock (niveaux et historique de mouvements)", () => {
    expect(isAllowedToPersist(["stock"])).toBe(true);
    expect(isAllowedToPersist(["stock", { page: 1, pageSize: 20 }])).toBe(true);
    expect(isAllowedToPersist(["stock-movements"])).toBe(true);
    expect(isAllowedToPersist(["stock-movements", { productId: "p1", page: 1, pageSize: 20 }])).toBe(true);
  });

  it("autorise le contexte utilisateur (permissions)", () => {
    expect(isAllowedToPersist(["users", "me", "context"])).toBe(true);
  });

  it("refuse un préfixe partiel non exact", () => {
    expect(isAllowedToPersist(["users", "me"])).toBe(false);
    expect(isAllowedToPersist(["users"])).toBe(false);
  });

  it("refuse toute clé hors liste blanche", () => {
    expect(isAllowedToPersist(["auth", "session"])).toBe(false);
    expect(isAllowedToPersist(["offline-mutations"])).toBe(false);
    expect(isAllowedToPersist([])).toBe(false);
  });
});
