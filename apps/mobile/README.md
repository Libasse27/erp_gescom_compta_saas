# apps/mobile

Application mobile de l'ERP — Expo (React Native) + TypeScript.
Décision et alternatives écartées : `docs/adr/0012-stack-mobile.md`.

## État

Scaffold Phase 9.0 : navigation minimale (`App.tsx`), aucune fonctionnalité
métier. L'authentification (login/MFA/refresh via `expo-secure-store`),
l'offline-first (file de mutations, purge du cache au changement de tenant) et
les écrans ERP arrivent en Phase 9.2+ (`docs/PROMPT-MAITRE-SAAS.md`).

## Commandes

```bash
pnpm --filter @erp/mobile dev      # expo start
pnpm --filter @erp/mobile typecheck
pnpm --filter @erp/mobile lint
```

L'API consommée est préfixée `/v1` (`docs/adr/0007-versionnage-api-sans-objet.md`).
