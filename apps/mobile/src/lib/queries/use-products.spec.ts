import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CreateProductInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue, useIsOnline } from "../offline";
import type { QueuedMutation } from "../offline";
import { useDeactivateProduct, useProduct, useProducts, useSaveProduct } from "./use-products";

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
    path: "/products",
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

const SAMPLE_VALUES: CreateProductInput = {
  code: "PRD-001",
  name: "Nouveau produit",
  unit: "pièce",
  sellingPriceExcludingTax: 5000,
  vatRateBasisPoints: 1800,
  trackStock: true,
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertMutationSucceeded.mockResolvedValue(undefined);
});

describe("useProducts", () => {
  it("construit les paramètres de requête depuis les filtres", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => useProducts({ page: 1, pageSize: 20, search: "PRD-001", isActive: true }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=20");
    expect(path).toContain("search=PRD-001");
    expect(path).toContain("isActive=true");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useProducts({ page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useProducts({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useProduct", () => {
  it("ne lance rien sans id", async () => {
    mockAuth("authenticated", "access-1");

    await renderHook(() => useProduct(undefined), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("récupère la fiche par id", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { id: "p1", name: "Café Touba" }));

    const { result } = await renderHook(() => useProduct("p1"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith("/products/p1", expect.anything());
  });
});

describe("useSaveProduct", () => {
  it("enqueue une création (POST /products) puis rejoue et invalide si en ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useSaveProduct(), { wrapper });
    await act(async () => {
      await result.current({ values: SAMPLE_VALUES });
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({ method: "POST", path: "/products", body: SAMPLE_VALUES });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("enqueue une modification (PATCH /products/:id)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ method: "PATCH" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useSaveProduct(), { wrapper });
    await act(async () => {
      await result.current({ productId: "p1", values: SAMPLE_VALUES });
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/products/p1",
      body: SAMPLE_VALUES,
    });
  });

  it("n'appelle ni processQueue ni invalidateQueries hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useSaveProduct(), { wrapper });
    await act(async () => {
      await result.current({ values: SAMPLE_VALUES });
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("propage le message d'erreur réel du serveur sur un conflit de code produit (409), pas juste 'HTTP 409' (revue sécurité Phase 9.6)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(
      new MutationRejectedError("Ce code produit est déjà utilisé"),
    );

    const { result } = await renderHook(() => useSaveProduct(), { wrapper });

    await act(async () => {
      await expect(result.current({ values: SAMPLE_VALUES })).rejects.toThrow("Ce code produit est déjà utilisé");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });

  it("propage le rejet serveur plutôt que de le traiter comme un succès (revue sécurité)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("HTTP 403"));

    const { result } = await renderHook(() => useSaveProduct(), { wrapper });

    await act(async () => {
      await expect(result.current({ values: SAMPLE_VALUES })).rejects.toThrow("HTTP 403");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useDeactivateProduct", () => {
  it("enqueue une suppression (DELETE /products/:id)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ method: "DELETE" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useDeactivateProduct(), { wrapper });
    await act(async () => {
      await result.current("p1");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({ method: "DELETE", path: "/products/p1" });
  });

  it("propage le rejet serveur plutôt que de le traiter comme un succès (revue sécurité)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 11, method: "DELETE" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("HTTP 403"));

    const { result } = await renderHook(() => useDeactivateProduct(), { wrapper });

    await act(async () => {
      await expect(result.current("p1")).rejects.toThrow("HTTP 403");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(11);
  });
});
