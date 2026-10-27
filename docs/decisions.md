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

## 27/10/2026 : agent colis (branche `feature/agent-colis`)

Mission : lire les mails de livraison de lolo.rms@gmail.com, suivre chaque
colis dans Supabase et tenir à jour un agenda Google « 📦 Colis ».

### Architecture retenue (celle de la mission)

Gmail (lecture) → Claude (comprendre UN mail, **sans aucun outil**) → code
(rapprochement) → Supabase (état + historique) → Google Agenda. Déclenché
toutes les 30 min par GitHub Actions sur `GET /api/colis/sync`.

### Écarts à la mission, et pourquoi

1. **`generateObject` → `generateText` + `Output.object`** : `generateObject`
   est marqué « deprecated » dans AI SDK 7 (`node_modules/ai`). Même résultat
   (objet validé par le schéma zod), API actuelle.
2. **Pas de `temperature: 0`** : `claude-haiku-5-5` refuse ce réglage
   (erreur 400 côté API, le fournisseur AI SDK l'ignore avec un
   avertissement). À la place : effort de réflexion `low`, suffisant pour
   remplir un schéma et moins cher.
3. **Pas de Basic Auth ni de `COLIS_DASHBOARD_PASSWORD` pour `/colis`** :
   l'app a déjà un mot de passe (`APP_PASSWORD`, cookie signé, `src/proxy.ts`)
   qui couvre toutes les pages. Une Basic Auth en plus aurait fait deux
   mots de passe et deux fenêtres de connexion. La page revérifie la session
   elle-même (elle lit des données perso).
4. **`@googleapis/gmail` + `@googleapis/calendar`** au lieu de `googleapis` :
   ce sont les mêmes clients officiels, découpés par API. `googleapis`
   embarque les ~300 API Google (plus de 100 Mo).
5. **Rappel la veille à 20 h, pas le matin à 8 h** : pour un événement
   « journée entière », l'API Google n'accepte qu'un rappel AVANT le début
   de l'événement (minuit). « Le jour même à 8 h » serait un délai négatif,
   refusé. La veille au soir est le plus proche possible.
6. **Rapprochement n°2 (marchand + n° de commande)** : ignoré si les deux
   colis ont chacun un numéro de suivi différent. Une commande Amazon part
   souvent en plusieurs colis ; sans cette exception, ils seraient fusionnés.

### Ajouts (non demandés, mais nécessaires)

- **Exception à la règle « lecture seule »** : l'agent colis écrit dans
  Supabase (tables `colis*` uniquement) et dans SON agenda. Ce n'est jamais
  Claude qui écrit : Claude n'a aucun outil, c'est le code de la route qui
  décide et écrit. Règle mise à jour dans `CLAUDE.md`.
- **Clé service role** (`SUPABASE_SERVICE_ROLE_KEY`, demandée par la mission)
  plutôt que le schéma habituel (clé anon + fonction SECURITY DEFINER) : la
  clé anon est partagée avec les autres apps du projet, ouvrir ces tables à
  anon rendrait adresses et numéros de suivi lisibles par toutes. Limite :
  la clé service role contourne toute la RLS du projet. Elle ne vit que côté
  serveur (`server-only` fait échouer le build si on l'importe côté
  navigateur).
