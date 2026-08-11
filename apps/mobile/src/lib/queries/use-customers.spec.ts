import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CreateCustomerInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue, useIsOnline } from "../offline";
import type { QueuedMutation } from "../offline";
import { useCustomer, useCustomers, useDeactivateCustomer, useSaveCustomer } from "./use-customers";

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
    path: "/customers",
    body: undefined,
    scope: "tenant",
    status: "pending",
    retryCount: 0,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const SAMPLE_VALUES: CreateCustomerInput = {
  type: "COMPANY",
  name: "Nouveau client",
  country: "Sénégal",
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertMutationSucceeded.mockResolvedValue(undefined);
});

describe("useCustomers", () => {
  it("construit les paramètres de requête depuis les filtres", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => useCustomers({ page: 1, pageSize: 20, search: "dupont", isActive: true }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=20");
    expect(path).toContain("search=dupont");
    expect(path).toContain("isActive=true");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useCustomers({ page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useCustomers({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCustomer", () => {
  it("ne lance rien sans id", async () => {
    mockAuth("authenticated", "access-1");

    await renderHook(() => useCustomer(undefined), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("récupère la fiche par id", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { id: "c1", name: "Dupont" }));

    const { result } = await renderHook(() => useCustomer("c1"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith("/customers/c1", expect.anything());
  });
});

describe("useSaveCustomer", () => {
  it("enqueue une création (POST /customers) puis rejoue et invalide si en ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useSaveCustomer(), { wrapper });
    await act(async () => {
      await result.current({ values: SAMPLE_VALUES });
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({ method: "POST", path: "/customers", body: SAMPLE_VALUES });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("enqueue une modification (PATCH /customers/:id)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ method: "PATCH" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useSaveCustomer(), { wrapper });
    await act(async () => {
      await result.current({ customerId: "c1", values: SAMPLE_VALUES });
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/customers/c1",
      body: SAMPLE_VALUES,
    });
  });

  it("n'appelle ni processQueue ni invalidateQueries hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useSaveCustomer(), { wrapper });
    await act(async () => {
      await result.current({ values: SAMPLE_VALUES });
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("propage le rejet serveur plutôt que de le traiter comme un succès (revue sécurité)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("HTTP 403"));

    const { result } = await renderHook(() => useSaveCustomer(), { wrapper });

    await act(async () => {
      await expect(result.current({ values: SAMPLE_VALUES })).rejects.toThrow("HTTP 403");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useDeactivateCustomer", () => {
  it("enqueue une suppression (DELETE /customers/:id)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ method: "DELETE" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useDeactivateCustomer(), { wrapper });
    await act(async () => {
      await result.current("c1");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({ method: "DELETE", path: "/customers/c1" });
  });

  it("propage le rejet serveur plutôt que de le traiter comme un succès (revue sécurité)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 11, method: "DELETE" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("HTTP 403"));

    const { result } = await renderHook(() => useDeactivateCustomer(), { wrapper });

    await act(async () => {
      await expect(result.current("c1")).rejects.toThrow("HTTP 403");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(11);
  });
});
