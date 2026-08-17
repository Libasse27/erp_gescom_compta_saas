import { render, screen, waitFor } from "@testing-library/react";
import { ProtectedRoute } from "./protected-route";
import { useAuth } from "./auth-provider";

jest.mock("./auth-provider", () => ({ useAuth: jest.fn() }));

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const mockedUseAuth = useAuth as jest.Mock;

describe("ProtectedRoute", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it("affiche un état de chargement tant que le statut n'est pas résolu", () => {
    mockedUseAuth.mockReturnValue({ status: "loading" });

    render(
      <ProtectedRoute>
        <div>contenu protégé</div>
      </ProtectedRoute>,
    );

    expect(screen.queryByText("contenu protégé")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirige vers /login sans afficher le contenu quand non authentifié", async () => {
    mockedUseAuth.mockReturnValue({ status: "unauthenticated" });

    render(
      <ProtectedRoute>
        <div>contenu protégé</div>
      </ProtectedRoute>,
    );

    expect(screen.queryByText("contenu protégé")).not.toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("affiche le contenu une fois authentifié, sans redirection", () => {
    mockedUseAuth.mockReturnValue({ status: "authenticated" });

    render(
      <ProtectedRoute>
        <div>contenu protégé</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText("contenu protégé")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
