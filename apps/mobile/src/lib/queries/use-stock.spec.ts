import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CreateStockMovementInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue, useIsOnline } from "../offline";
import type { QueuedMutation } from "../offline";
import { useCreateStockMovement, useStockLevels, useStockMovements } from "./use-stock";

jest.mock("../api");
// Factories explicites : sans elles, jest.mock introspecte les modules
// réels — auth-context.tsx et offline/index.ts importent tous deux ./db
// transitivement (real expo-sqlite openDatabaseSync() au chargement).
jest.mock("../auth-context", () => ({
  useAuth: jest.fn(),
}));
jest.mock("../offline", () => ({
  assertMutationSucceeded: jest.fn(),
  enqueueMutation: jest.fn(),
  MutationRejectedError: class MutationRejectedError extends Error {},
  processQueue: jest.fn(),
  useIsOnline: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockAssertMutationSucceeded = assertMutationSucceeded as jest.MockedFunction<typeof assertMutationSucceeded>;
const mockEnqueueMutation = enqueueMutation as jest.MockedFunction<typeof enqueueMutation>;
const mockProcessQueue = processQueue as jest.MockedFunction<typeof processQueue>;
const mockUseIsOnline = useIsOnline as jest.MockedFunction<typeof useIsOnline>;

function mockAuth(status: "loading" | "authenticated" | "unauthenticated", accessToken: string | null = null) {
  mockUseAuth.mockReturnValue({
    status,
    accessToken,
    user: null,
    login: jest.fn(),
    verifyMfa: jest.fn(),
    logout: jest.fn(),
  });
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function makeQueuedMutation(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: 1,
    method: "POST",
    path: "/stock/movements",
    body: undefined,
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

const SAMPLE_VALUES: CreateStockMovementInput = {
  productId: "11111111-1111-1111-1111-111111111111",
  type: "IN",
  quantity: 10,
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertMutationSucceeded.mockResolvedValue(undefined);
});

describe("useStockLevels", () => {
  it("construit les paramètres de requête depuis les filtres", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => useStockLevels({ page: 1, pageSize: 20, search: "PRD-001" }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=20");
    expect(path).toContain("search=PRD-001");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useStockLevels({ page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useStockLevels({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useStockMovements", () => {
  it("récupère l'historique paginé d'un produit", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => useStockMovements({ productId: "p1", page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledWith("/stock/p1/movements?page=1&pageSize=20", expect.anything());
  });

  it("encode l'id produit dans le chemin", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => useStockMovements({ productId: "p/1 x", page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain(encodeURIComponent("p/1 x"));
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useStockMovements({ productId: "p1", page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

describe("useCreateStockMovement", () => {
  it("enqueue une création (POST /stock/movements) puis rejoue et invalide si en ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useCreateStockMovement(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: "/stock/movements",
      body: SAMPLE_VALUES,
    });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useCreateStockMovement(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  // Le message réel (409 "Stock insuffisant" ou 403 générique) est propagé
  // tel quel par assertMutationSucceeded — ce hook ne le transforme ni ne
  // l'avale ; ce n'est pas un test de la lecture du corps de la réponse HTTP
  // (couvert par mutation-queue.spec.ts), seulement de la non-absorption du
  // rejet à ce niveau (revue sécurité Phase 9.6/9.7).
  it.each([
    ["Stock insuffisant", "Stock insuffisant"],
    ["HTTP 403", "HTTP 403"],
  ])(
    "propage le rejet serveur (%s) plutôt que de le traiter comme un succès",
    async (rejectionMessage, expectedMessage) => {
      mockAuth("authenticated", "access-1");
      mockUseIsOnline.mockReturnValue(true);
      mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
      mockProcessQueue.mockResolvedValueOnce(undefined);
      mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError(rejectionMessage));

      const { result } = await renderHook(() => useCreateStockMovement(), { wrapper });

      await act(async () => {
        await expect(result.current(SAMPLE_VALUES)).rejects.toThrow(expectedMessage);
      });

      expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
    },
  );
});
