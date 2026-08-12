import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CreateSalesInvoiceInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue, useIsOnline } from "../offline";
import type { QueuedMutation } from "../offline";
import { useCreateInvoice, useInvoice, useInvoices, useMarkInvoicePaid, useVoidInvoice } from "./use-invoices";

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
    path: "/invoices",
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

const SAMPLE_VALUES: CreateSalesInvoiceInput = {
  saleId: "11111111-1111-1111-1111-111111111111",
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertMutationSucceeded.mockResolvedValue(undefined);
});

describe("useInvoices", () => {
  it("construit les paramètres de requête depuis les filtres", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(() => useInvoices({ page: 1, pageSize: 20, search: "sonatel", status: "ISSUED" }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=20");
    expect(path).toContain("search=sonatel");
    expect(path).toContain("status=ISSUED");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useInvoices({ page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useInvoices({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useInvoice", () => {
  it("ne lance rien sans id", async () => {
    mockAuth("authenticated", "access-1");

    await renderHook(() => useInvoice(undefined), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("récupère la fiche par id, encodée dans le chemin", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { id: "i1", status: "ISSUED", lines: [] }));

    const { result } = await renderHook(() => useInvoice("i/1 x"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith(`/invoices/${encodeURIComponent("i/1 x")}`, expect.anything());
  });
});

describe("useCreateInvoice", () => {
  it("enqueue une création (POST /invoices) puis rejoue et invalide si en ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useCreateInvoice(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({ method: "POST", path: "/invoices", body: SAMPLE_VALUES });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useCreateInvoice(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("propage le rejet serveur (ex: vente déjà facturée, 409) plutôt que de le traiter comme un succès", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("Cette vente a déjà été facturée"));

    const { result } = await renderHook(() => useCreateInvoice(), { wrapper });

    await act(async () => {
      await expect(result.current(SAMPLE_VALUES)).rejects.toThrow("Cette vente a déjà été facturée");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useMarkInvoicePaid", () => {
  it("enqueue un paiement (POST /invoices/:id/mark-paid, id encodé) puis invalide", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ path: "/invoices/i1/mark-paid" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useMarkInvoicePaid(), { wrapper });
    await act(async () => {
      await result.current("i/1 x");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: `/invoices/${encodeURIComponent("i/1 x")}/mark-paid`,
    });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("propage le message d'erreur réel du serveur sur un rejet", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(new MutationRejectedError("Facture introuvable"));

    const { result } = await renderHook(() => useMarkInvoicePaid(), { wrapper });

    await act(async () => {
      await expect(result.current("i1")).rejects.toThrow("Facture introuvable");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});

describe("useVoidInvoice", () => {
  it("enqueue une annulation (POST /invoices/:id/void, id encodé)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ path: "/invoices/i1/void" }));
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useVoidInvoice(), { wrapper });
    await act(async () => {
      await result.current("i/1 x");
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: `/invoices/${encodeURIComponent("i/1 x")}/void`,
    });
  });

  it("propage le message d'erreur réel du serveur sur une annulation hors ISSUED (400)", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(
      new MutationRejectedError("Seule une facture émise peut être annulée"),
    );

    const { result } = await renderHook(() => useVoidInvoice(), { wrapper });

    await act(async () => {
      await expect(result.current("i1")).rejects.toThrow("Seule une facture émise peut être annulée");
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useVoidInvoice(), { wrapper });
    await act(async () => {
      await result.current("i1");
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });
});
