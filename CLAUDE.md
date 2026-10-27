@AGENTS.md

# Mes agents

Conseillers Claude qui combinent mes données Supabase et une recherche web
(TTFL + tennis), et un agent colis qui suit mes livraisons à partir de mes
mails. Next.js 16, AI SDK 7, Anthropic, Supabase. Les conseillers lisent mes
données en LECTURE SEULE : jamais d'écriture depuis un agent.

## Commandes

- npm run dev
- npx tsc --noEmit

## Où est quoi

- src/app/page.tsx : interface unique « Conseiller » (onglets TTFL / Tennis, trace de raisonnement, avis bon/mauvais)
- src/app/api/ttfl/ : agent TTFL, lit le pick du jour via la fonction SQL get_ttfl_pick_du_jour
- src/app/api/tennis/ : agent tennis, appelle la route /api/agent/tour-courant de Tennis App (voir plus bas), retire les joueurs déjà pickés par le stock
- src/app/api/colis/sync/ : agent colis (GET protégé par CRON_SECRET, `?dryRun=1` n'écrit rien), lancé toutes les 30 min par .github/workflows/colis-sync.yml
- src/lib/colis/ : pipeline colis (gmail → extraction Claude sans outil → rapprochement → Supabase → agenda) ; réglages dans config.ts
- src/app/colis/page.tsx : page de suivi des colis (même mot de passe que l'app)
- scripts/google-auth.mjs : obtention unique du refresh token Google
- src/lib/trace.ts : trace de raisonnement reconstruite à partir des étapes de l'agent (aucun appel en plus)
- src/app/actions.ts : enregistrement d'un avis bon/mauvais (Server Action, pas un agent)
- supabase/migrations/ : fonctions et tables créées pour mes-agents (projet Supabase « Cater40 »)
- docs/decisions.md : journal des décisions, à lire avant de revenir sur un choix

## Règles

- Lecture seule sur Supabase : jamais d'écriture depuis un agent. Seule écriture de l'app : l'avis bon/mauvais, envoyé par la page via la fonction enregistrer_avis_agent (insertion seule).
- Exception agent colis : il écrit dans les tables colis* (clé service role, serveur uniquement) et dans SON agenda Google « 📦 Colis ». Ce n'est jamais Claude qui écrit : à l'étape d'extraction Claude n'a AUCUN outil, il remplit un schéma ; le code décide et écrit. Gmail en lecture seule (gmail.readonly), agenda limité à calendar.app.created. Ne jamais donner d'outil à l'extraction colis.
- Les outils IA utilisent inputSchema (AI SDK 7), pas parameters.
- Garde-fou : 5 étapes max par réponse d'agent (coût des appels Claude + recherche web).
- Pas de recommandation sans données internes (règle appliquée aux deux agents, TTFL et tennis) : si les projections/picks ne sont pas disponibles, l'agent le dit et ne recommande rien au hasard.
- L'agent tennis ne recode JAMAIS la logique de « tour en cours » ou de filtrage des matchs déjà joués : tout ça vit dans Tennis App (route /api/agent/tour-courant), lue via TENNIS_APP_URL + AGENT_API_TOKEN (variables d'environnement, jamais codées en dur, jamais exposées au navigateur).
- Pas de mise en ligne publique sans mot de passe (même schéma que Tennis App) : chaque appel coûte des crédits Anthropic.

## Je suis débutant

- Réponds-moi toujours en français.
- Rappelle-moi toujours le coût (appels Claude + recherche web) d'une modification.
- Demande avant toute suppression de fichier.
