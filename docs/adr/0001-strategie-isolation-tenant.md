# 0001 — Stratégie d'isolation multi-tenant

## Statut
Tranché — 2026-08-09

## Contexte
Trois options standard pour isoler les données d'entreprises (tenants) dans un
SaaS B2B :
1. Base partagée + colonne `tenantId` sur chaque table métier.
2. Un schéma PostgreSQL par tenant.
3. Une base de données par tenant.

Critères d'arbitrage (voir `docs/PROMPT-MAITRE-SAAS.md` §C) : nombre de tenants
attendu, coût d'exploitation, exigences de conformité.

Le marché cible (PME/ETI sénégalaises et ouest-africaines, §7 `CLAUDE.md`)
laisse attendre un volume de tenants potentiellement élevé (centaines à
milliers) avec une volumétrie par tenant modeste. Aucune exigence de
conformité connue à ce jour n'impose une base physiquement dédiée par client.

## Décision
Base **partagée** + colonne `tenantId` sur chaque table tenant, avec
isolation renforcée par Row Level Security PostgreSQL (voir
`docs/adr/0002-point-application-isolation.md`).

Schéma-par-tenant et base-par-tenant sont écartés :
- schéma-par-tenant : migrations à rejouer sur N schémas, complexité
  opérationnelle croissante avec le nombre de tenants, sans bénéfice de
  conformité justifié ici ;
- base-par-tenant : coût d'exploitation prohibitif à cette échelle (pooling de
  connexions, sauvegardes, monitoring multipliés par le nombre de tenants).

## Conséquences
- Chaque table métier porte une colonne `tenantId` (Prisma `Enterprise.id`),
  indexée en tête de chaque index composé.
- L'isolation logique repose sur RLS + contexte de requête (ADR 0002), pas sur
  une séparation physique.
- Un futur passage à une isolation plus forte (schéma ou base dédiée) reste
  possible pour un client Enterprise spécifique si un jour exigé
  contractuellement — non nécessaire pour la V1.
