import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import { apiFetch } from "./api";
import { useAuth } from "./auth-context";
import { useHasPermission, useMyContext } from "./permissions";

jest.mock("./api");
// Factory explicite : sans elle, jest.mock introspecte le module réel
// auth-context.tsx, qui importe ./offline → ./db (real expo-sqlite
// openDatabaseSync() au chargement).
jest.mock("./auth-context", () => ({
  useAuth: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

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

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("useMyContext", () => {
  it("n'appelle pas l'API tant que la session n'est pas authentifiée", async () => {
    mockAuth("loading");

    const { result } = await renderHook(() => useMyContext(), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("récupère le contexte utilisateur une fois authentifié", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(
      response(200, { permissions: ["clients.read"], planCode: "STANDARD", subscriptionStatus: "ACTIVE", features: [] }),
    );

    const { result } = await renderHook(() => useMyContext(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.permissions).toEqual(["clients.read"]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/users/me/context",
      expect.objectContaining({ headers: { Authorization: "Bearer access-1" } }),
    );
  });

  it("lève une erreur sur une réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useMyContext(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useHasPermission", () => {
  it("renvoie false tant que le contexte n'est pas chargé", async () => {
    mockAuth("loading");

    const { result } = await renderHook(() => useHasPermission("clients.read"), { wrapper });

    expect(result.current).toBe(false);
  });

  it("renvoie true si la permission est présente", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(
      response(200, { permissions: ["clients.read", "clients.create"], planCode: null, subscriptionStatus: null, features: [] }),
    );

    const { result } = await renderHook(() => useHasPermission("clients.read"), { wrapper });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("renvoie false si la permission est absente", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { permissions: [], planCode: null, subscriptionStatus: null, features: [] }));

    const { result } = await renderHook(() => useHasPermission("clients.delete"), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
