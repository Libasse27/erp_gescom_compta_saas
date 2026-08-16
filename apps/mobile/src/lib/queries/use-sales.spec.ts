import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CreateSaleInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue, useIsOnline } from "../offline";
import type { QueuedMutation } from "../offline";
import { useCancelSale, useConfirmSale, useCreateSale, useSale, useSales } from "./use-sales";

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
    path: "/sales",
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

const SAMPLE_VALUES: CreateSaleInput = {
  customerId: "11111111-1111-1111-1111-111111111111",
  lines: [{ productId: "22222222-2222-2222-2222-222222222222", quantity: 2 }],
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertMutationSucceeded.mockResolvedValue(undefined);
});

describe("useSales", () => {
  it("construit les paramètres de requête depuis les filtres", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => useSales({ page: 1, pageSize: 20, search: "sonatel", status: "DRAFT" }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=20");
    expect(path).toContain("search=sonatel");
    expect(path).toContain("status=DRAFT");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useSales({ page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useSales({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useSale", () => {
  it("ne lance rien sans id", async () => {
    mockAuth("authenticated", "access-1");

    await renderHook(() => useSale(undefined), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("récupère la fiche par id, encodée dans le chemin", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { id: "s1", status: "DRAFT", lines: [] }));

    const { result } = await renderHook(() => useSale("s/1 x"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith(`/sales/${encodeURIComponent("s/1 x")}`, expect.anything());
  });
});

describe("useCreateSale", () => {
  it("enqueue une création (POST /sales) puis rejoue et invalide si en ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useCreateSale(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({ method: "POST", path: "/sales", body: SAMPLE_VALUES });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useCreateSale(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("propage le rejet serveur plutôt que de le traiter comme un succès (revue sécurité)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("HTTP 403"));

    const { result } = await renderHook(() => useCreateSale(), { wrapper });

    await act(async () => {
      await expect(result.current(SAMPLE_VALUES)).rejects.toThrow("HTTP 403");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useConfirmSale", () => {
  it("enqueue une confirmation (POST /sales/:id/confirm, id encodé) puis invalide ventes ET stock", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ path: "/sales/s1/confirm" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useConfirmSale(), { wrapper });
    await act(async () => {
      await result.current("s/1 x");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: `/sales/${encodeURIComponent("s/1 x")}/confirm`,
    });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("propage le message d'erreur réel du serveur sur un stock insuffisant (409), pas juste 'HTTP 409'", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("Stock insuffisant"));

    const { result } = await renderHook(() => useConfirmSale(), { wrapper });

    await act(async () => {
      await expect(result.current("s1")).rejects.toThrow("Stock insuffisant");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useCancelSale", () => {
  it("enqueue une annulation (POST /sales/:id/cancel, id encodé)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ path: "/sales/s1/cancel" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useCancelSale(), { wrapper });
    await act(async () => {
      await result.current("s/1 x");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: `/sales/${encodeURIComponent("s/1 x")}/cancel`,
    });
  });

  it("propage le message d'erreur réel du serveur sur une annulation hors brouillon (400)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(
      new MutationRejectedError("Seule une vente en brouillon peut être annulée"),
    );

    const { result } = await renderHook(() => useCancelSale(), { wrapper });

    await act(async () => {
      await expect(result.current("s1")).rejects.toThrow("Seule une vente en brouillon peut être annulée");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useCancelSale(), { wrapper });
    await act(async () => {
      await result.current("s1");
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });
});
