# Étude : un agent conseiller pour CDM26 Picks

*Étude du 24/09/2026. Rien n'a été codé.*

## Conclusion : ne pas le faire maintenant

1. **La compétition est finie.** Les 132 matchs de `cdm_matches` sont au statut
   `termine`. Le premier date du 11/06/2026, le dernier du 19/07/2026. Il n'y a
   plus de pick à conseiller.
2. **Il manque le moteur interne.** Les agents TTFL et tennis ne font que
   commenter un calcul qui existe déjà : le moteur TTFL (`get_ttfl_pick_du_jour`)
   et Tennis App (`/api/agent/tour-courant`). CDM26 n'a pas d'équivalent.
   `cdm_player_ratings` contient des notes données **après** les matchs, pas des
   projections faites **avant**. Or la règle du projet est « pas de
   recommandation sans données internes ». Un agent CDM26 inventerait donc ses
   picks à partir du web, ce que la règle interdit.

## Si on le fait un jour (prochaine compétition)

Il faudrait d'abord un **moteur de projection dans CDM26**, pas dans
mes-agents. Il donnerait, pour un match à venir, les joueurs recommandés avec
leur score attendu, selon le barème CDM26 (2 joueurs par équipe, un joueur
star, des bonus).

Ensuite, on suivrait le même schéma que les deux autres agents :

| Étape | TTFL / tennis (existant) | CDM26 (à faire) |
|---|---|---|
| Calcul des picks | Moteur TTFL / Tennis App | À créer dans CDM26 |
| Accès depuis mes-agents | Fonction SQL en lecture seule / route avec jeton | Fonction SQL `get_cdm_pick_match(match_id)` en lecture seule (même projet Supabase, les tables `cdm_*` y sont déjà) |
| Joueurs déjà utilisés | Le stock tennis | `cdm_player_usage` |
| Contexte web | Blessures, forme | Compositions probables, blessures, suspensions |
| Interface | Onglet dans la page Conseiller | 3ᵉ onglet « CDM » |

## Coût estimé

- Étude : gratuite.
- Code de l'agent : environ une demi-journée, **une fois le moteur de projection
  CDM26 écrit**.
- À l'usage : le même coût que les autres agents, soit jusqu'à 5 appels Claude
  (Sonnet) plus quelques recherches web par question.

## Remarque en passant (projet CDM26)

`app/actions/picks.ts` contient encore plusieurs `console.log` de debug, qui
affichent notamment l'identifiant utilisateur. Rien n'a été modifié, car c'est
un autre projet.
