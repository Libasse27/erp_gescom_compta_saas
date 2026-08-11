import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { CurrentUser } from "@erp/types";
import { apiFetch, fetchCurrentUser } from "./api";
import { AuthApiError, AuthProvider, useAuth } from "./auth-context";
import { purgeOfflineStore } from "./offline";
import { clearStoredRefreshToken, getStoredRefreshToken, setStoredRefreshToken } from "./secure-token-store";

jest.mock("./api");
jest.mock("./secure-token-store");
// Factory explicite : un jest.mock("./offline") sans factory introspecte le
// module réel (barrel qui importe db.ts) pour générer l'automock, ce qui
// déclenche le véritable appel expo-sqlite openDatabaseSync() au chargement.
jest.mock("./offline", () => ({
  purgeOfflineStore: jest.fn(),
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockFetchCurrentUser = fetchCurrentUser as jest.MockedFunction<typeof fetchCurrentUser>;
const mockGetStoredRefreshToken = getStoredRefreshToken as jest.MockedFunction<typeof getStoredRefreshToken>;
const mockSetStoredRefreshToken = setStoredRefreshToken as jest.MockedFunction<typeof setStoredRefreshToken>;
const mockClearStoredRefreshToken = clearStoredRefreshToken as jest.MockedFunction<typeof clearStoredRefreshToken>;
const mockPurgeOfflineStore = purgeOfflineStore as jest.MockedFunction<typeof purgeOfflineStore>;

const CURRENT_USER: CurrentUser = {
  id: "user-1",
  email: "admin@example.com",
  firstName: "Aïda",
  lastName: "Diop",
  phone: null,
  enterpriseId: "ent-1",
  isSuperAdmin: false,
  status: "ACTIVE",
  mfaEnabled: false,
  lastLoginAt: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockGetStoredRefreshToken.mockResolvedValue(null);
});

describe("AuthProvider", () => {
  it("purge le cache hors-ligne au démarrage quand aucun jeton n'est stocké", async () => {
    // Seule branche du flux de démarrage qui menait à LoginScreen sans
    // purger avant la correction de la revue sécurité Phase 9.3 — un cold
    // start sans jeton stocké doit purger inconditionnellement.
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    expect(mockPurgeOfflineStore).toHaveBeenCalled();
  });

  it("connecte l'utilisateur au login nominal (sans MFA)", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(200, { mfaRequired: false, accessToken: "access-1", refreshToken: "refresh-1" }),
    );
    mockFetchCurrentUser.mockResolvedValueOnce(CURRENT_USER);

    let loginResult: Awaited<ReturnType<ReturnType<typeof useAuth>["login"]>> | undefined;
    await act(async () => {
      loginResult = await result.current.login("admin@example.com", "password123");
    });

    expect(loginResult).toEqual({ mfaRequired: false, user: CURRENT_USER });
    expect(mockSetStoredRefreshToken).toHaveBeenCalledWith("refresh-1");
    expect(result.current.status).toBe("authenticated");
    expect(result.current.user).toEqual(CURRENT_USER);
    expect(result.current.accessToken).toBe("access-1");
  });

  it("bascule vers le défi MFA sans établir de session", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    mockApiFetch.mockResolvedValueOnce(jsonResponse(200, { mfaRequired: true, challengeToken: "challenge-1" }));

    let loginResult: Awaited<ReturnType<ReturnType<typeof useAuth>["login"]>> | undefined;
    await act(async () => {
      loginResult = await result.current.login("admin@example.com", "password123");
    });

    expect(loginResult).toEqual({ mfaRequired: true, challengeToken: "challenge-1" });
    expect(mockSetStoredRefreshToken).not.toHaveBeenCalled();
    expect(mockFetchCurrentUser).not.toHaveBeenCalled();
    expect(result.current.status).toBe("unauthenticated");
  });

  it("rejette avec le message d'erreur de l'API quand le login échoue", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    mockApiFetch.mockResolvedValueOnce(jsonResponse(401, { message: "Email ou mot de passe incorrect" }));

    await expect(
      act(async () => {
        await result.current.login("admin@example.com", "wrong-password");
      }),
    ).rejects.toThrow(AuthApiError);
  });

  it("restaure la session au montage et persiste la rotation du refresh token", async () => {
    mockGetStoredRefreshToken.mockResolvedValue("stored-refresh");
    mockApiFetch.mockResolvedValueOnce(jsonResponse(200, { accessToken: "access-2", refreshToken: "rotated-refresh" }));
    mockFetchCurrentUser.mockResolvedValueOnce(CURRENT_USER);

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));

    expect(mockApiFetch).toHaveBeenCalledWith("/auth/refresh", expect.objectContaining({ method: "POST" }));
    expect(mockSetStoredRefreshToken).toHaveBeenCalledWith("rotated-refresh");
    expect(result.current.accessToken).toBe("access-2");
    // Même tenant, même session : purger ici casserait l'intérêt du cache
    // hors-ligne persistant (docs/adr/0014-...).
    expect(mockPurgeOfflineStore).not.toHaveBeenCalled();
  });

  it("persiste la rotation du refresh token même si le composant est démonté avant la fin du refresh", async () => {
    mockGetStoredRefreshToken.mockResolvedValue("stored-refresh");
    let resolveRefresh!: (response: Response) => void;
    mockApiFetch.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveRefresh = resolve)));
    mockFetchCurrentUser.mockResolvedValueOnce(CURRENT_USER);

    const { unmount } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await unmount();

    resolveRefresh(jsonResponse(200, { accessToken: "access-3", refreshToken: "rotated-after-unmount" }));

    await waitFor(() => expect(mockSetStoredRefreshToken).toHaveBeenCalledWith("rotated-after-unmount"));
  });

  it("ne persiste jamais l'access token dans le SecureStore", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(200, { mfaRequired: false, accessToken: "access-secret", refreshToken: "refresh-1" }),
    );
    mockFetchCurrentUser.mockResolvedValueOnce(CURRENT_USER);
    await act(async () => {
      await result.current.login("admin@example.com", "password123");
    });

    expect(mockSetStoredRefreshToken).toHaveBeenCalledWith("refresh-1");
    expect(mockSetStoredRefreshToken).not.toHaveBeenCalledWith("access-secret");
  });

  it("se déconnecte et vide le stockage si le refresh silencieux échoue", async () => {
    mockGetStoredRefreshToken.mockResolvedValue("stale-refresh");
    mockApiFetch.mockResolvedValueOnce(jsonResponse(401, { message: "Jeton de rafraîchissement invalide" }));

    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(mockClearStoredRefreshToken).toHaveBeenCalled();
    expect(mockPurgeOfflineStore).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it("vide le stockage et appelle /auth/logout à la déconnexion", async () => {
    const { result } = await renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(200, { mfaRequired: false, accessToken: "access-1", refreshToken: "refresh-1" }),
    );
    mockFetchCurrentUser.mockResolvedValueOnce(CURRENT_USER);
    await act(async () => {
      await result.current.login("admin@example.com", "password123");
    });
    expect(result.current.status).toBe("authenticated");

    mockGetStoredRefreshToken.mockResolvedValueOnce("refresh-1");
    mockApiFetch.mockResolvedValueOnce(jsonResponse(204, null));

    await act(async () => {
      await result.current.logout();
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer access-1" } }),
    );
    expect(mockClearStoredRefreshToken).toHaveBeenCalled();
    expect(mockPurgeOfflineStore).toHaveBeenCalled();
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });
});
