import { apiFetch } from "../api";
import {
  incrementRetry,
  insertMutation,
  listMutations as listAllMutations,
  listPendingMutations,
  markMutationDone,
  markMutationFailed,
  markMutationPending,
  markMutationProcessing,
} from "./db";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue } from "./mutation-queue";
import type { QueuedMutation } from "./types";

jest.mock("../api");
// Factory explicite : un jest.mock("./db") sans factory introspecte le
// module réel pour générer l'automock, ce qui exécute son code de haut
// niveau — donc le véritable appel expo-sqlite openDatabaseSync() — avant
// même que le mock ne le remplace. db.ts n'est jamais chargé pour de vrai.
jest.mock("./db", () => ({
  insertMutation: jest.fn(),
  listPendingMutations: jest.fn(),
  listMutations: jest.fn(),
  markMutationDone: jest.fn(),
  markMutationFailed: jest.fn(),
  markMutationPending: jest.fn(),
  markMutationProcessing: jest.fn(),
  incrementRetry: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockInsertMutation = insertMutation as jest.MockedFunction<typeof insertMutation>;
const mockListAllMutations = listAllMutations as jest.MockedFunction<typeof listAllMutations>;
const mockListPendingMutations = listPendingMutations as jest.MockedFunction<typeof listPendingMutations>;
const mockMarkMutationDone = markMutationDone as jest.MockedFunction<typeof markMutationDone>;
const mockMarkMutationFailed = markMutationFailed as jest.MockedFunction<typeof markMutationFailed>;
const mockMarkMutationPending = markMutationPending as jest.MockedFunction<typeof markMutationPending>;
const mockMarkMutationProcessing = markMutationProcessing as jest.MockedFunction<typeof markMutationProcessing>;
const mockIncrementRetry = incrementRetry as jest.MockedFunction<typeof incrementRetry>;

function makeMutation(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: 1,
    method: "POST",
    path: "/customers",
    body: { name: "Test" },
    scope: "tenant",
    status: "pending",
    retryCount: 0,
    lastError: null,
    idempotencyKey: "test-idempotency-key",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function response(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  mockListPendingMutations.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("enqueueMutation", () => {
  it("persiste la mutation via insertMutation, sans ID généré côté client", async () => {
    mockInsertMutation.mockResolvedValueOnce(makeMutation({ id: 7 }));

    const result = await enqueueMutation({ method: "POST", path: "/customers", body: { name: "Test" } });

    expect(mockInsertMutation).toHaveBeenCalledWith({ method: "POST", path: "/customers", body: { name: "Test" } });
    expect(result.id).toBe(7);
  });

  it.each(["https://evil.example.com/customers", "/customers/../../auth/logout", "/customers//1", "customers"])(
    "rejette un chemin invalide sans jamais toucher insertMutation : %s",
    async (path) => {
      await expect(enqueueMutation({ method: "POST", path })).rejects.toThrow();
      expect(mockInsertMutation).not.toHaveBeenCalled();
    },
  );
});

describe("processQueue", () => {
  it("rejoue les mutations en attente dans l'ordre FIFO", async () => {
    const first = makeMutation({ id: 1, path: "/customers" });
    const second = makeMutation({ id: 2, path: "/customers/1" });
    mockListPendingMutations.mockResolvedValueOnce([first, second]);
    mockApiFetch.mockResolvedValue(response(200));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/customers", expect.anything());
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/customers/1", expect.anything());
    expect(mockMarkMutationDone).toHaveBeenCalledWith(1);
    expect(mockMarkMutationDone).toHaveBeenCalledWith(2);
  });

  it("rejoue des mutations déjà persistées sans dépendre d'un enqueue dans le même process (survie à un kill de l'app)", async () => {
    // Représente une ligne déjà en base avant même l'import de ce module —
    // aucun enqueueMutation() n'est appelé dans ce test.
    const survivor = makeMutation({ id: 42, path: "/products", retryCount: 2 });
    mockListPendingMutations.mockResolvedValueOnce([survivor]);
    mockApiFetch.mockResolvedValueOnce(response(200));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockMarkMutationDone).toHaveBeenCalledWith(42);
  });

  it("attache le jeton d'accès injecté en en-tête Authorization", async () => {
    const mutation = makeMutation({ id: 1 });
    mockListPendingMutations.mockResolvedValueOnce([mutation]);
    mockApiFetch.mockResolvedValueOnce(response(200));

    await processQueue({ getAccessToken: () => "live-token" });

    expect(mockApiFetch).toHaveBeenCalledWith(
      mutation.path,
      expect.objectContaining({
        headers: { Authorization: "Bearer live-token", "Idempotency-Key": mutation.idempotencyKey },
      }),
    );
  });

  // Régression MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) : la clé doit
  // rester strictement identique à travers les rejeux d'une même ligne — un
  // rejeu avec une clé différente équivaudrait à aucune protection.
  it("envoie la même clé Idempotency-Key sur chaque tentative de rejeu d'une même mutation", async () => {
    const mutation = makeMutation({ id: 1, retryCount: 0, idempotencyKey: "stable-key-123" });
    mockListPendingMutations.mockResolvedValueOnce([mutation]);
    mockApiFetch.mockResolvedValueOnce(response(500));
    mockListPendingMutations.mockResolvedValueOnce([mutation]);
    mockApiFetch.mockResolvedValueOnce(response(200));

    await processQueue({ getAccessToken: () => "live-token" });
    // Backoff pour le 1er retry : min(2^1 * 2000ms, 60000ms) = 4000ms.
    await jest.advanceTimersByTimeAsync(4000);

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    for (const call of mockApiFetch.mock.calls) {
      expect(call).toEqual([
        mutation.path,
        expect.objectContaining({ headers: expect.objectContaining({ "Idempotency-Key": "stable-key-123" }) }),
      ]);
    }
  });

  it("n'appelle pas l'API si aucun jeton d'accès n'est disponible", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1 })]);

    await processQueue({ getAccessToken: () => null });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("laisse la mutation pending et arrête la file si le réseau échoue (fetch qui lève)", async () => {
    const first = makeMutation({ id: 1 });
    const second = makeMutation({ id: 2 });
    mockListPendingMutations.mockResolvedValueOnce([first, second]);
    mockApiFetch.mockRejectedValueOnce(new Error("Network request failed"));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockMarkMutationPending).toHaveBeenCalledWith(1);
    expect(mockMarkMutationFailed).not.toHaveBeenCalled();
    expect(mockIncrementRetry).not.toHaveBeenCalled();
    // La mutation 2 n'a jamais été tentée : l'ordre FIFO ne doit pas être
    // contourné en sautant une mutation bloquée par une panne réseau.
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("remet la mutation en pending sans incrémenter retryCount et arrête la file sur 401", async () => {
    const first = makeMutation({ id: 1, retryCount: 2 });
    const second = makeMutation({ id: 2 });
    mockListPendingMutations.mockResolvedValueOnce([first, second]);
    mockApiFetch.mockResolvedValueOnce(response(401));

    await processQueue({ getAccessToken: () => "expired-token" });

    expect(mockMarkMutationPending).toHaveBeenCalledWith(1);
    expect(mockMarkMutationFailed).not.toHaveBeenCalled();
    expect(mockIncrementRetry).not.toHaveBeenCalled();
    // Un jeton expiré n'est pas un rejet métier de cette mutation précise :
    // pas de sens à tenter la suivante avec le même jeton mort.
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("passe immédiatement en échec terminal sur une erreur métier 4xx, sans retry", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1 })]);
    mockApiFetch.mockResolvedValueOnce(response(422));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockMarkMutationFailed).toHaveBeenCalledWith(1, expect.stringContaining("422"));
    expect(mockIncrementRetry).not.toHaveBeenCalled();
  });

  it("conserve le message d'erreur du corps de la réponse sur un rejet 4xx métier (ex: conflit 409 produit)", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1, path: "/products" })]);
    mockApiFetch.mockResolvedValueOnce(response(409, { message: "Ce code produit est déjà utilisé" }));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockMarkMutationFailed).toHaveBeenCalledWith(1, "Ce code produit est déjà utilisé");
  });

  it("incrémente retryCount et programme un nouvel essai sous le maximum de tentatives transitoires", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1, retryCount: 0 })]);
    mockApiFetch.mockResolvedValueOnce(response(500));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockIncrementRetry).toHaveBeenCalledWith(1, expect.stringContaining("500"));
    expect(mockMarkMutationFailed).not.toHaveBeenCalled();
  });

  it("passe en échec terminal après le nombre maximal de tentatives transitoires", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1, retryCount: 4 })]);
    mockApiFetch.mockResolvedValueOnce(response(503));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockMarkMutationFailed).toHaveBeenCalledWith(1, expect.stringContaining("503"));
    expect(mockIncrementRetry).not.toHaveBeenCalled();
  });

  it("n'expose jamais le corps d'une réponse 5xx, même s'il contient un message (revue sécurité Phase 9.2/9.6)", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1, retryCount: 4 })]);
    mockApiFetch.mockResolvedValueOnce(response(503, { message: "stack trace interne non maîtrisée" }));

    await processQueue({ getAccessToken: () => "token" });

    const [, message] = mockMarkMutationFailed.mock.calls[0]!;
    expect(message).not.toContain("stack trace");
    expect(message).toContain("503");
  });

  it("programme le nouvel essai après un backoff, sans bloquer indéfiniment", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1, retryCount: 0 })]);
    mockApiFetch.mockResolvedValueOnce(response(500));
    mockListPendingMutations.mockResolvedValueOnce([]);

    await processQueue({ getAccessToken: () => "token" });
    expect(mockListPendingMutations).toHaveBeenCalledTimes(1);

    // Backoff pour le 1er retry : min(2^1 * 2000ms, 60000ms) = 4000ms.
    await jest.advanceTimersByTimeAsync(4000);

    expect(mockListPendingMutations).toHaveBeenCalledTimes(2);
  });

  it("marque la mutation 'processing' avant de tenter le rejeu", async () => {
    mockListPendingMutations.mockResolvedValueOnce([makeMutation({ id: 1 })]);
    mockApiFetch.mockResolvedValueOnce(response(200));

    await processQueue({ getAccessToken: () => "token" });

    expect(mockMarkMutationProcessing).toHaveBeenCalledWith(1);
  });
});

describe("assertMutationSucceeded", () => {
  it("ne lève rien si la mutation n'est plus dans la file (rejouée avec succès)", async () => {
    mockListAllMutations.mockResolvedValueOnce([]);

    await expect(assertMutationSucceeded(1)).resolves.toBeUndefined();
  });

  it("ne lève rien si la mutation est encore pending (pas encore confirmée)", async () => {
    mockListAllMutations.mockResolvedValueOnce([makeMutation({ id: 1, status: "pending" })]);

    await expect(assertMutationSucceeded(1)).resolves.toBeUndefined();
  });

  it("lève MutationRejectedError si la mutation est en échec terminal", async () => {
    mockListAllMutations.mockResolvedValue([makeMutation({ id: 1, status: "failed", lastError: "HTTP 403" })]);

    await expect(assertMutationSucceeded(1)).rejects.toThrow(MutationRejectedError);
    await expect(assertMutationSucceeded(1)).rejects.toThrow("HTTP 403");
  });
});
