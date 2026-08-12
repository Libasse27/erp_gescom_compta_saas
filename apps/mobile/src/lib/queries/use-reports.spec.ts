import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import { apiFetch } from "../api";
import { useAuth } from "../auth-context";
import { useIncomeStatement, usePurchasesReport, useSalesReport } from "./use-reports";

jest.mock("../api");
jest.mock("../auth-context", () => ({
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

describe("useSalesReport", () => {
  it("construit les paramètres de requête depuis la période, vide si non renseignée", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(
      response(200, { dateFrom: "", dateTo: "", count: 0, totalExcludingTax: 0, totalVat: 0, totalIncludingTax: 0, byDay: [] }),
    );

    await renderHook(() => useSalesReport({}), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(mockApiFetch).toHaveBeenCalledWith("/reports/sales?", expect.anything());
  });

  it("inclut dateFrom/dateTo quand renseignés", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { byDay: [] }));

    await renderHook(() => useSalesReport({ dateFrom: "2026-08-01", dateTo: "2026-08-31" }), { wrapper });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    const [path] = mockApiFetch.mock.calls[0]!;
    expect(path).toContain("dateFrom=2026-08-01");
    expect(path).toContain("dateTo=2026-08-31");
  });

  it("ne lance aucune requête tant que non authentifié", async () => {
    mockAuth("loading");

    await renderHook(() => useSalesReport({}), { wrapper });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("lève une erreur sur réponse non-ok", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(500, { message: "boom" }));

    const { result } = await renderHook(() => useSalesReport({}), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("usePurchasesReport", () => {
  it("récupère le rapport des achats", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(response(200, { byDay: [] }));

    const { result } = await renderHook(() => usePurchasesReport({}), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith("/reports/purchases?", expect.anything());
  });
});

describe("useIncomeStatement", () => {
  it("récupère le compte de résultat", async () => {
    mockAuth("authenticated", "access-1");
    mockApiFetch.mockResolvedValueOnce(
      response(200, { revenueByAccount: [], expensesByAccount: [], totalRevenue: 0, totalExpenses: 0, netResult: 0 }),
    );

    const { result } = await renderHook(() => useIncomeStatement({}), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mockApiFetch).toHaveBeenCalledWith("/reports/income-statement?", expect.anything());
  });
});
