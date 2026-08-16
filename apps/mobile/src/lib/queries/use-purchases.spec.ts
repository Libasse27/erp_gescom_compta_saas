import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CreatePurchaseInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue, useIsOnline } from "../offline";
import type { QueuedMutation } from "../offline";
import { useCancelPurchase, useConfirmPurchase, useCreatePurchase, usePurchase, usePurchases } from "./use-purchases";

jest.mock("../api");
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
    path: "/purchases",
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

const SAMPLE_VALUES: CreatePurchaseInput = {
  supplierId: "11111111-1111-1111-1111-111111111111",
  lines: [{ productId: "22222222-2222-2222-2222-222222222222", quantity: 2, unitCostExcludingTax: 5_000 }],
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertMutationSucceeded.mockResolvedValue(undefined);
});

describe("usePurchases", () => {
  it("construit les paramètres de requête depuis les filtres", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => usePurchases({ page: 1, pageSize: 20, search: "quincaillerie", status: "DRAFT" }), {
      wrapper,
    });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=20");
    expect(path).toContain("search=quincaillerie");
    expect(path).toContain("status=DRAFT");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => usePurchases({ page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => usePurchases({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("usePurchase", () => {
  it("ne lance rien sans id", async () => {
    mockAuth("authenticated", "access-1");

    await renderHook(() => usePurchase(undefined), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("récupère la fiche par id, encodée dans le chemin", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { id: "p1", status: "DRAFT", lines: [] }));

    const { result } = await renderHook(() => usePurchase("p/1 x"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith(`/purchases/${encodeURIComponent("p/1 x")}`, expect.anything());
  });
});

describe("useCreatePurchase", () => {
  it("enqueue une création (POST /purchases) puis rejoue et invalide si en ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useCreatePurchase(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({ method: "POST", path: "/purchases", body: SAMPLE_VALUES });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useCreatePurchase(), { wrapper });
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

    const { result } = await renderHook(() => useCreatePurchase(), { wrapper });

    await act(async () => {
      await expect(result.current(SAMPLE_VALUES)).rejects.toThrow("HTTP 403");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useConfirmPurchase", () => {
  it("enqueue une confirmation (POST /purchases/:id/confirm, id encodé) puis invalide achats ET stock", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ path: "/purchases/p1/confirm" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useConfirmPurchase(), { wrapper });
    await act(async () => {
      await result.current("p/1 x");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: `/purchases/${encodeURIComponent("p/1 x")}/confirm`,
    });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("propage le message d'erreur réel du serveur sur un rejet de confirmation", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("Achat introuvable"));

    const { result } = await renderHook(() => useConfirmPurchase(), { wrapper });

    await act(async () => {
      await expect(result.current("p1")).rejects.toThrow("Achat introuvable");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useCancelPurchase", () => {
  it("enqueue une annulation (POST /purchases/:id/cancel, id encodé)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ path: "/purchases/p1/cancel" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useCancelPurchase(), { wrapper });
    await act(async () => {
      await result.current("p/1 x");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: `/purchases/${encodeURIComponent("p/1 x")}/cancel`,
    });
  });

  it("propage le message d'erreur réel du serveur sur une annulation hors brouillon (400)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(
      new MutationRejectedError("Seul un achat en brouillon peut être annulé"),
    );

    const { result } = await renderHook(() => useCancelPurchase(), { wrapper });

    await act(async () => {
      await expect(result.current("p1")).rejects.toThrow("Seul un achat en brouillon peut être annulé");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useCancelPurchase(), { wrapper });
    await act(async () => {
      await result.current("p1");
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });
});
