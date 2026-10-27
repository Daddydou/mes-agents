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
- Secrets GitHub créés par l'utilisateur (`CRON_SECRET`, `COLIS_SYNC_URL`).
  Workflow lancé à la main (workflow_dispatch) : succès, 0 mail en attente,
  0 erreur, secrets masqués (`***`) dans les journaux publics. **L'agent
  colis est actif** : le cron `*/30 * * * *` tourne depuis `master`.
- Vérifié par l'utilisateur : écran de consentement Google « En production »
  (le refresh token n'expire pas au bout de 7 jours) ; fichier
  `client_secret_….json` supprimé de Téléchargements.

## 27/10/2026 : région Vercel et mises à jour

- **Région des fonctions : Paris (`cdg1`)** au lieu de Washington
  (`iad1`), réglée dans le projet Vercel (`functionDefaultRegions`).
  Choix entre les deux options proposées (Paris ou Francfort) : Paris, plus
  proche de la base Supabase (Irlande) et de l'utilisateur. Confort
  (latence), pas sécurité.
- **Mises à jour** : next et eslint-config-next 16.3.5 → 16.4.3 (version
  exacte gardée, comme avant), `@ai-sdk/anthropic` 4.0.58 → 4.0.90 (connaît
  maintenant `claude-haiku-5-5`), ai 7.0.155, zod 4.6.7, puis
  `npm audit fix` : **0 vulnérabilité** (il y en avait dans next, zod,
  sharp, undici, source-map-js). Vérifié : typage, linter, build, tests de
  rapprochement, et un vrai appel d'extraction sur un faux mail (< 0,001 $).
- Consigne d'extraction : « livré demain » = en transit, pas « en cours de
  livraison » (vu sur le faux mail de test).

## 27/10/2026 : liens vers les mails et code de retrait (agent colis)

- **Format du lien testé dans Gmail** (Chrome, compte lolo.rms) sur un cas
  réel piégeux : Gmail range les avis Colissimo de Veepee ET d'Amazon dans
  le MÊME fil (même sujet « Votre colis arrive ! »).
  - `#all/<id du fil>` : ouvre la conversation sur le mail le plus RÉCENT
    → affichait le mail Amazon pour la ligne Veepee. **Écarté**, alors que
    la demande le préférait.
  - `#all/<id du message>` : bon mail, sauf pour le 1er mail d'un fil (son
    id est aussi celui du fil, Gmail le lit comme un fil) → même défaut.
  - `#all/%23msg-f:<décimal>` seul : renvoie à la liste. Écarté.
  - **Retenu** : `#all/%23thread-f:<fil>|msg-f:<message>` (ids en décimal),
    la forme vers laquelle Gmail redirige lui-même : ouvre toujours le bon
    mail, déplié. Il faut le fil ET le message → colonne
    `colis_historique.thread_id`. Sans fil connu : repli sur `#all/<id>`.
- **Migration 0005** (`thread_id` + `code_retrait` + `qr_code`) : le numéro
  0004 était déjà pris par `0004_rls_autres_apps.sql`, apparu pendant cette
  session (autre travail en cours). `thread_id` est rempli pour l'existant
  à partir de `colis_emails_traites`, qui gardait déjà le fil de chaque
  mail.
- **Ordre de la description** : la demande met en tête à la fois le code et
  « 📧 Dernier mail ». Choix : le code d'abord (c'est ce qu'on cherche au
  guichet), puis le dernier mail, l'historique (5 lignes, plus récente
  d'abord, chacune avec SON lien), puis statut / transporteur / suivi /
  lieu. Le texte d'une ligne d'historique reste le résumé d'une phrase déjà
  stocké (pas de nouvel appel Claude).
