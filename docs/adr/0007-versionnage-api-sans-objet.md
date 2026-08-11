# 0007 — Rétrocompatibilité / versionnage de l'API

## Statut
Tranché — 2026-08-11 (rouvert depuis « sans objet », comme prévu avant la
Phase 9)

## Contexte
Le plan de phases prévoit d'arbitrer entre versionnage d'API (`/v1`, `/v2`)
et migration en place, selon qu'il existe déjà des clients mobiles/desktop
déployés consommant l'API. La Phase 9 (`docs/adr/0012-...`,
`docs/adr/0013-...`) initialise `apps/mobile` (Expo, stores publics, mise à
jour non synchrone avec l'API) et `apps/desktop` (Electron, binaire installé
localement) : le moment prévu pour rouvrir cet ADR est arrivé.

## Décision
Ajouter un préfixe global `/v1` à toutes les routes NestJS
(`app.setGlobalPrefix('v1', { exclude: [...] })` dans `apps/api/src/main.ts`),
**à l'exception des routes de webhook de paiement**
(`webhooks/payments/:provider`) : ces URLs sont enregistrées manuellement dans
les tableaux de bord des fournisseurs (Wave, Orange Money…) et doivent rester
stables indépendamment du versionnage interne de l'API — les verser dans le
même schéma de version couplerait une intégration externe difficile à changer
au rythme de nos propres évolutions.

Aucun client (web, mobile, desktop) n'étant encore déployé publiquement
(`docs/adr/0000-projet-neuf.md`), ce changement de chemin ne casse aucun
consommateur réel. Vérifié : les 35 fichiers de tests d'intégration/tenant
sous `apps/api/src/**/*.spec.ts` construisent chacun leur propre
`INestApplication` via `Test.createTestingModule({ imports: [AppModule] })` et
n'appellent jamais `bootstrap()`/`setGlobalPrefix()` — le préfixe `/v1`,
appliqué uniquement dans `main.ts`, n'affecte donc pas les chemins d'URL
utilisés par la suite de tests existante.

## Conséquences
- Toute route HTTP réelle (hors webhooks) est désormais `/v1/...` ; `apps/web`
  doit préfixer ses appels (`API_URL`/`NEXT_PUBLIC_API_URL`) en conséquence.
- `apps/mobile` et `apps/desktop` consomment directement `/v1/...` dès leur
  premier appel — pas de dette à retrofitter plus tard.
- Une éventuelle Phase future de breaking change d'API pourra introduire
  `/v2` en parallèle de `/v1` sans révision de cet ADR.
