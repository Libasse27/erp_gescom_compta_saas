# Monitoring et alerting (P-08)

> Périmètre couvert à ce commit : tracking d'erreurs applicatives (Sentry,
> désactivé par défaut) + marche à suivre pour un moniteur d'uptime externe
> sur `/health/ready`. Un stack Prometheus/Grafana/Alertmanager complet reste
> hors périmètre (`docs/audit/PRODUCTION-READINESS.md` P-08) — reporté à
> avant tout trafic de production réel, cohérent avec l'absence de VPS cible
> à ce jour (`docs/deployment/CI-CD.md`).

## Tracking d'erreurs (Sentry)

`@sentry/nestjs` (`apps/api/src/instrument.ts`) et `@sentry/nextjs`
(`apps/web/src/instrumentation.ts`) sont installés mais **désactivés par
défaut** : `Sentry.init()` n'est appelé que si la variable d'environnement
`SENTRY_DSN` est renseignée. Sans elle, aucun code Sentry ne s'exécute —
comportement identique à avant l'installation de ce paquet.

Volontairement limité au **tracking serveur** (exceptions non gérées,
erreurs 5xx, échecs Prisma...). Pas de tracking client-side navigateur : ça
nécessiterait d'inliner un DSN public au build (comme `NEXT_PUBLIC_API_URL`,
voir `apps/web/Dockerfile`) et de gérer l'upload de source maps — au-delà du
minimum demandé par l'audit (couvrir les paiements/webhooks et les 5xx,
`docs/audit/PRODUCTION-READINESS.md` P-08).

### Activer Sentry en production

1. Créer un compte sur [sentry.io](https://sentry.io) (offre gratuite
   suffisante pour démarrer : 5 000 erreurs/mois au moment de la rédaction —
   vérifier les quotas actuels avant de s'y fier durablement).
2. Créer deux projets Sentry séparés (un par service, pour ne pas mélanger
   les erreurs api/web dans un seul flux) : plateforme **Node.js/NestJS**
   pour `apps/api`, **Next.js** pour `apps/web`.
3. Récupérer le DSN de chaque projet (Settings → Projects → [projet] →
   Client Keys (DSN)).
4. Renseigner `SENTRY_DSN` dans `docker/.env.prod` — **deux valeurs
   différentes**, une par service. `docker-compose.prod.yml` utilise le même
   nom de variable `SENTRY_DSN` pour les deux services par simplicité ; si les
   deux projets Sentry doivent recevoir des événements distincts, dupliquer
   la variable (ex. `SENTRY_DSN_API`/`SENTRY_DSN_WEB`) et ajuster
   `docker-compose.prod.yml` en conséquence au moment de l'activation réelle.
5. Redéployer (`docker compose -f docker/docker-compose.prod.yml up -d
   --build api web`). Aucune migration ni changement de schéma requis.
6. Vérifier : déclencher une erreur de test (ex. route inexistante forçant
   une exception non gérée) et confirmer sa remontée dans le dashboard
   Sentry du projet concerné.

### Ce qui n'est PAS couvert par cette intégration minimale

- Pas de suivi de latence p95/p99 ni de métriques de performance
  applicative (tracing Sentry désactivé — seul `captureException` est
  actif).
- Pas d'alerte automatique configurée par défaut : Sentry propose des
  règles d'alerte (email/Slack) configurables depuis son dashboard, à
  paramétrer manuellement une fois le compte créé (Settings → Alerts).
- Pas de suivi spécifique des échecs de paiement Wave/Orange Money/Free
  Money au-delà de ce qu'une exception non gérée remonterait — un futur
  chantier dédié (`docs/adr/0010-...`) pourrait ajouter des breadcrumbs/tags
  Sentry explicites sur le chemin des webhooks de paiement.

## Moniteur d'uptime externe (UptimeRobot ou équivalent)

Aucune installation dans ce dépôt — configuration entièrement côté service
externe, à faire une fois le VPS/domaine de production réels connus.

1. Créer un compte gratuit sur [UptimeRobot](https://uptimerobot.com) (ou
   un concurrent équivalent — Better Uptime, Freshping... aucun fournisseur
   imposé).
2. Ajouter un moniteur HTTP(s) sur `https://<API_DOMAIN>/health/ready`
   (P-06, `docs/deployment/PRODUCTION.md`) — pas `/health/live`, qui ne
   vérifie aucune dépendance et ne détecterait donc pas une panne Postgres.
3. Intervalle recommandé : 5 minutes (palier gratuit standard de la plupart
   des fournisseurs).
4. Configurer une alerte email (et SMS/téléphone si le palier du fournisseur
   le permet) sur passage en statut `down`.
5. Optionnel : un second moniteur sur `https://<WEB_DOMAIN>/login` (même
   route que le healthcheck Docker de `web`, P-05).

## Constats de l'audit — ce qui reste ouvert après ce commit

D'après `docs/audit/PRODUCTION-READINESS.md` P-08 :

- Pas de métriques de latence/débit historisées (Prometheus/Grafana ou
  équivalent) — à mettre en place avant un trafic de production réel
  significatif, pas nécessairement avant le tout premier déploiement.
- Pas d'agrégateur de logs branché (Loki/CloudWatch...) — le format JSON
  lines (`docs/deployment/LOGGING.md`) est prêt pour ça, juste non connecté.
- RPO/RTO formalisés (`docs/deployment/BACKUPS.md`) mais validation métier
  du chiffre RPO encore à faire.