- **Code de retrait** : recopié tel quel par Claude (consigne : jamais un
  n° de suivi, de commande ou de client ; null s'il est absent), coupé à 50
  caractères par le code. Jamais écrasé par null ; effacé (avec l'indicateur
  QR) dès que le statut devient livré ou annulé. On ne garde que le fait
  qu'un QR code existe, jamais l'image. 🔑 dans le titre si code OU QR.
- **Reprise des colis en cours** : `GET /api/colis/sync?reprise=1`
  (`&dryRun=1` pour simuler), même jeton. Relit dans Gmail chaque mail de
  l'historique (fil + code, un appel Claude par mail) et ne fait que METTRE
  À JOUR l'événement existant : jamais de création, donc pas de doublon.
  Les colis livrés ne sont pas touchés. La simulation ne lit que des
  colonnes d'avant la migration : elle tourne avant de l'appliquer.
- **dryRun de reprise** (6 mails, ≈ 0,003 $, rien d'écrit) : 3 colis en
  cours, fils retrouvés pour les 6 mails (identiques à ceux de
  `colis_emails_traites`), **aucun code ni QR** dans ces mails (normal : ils
  sont « en transit », le code arrive avec l'avis « disponible »). 2
  événements à modifier (Veepee, Amazon Swiffer) ; PSG n'a pas de date donc
  pas d'événement.
- **Confidentialité** : la page mentionne maintenant le code de retrait (ou
  la présence d'un QR), son effacement à la livraison, et les identifiants
  Gmail (mail + conversation) gardés pour les liens.
- Coût : extraction un peu plus longue (2 champs) ≈ +5 % par mail, toujours
  ≈ 0,0005 $. Aucune recherche web.
- Vérifié après déploiement : fonctions en `cdg1` (en-tête `X-Vercel-Id:
  cdg1::cdg1`), synchro colis OK depuis Paris.

## 27/10/2026 : RLS sur les 24 tables des autres apps (migration 0004)

Alerte critique Supabase « rls_disabled » : avec la clé anon (visible dans
le code des sites), n'importe qui pouvait lire, modifier et vider 24
tables de cater40, cultureg, Ligue1, cdm/cdm26/hub. **Appliquée** le
27/10/2026 ; l'alerte a disparu du rapport de sécurité Supabase.

Méthode : inventaire du code de chaque app (opérations réellement faites,
type de client : navigateur anon, session utilisateur, ou clé service qui
contourne la RLS), activité réelle des tables (`pg_stat_user_tables`),
règles dormantes, fonctions SQL appelées. Une règle par opération
utilisée, rien de plus.

| App | Tables | Ce qui reste permis (clé anon / session) |
|---|---|---|
| Ligue1 | l1_seasons, l1_clubs, l1_season_clubs, l1_players, l1_season_squads, l1_phases, l1_gameweeks, l1_player_ratings | lecture seule (les imports passent par la clé service) |
| Ligue1 | l1_participants | lecture ; inscription **de soi-même uniquement, jamais en admin** ; règle existante `participants_update` (sa propre ligne) réactivée |
| CDM (cdm26, hub, cdm) | cdm_groups, cdm_nations, cdm_players, cdm_matches, fantasy_phase_limits | lecture seule (écritures admin via la clé service) |
| hub | cdm_group_members | ajout seulement (inscription, parfois avant la session) ; plus de lecture publique |
| hub, cdm26 | cdm_push_subscriptions | chacun ne voit / modifie **que son propre abonnement** |
| cater40 | rooms | lecture, modification (plus d'ajout ni de suppression de salle) |
| cater40 | players, answers | lecture, ajout/modif (players), suppression (nécessaire à la fonction `reset_room`, qui agit avec les droits de l'appelant) |
| cultureg | cg_locked_questions | lecture, ajout, modif, suppression (tout est utilisé par l'animateur) |
| — | cdm_pick_third_players, cdm_match_leaderboard, l1_player_usage, cdm_notification_log | verrouillées (inutilisées, ou clé service seulement) |

Vérifié avec la clé anon après application : lectures attendues OK,
tables verrouillées invisibles, modification d'une vraie ligne de
référence refusée (0 ligne modifiée, test sans effet).

Limites assumées :
- cater40 et cultureg n'ont pas de comptes : ce que le jeu fait depuis le
  navigateur (modifier un score, supprimer des joueurs via reset_room),
  quelqu'un muni de la clé anon peut encore le faire. Seul un vrai login
  animateur, ou des fonctions SQL dédiées, réduirait ça.
- Pas pu tester les apps elles-mêmes en conditions réelles : si l'une
  casse, chercher d'abord une opération oubliée dans l'inventaire (erreur
  « new row violates row-level security policy » ou 0 ligne renvoyée), et
  ajouter la règle correspondante dans une migration 0005.
- `participants_update` (Ligue1) laisse un participant modifier sa propre
  ligne, y compris `is_admin`. Règle préexistante, laissée telle quelle.
- Autres alertes Supabase déjà présentes, non traitées : une vue en
  SECURITY DEFINER (ERROR), une fonction sans search_path fixe, une
  extension dans `public`, des fonctions SECURITY DEFINER appelables par
  anon, la protection contre les mots de passe divulgués désactivée.
- **Mise en ligne** : migration 0005 validée par l'utilisateur et appliquée
  (17 lignes d'historique, toutes avec leur fil ; RLS toujours active).
  ⚠ Le code de cette fonctionnalité est parti dans le commit `10e275d`
  (« RLS sur les 24 tables des autres apps… ») d'une autre session, qui a
  commité tout le dossier, puis déployé en production à 21:09 UTC, avant
  la migration. Vérifié : aucun mail traité entre ce déploiement et la
  migration (dernier passage 20:40 UTC), aucune erreur Vercel.
- **Reprise faite en production** (`?reprise=1`, 6 appels Claude ≈
  0,003 $) : 0 erreur, 2 événements mis à jour (Veepee, Amazon Swiffer)
  avec le lien « Dernier mail » et un lien par ligne d'historique. Vérifié
  dans Google Agenda : 5 événements pour 5 colis, aucun doublon ; les colis
  livrés n'ont pas été touchés (ils n'ont pas les liens, voulu).
