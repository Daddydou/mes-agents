@AGENTS.md

# Mes agents

Conseillers Claude qui combinent mes données Supabase et une recherche web
(TTFL + tennis). Next.js 16, AI SDK 7, Anthropic, Supabase. Ils lisent mes
données en LECTURE SEULE : jamais d'écriture depuis un agent.

## Commandes

- npm run dev
- npx tsc --noEmit

## Où est quoi

- src/app/page.tsx : interface unique « Conseiller » (onglets TTFL / Tennis, trace de raisonnement, avis bon/mauvais)
- src/app/api/ttfl/ : agent TTFL, lit le pick du jour via la fonction SQL get_ttfl_pick_du_jour
- src/app/api/tennis/ : agent tennis, appelle la route /api/agent/tour-courant de Tennis App (voir plus bas), retire les joueurs déjà pickés par le stock
- src/lib/trace.ts : trace de raisonnement reconstruite à partir des étapes de l'agent (aucun appel en plus)
- src/app/actions.ts : enregistrement d'un avis bon/mauvais (Server Action, pas un agent)
- supabase/migrations/ : fonctions et tables créées pour mes-agents (projet Supabase « Cater40 »)
- docs/decisions.md : journal des décisions, à lire avant de revenir sur un choix

## Règles

- Lecture seule sur Supabase : jamais d'écriture depuis un agent. Seule écriture de l'app : l'avis bon/mauvais, envoyé par la page via la fonction enregistrer_avis_agent (insertion seule).
- Les outils IA utilisent inputSchema (AI SDK 7), pas parameters.
- Garde-fou : 5 étapes max par réponse d'agent (coût des appels Claude + recherche web).
- Pas de recommandation sans données internes (règle appliquée aux deux agents, TTFL et tennis) : si les projections/picks ne sont pas disponibles, l'agent le dit et ne recommande rien au hasard.
- L'agent tennis ne recode JAMAIS la logique de « tour en cours » ou de filtrage des matchs déjà joués : tout ça vit dans Tennis App (route /api/agent/tour-courant), lue via TENNIS_APP_URL + AGENT_API_TOKEN (variables d'environnement, jamais codées en dur, jamais exposées au navigateur).
- Pas de mise en ligne publique sans mot de passe (même schéma que Tennis App) : chaque appel coûte des crédits Anthropic.

## Je suis débutant

- Réponds-moi toujours en français.
- Rappelle-moi toujours le coût (appels Claude + recherche web) d'une modification.
- Demande avant toute suppression de fichier.
