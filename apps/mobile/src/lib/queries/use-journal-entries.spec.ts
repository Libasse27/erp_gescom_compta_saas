import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CreateJournalEntryInput } from "@erp/validation";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { assertMutationSucceeded, enqueueMutation, MutationRejectedError, processQueue, useIsOnline } from "../offline";
import type { QueuedMutation } from "../offline";
import { useCreateJournalEntry, useJournalEntries, useJournalEntry } from "./use-journal-entries";

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
    path: "/accounting/journal-entries",
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

const SAMPLE_VALUES: CreateJournalEntryInput = {
  description: "Vente au comptant",
  lines: [
    { accountId: "11111111-1111-1111-1111-111111111111", debitAmount: 1_000, creditAmount: 0 },
    { accountId: "22222222-2222-2222-2222-222222222222", debitAmount: 0, creditAmount: 1_000 },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockAssertMutationSucceeded.mockResolvedValue(undefined);
});

describe("useJournalEntries", () => {
  it("construit les paramètres de requête depuis les filtres", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { items: [], total: 0, page: 1, pageSize: 20 }));

    await renderHook(
      () => useJournalEntries({ page: 1, pageSize: 20, search: "FACT-1", accountId: "acc-1" }),
      { wrapper },
    );

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("page=1");
    expect(path).toContain("pageSize=20");
    expect(path).toContain("search=FACT-1");
    expect(path).toContain("accountId=acc-1");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useJournalEntries({ page: 1, pageSize: 20 }), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useJournalEntries({ page: 1, pageSize: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useJournalEntry", () => {
  it("ne lance rien sans id", async () => {
    mockAuth("authenticated", "access-1");

    await renderHook(() => useJournalEntry(undefined), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("récupère la fiche par id, encodée dans le chemin", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { id: "j1", lines: [] }));

    const { result } = await renderHook(() => useJournalEntry("j/1 x"), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/accounting/journal-entries/${encodeURIComponent("j/1 x")}`,
      expect.anything(),
    );
  });
});

describe("useCreateJournalEntry", () => {
  it("enqueue une création (POST /accounting/journal-entries) puis rejoue et invalide écritures, comptes ET balance", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());
    mockProcessQueue.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useCreateJournalEntry(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockEnqueueMutation).toHaveBeenCalledWith({
      method: "POST",
      path: "/accounting/journal-entries",
      body: SAMPLE_VALUES,
    });
    expect(mockProcessQueue).toHaveBeenCalled();
  });

  it("n'appelle pas processQueue hors-ligne", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(false);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation());

    const { result } = await renderHook(() => useCreateJournalEntry(), { wrapper });
    await act(async () => {
      await result.current(SAMPLE_VALUES);
    });

    expect(mockProcessQueue).not.toHaveBeenCalled();
  });

  it("propage le rejet serveur (ex: écriture non équilibrée) plutôt que de le traiter comme un succès", async () => {
    mockAuth("authenticated", "access-1");
    mockUseIsOnline.mockReturnValue(true);
    mockEnqueueMutation.mockResolvedValueOnce(makeQueuedMutation({ id: 9 }));
    mockProcessQueue.mockResolvedValueOnce(undefined);
    mockAssertMutationSucceeded.mockRejectedValueOnce(
      new MutationRejectedError("Le total des débits doit être égal au total des crédits"),
    );

    const { result } = await renderHook(() => useCreateJournalEntry(), { wrapper });

    await act(async () => {
      await expect(result.current(SAMPLE_VALUES)).rejects.toThrow(
        "Le total des débits doit être égal au total des crédits",
      );
    });

    expect(mockAssertMutationSucceeded).toHaveBeenCalledWith(9);
  });
});
