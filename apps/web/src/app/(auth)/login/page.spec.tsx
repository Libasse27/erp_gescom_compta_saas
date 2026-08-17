import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";
import { useAuth, SessionApiError } from "@/lib/session/auth-provider";

jest.mock("@/lib/session/auth-provider", () => {
  const actual = jest.requireActual("@/lib/session/auth-provider");
  return { ...actual, useAuth: jest.fn() };
});

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mockedUseAuth = useAuth as jest.Mock;

describe("LoginPage", () => {
  beforeEach(() => {
    push.mockClear();
  });

  it("bloque la soumission et affiche l'erreur Zod si l'email n'est pas valide", async () => {
    const login = jest.fn();
    mockedUseAuth.mockReturnValue({ login, verifyMfa: jest.fn() });
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "pas-un-email");
    await user.type(screen.getByLabelText("Mot de passe"), "password123");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("appelle login() avec les identifiants et redirige vers /app pour un utilisateur non super admin", async () => {
    const login = jest.fn().mockResolvedValue({
      mfaRequired: false,
      user: { email: "a@b.com", isSuperAdmin: false },
    });
    mockedUseAuth.mockReturnValue({ login, verifyMfa: jest.fn() });
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Mot de passe"), "password123");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("a@b.com", "password123"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });

  it("redirige vers /super-admin quand l'utilisateur authentifié est super admin", async () => {
    const login = jest.fn().mockResolvedValue({
      mfaRequired: false,
      user: { email: "root@erp.sn", isSuperAdmin: true },
    });
    mockedUseAuth.mockReturnValue({ login, verifyMfa: jest.fn() });
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "root@erp.sn");
    await user.type(screen.getByLabelText("Mot de passe"), "password123");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/super-admin"));
  });

  it("bascule vers le formulaire MFA sans redirection quand l'API demande une vérification", async () => {
    const login = jest.fn().mockResolvedValue({ mfaRequired: true, challengeToken: "chal-123" });
    mockedUseAuth.mockReturnValue({ login, verifyMfa: jest.fn() });
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Mot de passe"), "password123");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByLabelText("Code de vérification")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("affiche le message serveur quand login() échoue", async () => {
    const login = jest.fn().mockRejectedValue(new SessionApiError("Identifiants invalides"));
    mockedUseAuth.mockReturnValue({ login, verifyMfa: jest.fn() });
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "a@b.com");
    await user.type(screen.getByLabelText("Mot de passe"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByText("Identifiants invalides")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
