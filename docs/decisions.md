# Journal des décisions

## 24/09/2026 : traitement de la liste de revue de code (12 points)

### Déjà fait avant cette date, rien à changer

1. **`parameters` → `inputSchema`** : les deux outils utilisent déjà `inputSchema`.
2. **Lecture TTFL** : on ne donne pas de clé plus puissante à l'agent. Il passe
   par la fonction `get_ttfl_pick_du_jour` (SECURITY DEFINER, lecture seule,
   migration 0001), déjà en place dans Supabase.
3. **zod** : déjà déclaré dans `package.json`.
4. **Dossier `ttfl-agent`** : déjà archivé dans `projets/_archives/ttfl-agent`.
5. **Mot de passe** : `src/proxy.ts` protège toutes les pages et `/api/*`
   (réponse 401 sans session).
6. **`console.log`** : il n'y en a plus aucun dans `src/`.

### Refusé

7. **« La page Pick Tennis doit envoyer `{question}` »** : c'est l'inverse de la
   réalité. La route tennis attend `{tournoi, stock}` et la page envoie
   exactement ça. Appliquer ce point aurait cassé le bouton.
8. **« L'agent tennis doit lire une vue Supabase de l'app tennis »** : c'est
   contraire à la règle du projet. Le tour en cours vient de la route
   `/api/agent/tour-courant` de Tennis App, déjà branchée depuis le commit
   `763a3f3`.

### Fait

9. **Trace de raisonnement** (`src/lib/trace.ts`) : chaque réponse renvoie les
   données internes lues, les recherches web (requête, titres et liens), les
   erreurs d'outil et le nombre d'appels Claude. La page les affiche dans un
   bloc « Voir le raisonnement ».
   - Choix : on relit les étapes que l'agent a **déjà** faites. Aucun appel
     Claude ni aucune recherche en plus.
   - Choix : on ne garde que le titre et le lien des résultats web. Le contenu
     chiffré renvoyé par Anthropic est inutile et lourd.
10. **Interface unique « Conseiller »** (`src/app/page.tsx`) : des onglets TTFL
    et Tennis, et un choix du stock (Daddy, Laki ou Thomas) pour le tennis.
    - Choix : on **garde deux routes séparées** (`/api/ttfl`, `/api/tennis`),
      et c'est la page qui choisit. Un agent unique qui aiguillerait la
      question coûterait un appel Claude de plus à chaque fois, et mélangerait
      deux prompts aux règles différentes.
    - Ajouts : un bouton « Se déconnecter », un rappel du coût sous le bouton,
      le titre de l'onglet « Conseiller » et `lang="fr"`.
11. **Avis « bon / mauvais »** : des boutons 👍 et 👎 sous chaque réponse, avec
    un commentaire facultatif.
    - Enregistrés dans la table `avis_agents` (migration 0002, **appliquée** au
      projet Supabase « Cater40 » le 24/09/2026). La table est fermée (RLS sans
      policy) et on écrit uniquement via la fonction
      `enregistrer_avis_agent`, qui ne sait faire qu'insérer.
    - C'est la **page** qui écrit (Server Action `src/app/actions.ts`,
      protégée par le mot de passe), jamais un agent. La règle « agents en
      lecture seule » tient donc toujours.
    - Choix : les avis ne sont **pas** réinjectés automatiquement dans les
      prompts. Ça coûterait plus de tokens à chaque appel, et un avis mal
      formulé pourrait dérégler l'agent. On les relit à la main (requête SQL en
      bas de la migration 0002), puis on corrige les prompts.
    - Limite : l'avis se donne depuis la page où la réponse est affichée. Si on
      recharge la page, la réponse disparaît.
    - Limite : la clé anon est partagée avec les autres apps du projet
      Supabase. Quelqu'un qui la possède pourrait ajouter de faux avis, mais
      pas les lire.
12. **Agent CDM26** : étudié, **pas codé**. Voir `docs/etude-agent-cdm26.md`
    (compétition terminée, et pas de moteur de projection interne).

### Ménage

- `CLAUDE.md` : suppression des `\#` et `\-` échappés et des lignes vides en
  double, chemins corrigés (`src/app/...`), retour de l'import `@AGENTS.md`
  (règles Next.js 16 que `next dev` recrée de toute façon).
