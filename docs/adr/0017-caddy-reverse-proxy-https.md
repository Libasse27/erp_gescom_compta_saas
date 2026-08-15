# 0017 — Reverse proxy et HTTPS : Caddy

## Contexte

Phase 10.1 a délibérément laissé `api`/`web` publiés directement sur des
ports host (3000/3001), sans TLS, avec un commentaire explicite dans
`docker-compose.prod.yml` : « à restreindre ou retirer une fois Caddy en
place ». Phase 10.6 doit fermer ce point : terminaison TLS et routage par
domaine devant les deux services, sur le VPS cible retenu en 10.1 (VPS +
Docker Compose, pas de plateforme managée).

## Options envisagées

- **nginx + certbot** : le plus répandu, mais renouvellement de certificat
  géré séparément (cron `certbot renew`), configuration de reverse proxy
  manuelle par domaine, aucune automatisation native du premier
  provisionnement de certificat.
- **Traefik** : découverte automatique des services via labels Docker,
  pensé pour des topologies qui changent souvent (beaucoup de services,
  ajouts/retraits fréquents). Apporte une complexité de configuration
  (providers, entrypoints, middlewares) sans bénéfice ici : exactement deux
  services fixes (`api`, `web`), qui ne changent pas dynamiquement.
- **Caddy** : HTTPS automatique par défaut (obtention **et** renouvellement
  Let's Encrypt intégrés, aucun cron séparé), configuration déclarative
  minimale (`Caddyfile`) suffisante pour un routage par domaine statique.

## Décision

**Caddy**. Pour une topologie fixe à deux services, la découverte
dynamique de Traefik n'apporte rien et sa configuration est plus lourde à
maintenir ; nginx+certbot ajoute une pièce mobile (renouvellement) que
Caddy gère nativement. Conforme à l'ordre d'arbitrage de
`docs/PROMPT-MAITRE-SAAS.md` §B (Sécurité → Maintenabilité → ... →
Simplicité) : Caddy est l'option la plus simple qui ne sacrifie rien côté
sécurité (TLS moderne par défaut, renouvellement automatique — donc moins
de risque d'expiration silencieuse qu'une tâche cron oubliée).

## Conséquences

- `docker/Caddyfile` devient la source de vérité unique du routage
  domaine → service (`API_DOMAIN` → `api:3000`, `WEB_DOMAIN` → `web:3001`),
  templaté par variables d'environnement (`docker/.env.prod`).
- `api`/`web` ne publient plus de port sur l'hôte (`docker-compose.prod.yml`) :
  Caddy devient le seul point d'entrée réseau externe, joignant les deux
  services via le réseau Docker interne.
- Renouvellement de certificat entièrement automatique — aucune tâche cron
  à ajouter (contrairement à certbot).
- **Limite assumée** : l'obtention réelle d'un certificat Let's Encrypt
  nécessite un domaine public dont le DNS pointe vers le VPS — impossible à
  vérifier dans cet environnement de développement (aucun VPS/domaine réel).
  Le mécanisme de reverse proxy lui-même (routage par domaine, en-têtes
  transmis) est vérifié avec le mode `tls internal` de Caddy (certificat
  auto-signé local), qui exerce exactement le même chemin de code que le
  mode ACME — voir `docs/deployment/PRODUCTION.md`.
