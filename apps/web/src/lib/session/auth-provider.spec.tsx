import { render, renderHook, screen, waitFor, act } from "@testing-library/react";
import { AuthProvider, useAuth, SessionApiError } from "./auth-provider";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="user-email">{auth.user?.email ?? ""}</span>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("commence en 'loading' puis passe à 'unauthenticated' si le refresh silencieux échoue", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, { message: "no session" }));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId("status").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unauthenticated"));
  });

  it("passe à 'authenticated' si le refresh silencieux réussit au montage", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { user: { email: "restored@test.com" }, accessToken: "tok" }),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    expect(screen.getByTestId("user-email").textContent).toBe("restored@test.com");
  });

  it("login() rejette avec le message serveur en cas d'échec (401)", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: "no session" })) // refresh silencieux au montage
      .mockResolvedValueOnce(jsonResponse(401, { message: "Identifiants invalides" })); // login

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    let caught: unknown;
    try {
      await result.current.login("a@b.com", "wrong");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SessionApiError);
    expect((caught as Error).message).toBe("Identifiants invalides");
  });

  it("login() retourne mfaRequired sans authentifier la session quand l'API demande une MFA", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { message: "no session" }))
      .mockResolvedValueOnce(jsonResponse(200, { mfaRequired: true, challengeToken: "chal-123" }));

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    const loginResult = await result.current.login("a@b.com", "password123");
    expect(loginResult).toEqual({ mfaRequired: true, challengeToken: "chal-123" });
    expect(result.current.status).toBe("unauthenticated");
  });

  it("logout() efface la session même si l'appel serveur échoue", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(200, { user: { email: "u@test.com" }, accessToken: "tok" }))
      .mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));

    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });
});