- **Proxy** : `/api/colis/sync` passe sans cookie (GitHub Actions n'en a
  pas) ; la route exige `Authorization: Bearer <CRON_SECRET>` (comparaison à
  temps constant, et tout est refusé si `CRON_SECRET` n'est pas défini).
- **Migration 0003** (validée et **appliquée** au projet « Cater40 » le 27/10/2026 ; vérifié : RLS active, aucune policy, anon sans accès) : celle de la mission,
  plus une contrainte sur les statuts, un `revoke` explicite pour anon et
  authenticated, un index sur le n° de commande, et un index unique
  `(colis_id, email_id)` dans l'historique.
- **Reprise sans doublon** : un mail n'est marqué « traité » qu'à la toute
  fin. Si une étape plante (Supabase, agenda), il est repris au passage
  suivant : l'historique ne se duplique pas (index unique), l'événement est
  mis à jour et non recréé (`calendar_event_id`, sinon recherche par
  `colis_id` dans les propriétés privées de l'événement).
- **Historique daté à la réception du mail**, pas au traitement : le premier
  passage traite 14 jours d'un coup.
- **Créneau horaire effacé si la date change sans nouveau créneau** : sinon
  l'agenda afficherait un créneau d'un autre jour. C'est la seule
  exception à « ne jamais écraser par null ».
- **Confiance faible** : historique enregistré, aucune action sur l'agenda
  (ni création ni mise à jour).
- **Analyse en parallèle (5 mails à la fois)** et arrêt d'en entamer de
  nouveaux après 45 s : 15 mails à la suite risquaient de dépasser les 60 s
  de la route. Les mails sont remis dans l'ordre chronologique avant
  l'enregistrement.
- **dryRun** : accepte `?max=N` (jusqu'à 50) pour voir plus de mails d'un
  coup pendant le réglage. Il fonctionne même avant la migration (il fait
  alors comme si aucun mail n'avait été vu), et il simule en mémoire les colis
  « qui auraient été créés » pour que deux mails du même colis se
  rapprochent.
- **Événements « disponibles »** (`transparency: transparent`) : un colis
  ne doit pas bloquer un créneau dans l'agenda.
- **Confidentialité** : on ne loggue jamais un objet d'erreur complet (il
  peut contenir le mail envoyé à Claude), seulement son message. Le workflow
  GitHub n'affiche que des compteurs.

### Choix écartés

- **Vercel AI Gateway** : la mission demande `@ai-sdk/anthropic` en direct,
  comme les autres agents du projet.
- **Label Gmail « traité »** : il faudrait un scope en écriture sur Gmail. On
  mémorise les `email_id` dans `colis_emails_traites`.

### Coût estimé

- Claude Haiku 5.5 : 0,10 $ / million de tokens en entrée, 0,50 $ en sortie.
  Un mail ≈ 2 500 tokens en entrée + 400 en sortie ≈ **0,0005 $ par mail**.
  Un passage sans nouveau mail ne coûte **rien** côté Claude. Aucune
  recherche web.
- Premier passage : jusqu'à 15 mails ≈ 0,01 $. Les dryRun coûtent pareil
  (ils appellent Claude).
- GitHub Actions : 48 lancements par jour. Gratuit si le dépôt est public ;
  s'il est privé, chaque lancement compte pour 1 minute → ~1 440 min/mois
  sur les 2 000 gratuites.

### Reste à faire

Configurer Google Cloud, lancer
le dryRun sur les vrais mails, puis le premier vrai passage, le déploiement
Vercel et l'activation du workflow.

## 27/10/2026 : déploiement Vercel et pages publiques

- **Pages publiques `/` et `/confidentialite`** (exigées par l'écran de
  consentement Google). Tout le reste reste derrière le mot de passe.
  - Choix : la page « Conseiller » quitte `/` pour **`/conseiller`** (contenu
    inchangé) ; après connexion on arrive sur `/conseiller`.
  - Sécurité : une Server Action peut être appelée via n'importe quelle URL.
    Sur les pages publiques, le proxy ne laisse donc passer que la lecture
    (une requête `next-action` sans session reçoit 401). Les actions
    revérifiaient déjà la session de leur côté.
- **Confidentialité, deux corrections pour que la page dise vrai** :
  - le code gardait le sujet de TOUS les mails analysés, y compris ceux qui
    ne sont pas des colis (newsletters, mails perso). Il ne garde plus que
    l'identifiant Gmail pour ces mails-là ;
  - « ne partage rien avec des tiers » n'est pas exact au sens strict : le
    texte des mails de livraison est envoyé à l'API d'Anthropic pour
    l'analyse. La page nomme donc les prestataires techniques (Anthropic,
    Supabase, Vercel) et précise qu'aucune donnée n'est vendue, cédée ou
    utilisée pour de la pub. Elle mentionne aussi la règle « Limited Use »
    de Google, demandée pour l'accès à Gmail.
- Vérifié avant de pousser (dépôt public) : `.env.local` est ignoré par git,
  et aucune de ses valeurs n'apparaît dans l'historique.
- **Déploiement Vercel** : projet `mes-agents` (équipe « daddydou's
  projects »), relié à GitHub. Production : https://mes-agents-pi.vercel.app
  - Déployé en production **depuis la branche `feature/agent-colis`**, à ta
    demande, avant la fusion dans `master`. ⚠ Le projet reste configuré avec
    `master` comme branche de production : le prochain push sur `master`
    remplacera la production. Il faut donc fusionner la branche avant.
  - Variables copiées depuis `.env.local` par la CLI Vercel (`vercel env
    add`, valeurs lues dans le fichier et jamais affichées), en production et
    en preview. Les secrets sont de type « Secret » (illisibles une fois
    enregistrés) ; seules `NEXT_PUBLIC_SUPABASE_URL` et `TENNIS_APP_URL` sont
    en clair.
  - `CRON_SECRET` généré aléatoirement (32 octets), écrit dans `.env.local`
    et sur Vercel. Il servira aussi de secret GitHub.
  - Pas encore sur Vercel : `SUPABASE_SERVICE_ROLE_KEY` et les variables
    `GOOGLE_*`. Tant qu'elles manquent, `/colis` et `/api/colis/sync`
    échouent ; les autres pages fonctionnent.
  - Vérifié en production : `/` et `/confidentialite` répondent 200 sans
    mot de passe ; `/conseiller` et `/colis` redirigent vers `/login` ;
    `/api/*` répond 401.
- **À faire avant de considérer l'agent comme actif** : fusionner
  `feature/agent-colis` dans `master`. GitHub Actions ne lance les tâches
  planifiées (`schedule`) que depuis la branche par défaut : tant que
  `.github/workflows/colis-sync.yml` n'est pas sur `master`, la synchro
  toutes les 30 min ne tournera pas. Cette fusion remet aussi la production
  Vercel sur `master`.
- **Police Geist conservée** (décision de l'utilisateur) : l'alerte de
  design « police trop répandue » est désactivée pour Geist
  (`.impeccable/config.json`).

## 27/10/2026 : réglages après le dryRun sur les vrais mails

Trois simulations (`?dryRun=1&max=50`, ~0,03 $ chacune, rien d'écrit) sur
les 50 plus anciens des 59 mails candidats.

- **Dates fausses pour « aujourd'hui »** : le message envoyé à Claude
  contenait la date du jour ET la date de réception du mail ; Claude a
  parfois résolu « en cours de livraison aujourd'hui » au 27/10 (jour de
  l'analyse) au lieu du 23/10 (jour du mail). Corrigé : seule la date de
  réception est donnée. Écart à la mission, qui demandait d'injecter la date
  du jour : c'est justement ce qui provoquait l'erreur.
- **Un colis dédoublé** : « Monoprix.fr » et « Monoprix » ne
  correspondaient pas (comparaison exacte). Le rapprochement par marchand
  ignore maintenant majuscules, accents, `.fr`/`.com` et la ponctuation,
  et accepte qu'un nom contienne l'autre (« Amazon » / « Amazon EU SARL »).
  La consigne demande aussi à Claude d'écrire le marchand sans `.fr`.
- **Tri instable sur une confirmation de commande** (maillot PSG compté
  comme colis, puis non) : la consigne précise qu'une confirmation de
  commande d'objets physiques est un colis même sans date ni suivi, et
  qu'un achat dématérialisé ou un repas livré n'en est pas un.
- Résultat final : 5 colis, tous les mails rattachés au bon colis, 0
  erreur. Reste un cas limite accepté : une demande d'avis Amazon est
  parfois rattachée à la commande déjà livrée (une ligne d'historique en
  plus, sans effet sur le statut).
- Bruit : ~75 % des mails présélectionnés sont des pubs (Temu,
  AliExpress...). Gardé tel quel : coût ~0,0005 $ par mail, et une requête
  Gmail plus stricte risquerait de rater des vrais avis de livraison.

## 27/10/2026 : premier vrai passage (local)

4 passages, 59 mails, 0 erreur. Agenda « 📦 Colis » créé, 7 colis, 6
événements. Idempotence vérifiée : un seul événement par colis malgré
plusieurs mails par colis.

Deux défauts constatés, corrigés dans le code :
- **Doublon Amazon / Colissimo** : la commande Amazon (n° de commande, pas
  de suivi) puis le mail Colissimo (suivi, pas de n° de commande) ne se
  rapprochaient par aucune des règles de la mission. **Nouvelle règle 3**
  (écart à la mission, qui en prévoyait 3 en tout) : un mail de transporteur
  sans n° de commande se rattache au colis du même marchand, sans suivi,
  non livré, attendu le même jour, **seulement s'il n'y a qu'un candidat**.
- **Statut « disponible en point relais » trop tôt** : « sera livré
  mercredi au point relais » était lu comme « disponible ». La consigne
  réserve ce statut au colis réellement arrivé et retirable.
- **Reprise à zéro** (option A, validée par l'utilisateur) : les 6 événements
  créés par l'agent ont été supprimés de l'agenda « 📦 Colis » (seulement
  ceux portant la propriété privée `colis_id`, l'agenda est conservé), puis
  les tables `colis`, `colis_historique` et `colis_emails_traites` ont été
  vidées. `colis_config` est conservée. Nouveau passage complet : 59 mails,
  0 erreur, **6 colis, 5 événements**. Le colis Swiffer regroupe bien 3 mails
  (commande, expédition, Colissimo) ; Swiffer et Veepee sont « en transit ».
  Coût de la reprise : ~0,03 $.
- Détail d'affichage : un colis Amazon portait le nom du vendeur tiers
  (« Ponera (vendeur tiers via Amazon) »). La consigne demande maintenant
  la plateforme. Ça ne s'applique qu'aux prochains mails ; le colis
  concerné est déjà livré.

## 27/10/2026 : fusion dans master

- `feature/agent-colis` fusionnée dans `master` (avance rapide, sans
  conflit) et poussée. La production Vercel est redéployée depuis `master`,
  avec toutes les variables (Supabase service role, Google, CRON_SECRET).
  Vérifié en production : pages publiques en 200, pages privées
  redirigées, `/api/colis/sync` en 401 sans jeton, dryRun avec jeton OK
  (Gmail et Supabase joignables, 0 erreur).
- Secrets GitHub (`CRON_SECRET`, `COLIS_SYNC_URL`) : création bloquée côté
  Claude Code (écriture dans un coffre de secrets) ; à faire par
  l'utilisateur avec `gh secret set`.
