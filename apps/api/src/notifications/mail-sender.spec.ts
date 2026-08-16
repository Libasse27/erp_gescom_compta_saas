import { ConsoleMailSender } from "./mail-sender";

// Régression SEC-04 (docs/audit/SECURITY-AUDIT.md) : le corps d'un message
// (jeton brut de réinitialisation de mot de passe ou d'invitation) ne doit
// jamais atteindre un journal destiné à être agrégé.
describe("ConsoleMailSender", () => {
  it("never writes the message body to the console", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    const sender = new ConsoleMailSender();
    const secretToken = "raw-reset-token-should-never-appear-in-logs";
    await sender.send({
      to: "user@example.com",
      subject: "Réinitialisation de votre mot de passe",
      body: `Jeton de réinitialisation (valable 1h) : ${secretToken}`,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedLine = logSpy.mock.calls[0]!.join(" ");
    expect(loggedLine).not.toContain(secretToken);
    expect(loggedLine).toContain("user@example.com");
    expect(loggedLine).toContain("Réinitialisation de votre mot de passe");

    logSpy.mockRestore();
  });
});
