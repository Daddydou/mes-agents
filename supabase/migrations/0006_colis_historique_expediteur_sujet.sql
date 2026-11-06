-- =====================================================================
-- colis — expéditeur et objet de chaque mail de l'historique (agent colis)
--
-- L'appli Gmail du téléphone n'ouvre pas un mail précis depuis un lien
-- web : chaque ligne d'historique de l'agenda affiche donc de quoi le
-- retrouver par recherche (date, expéditeur, objet). Voir
-- docs/decisions.md, 06/11/2026.
--
-- colis_historique.expediteur : nom court de l'expéditeur (« Amazon »),
--   JAMAIS l'adresse mail.
-- colis_historique.sujet : objet du mail (300 caractères au plus).
--
-- Seule colis_historique les reçoit : elle ne contient QUE des mails
-- reconnus comme colis. Pour les autres mails, colis_emails_traites ne
-- garde toujours que l'identifiant (sujet null), rien ne change.
--
-- L'objet des lignes existantes est repris de colis_emails_traites (qui le
-- conserve déjà pour les mails de colis). L'expéditeur des colis en cours
-- est relu dans Gmail par la reprise (?reprise=1), sans appel Claude.
--
-- Aucune donnée supprimée. Tables toujours fermées (RLS sans policy) :
-- les nouvelles colonnes héritent de ces droits.
-- Idempotent : rejouable sans risque.
-- =====================================================================

alter table public.colis_historique add column if not exists expediteur text;
alter table public.colis_historique add column if not exists sujet text;

update public.colis_historique h
set sujet = e.sujet
from public.colis_emails_traites e
where e.email_id = h.email_id
  and e.est_colis
  and h.sujet is null
  and e.sujet is not null;

-- ---------------------------------------------------------------------
-- Vérification — à relire après exécution.
-- ---------------------------------------------------------------------
-- Attendu : sans_sujet = 0 (ou presque) ; sans_expediteur = lignes (rempli ensuite).
select count(*) filter (where sujet is null) as sans_sujet,
       count(*) filter (where expediteur is null) as sans_expediteur,
       count(*) as lignes
from public.colis_historique;

-- Attendu : 0 (aucun sujet gardé pour un mail qui n'est pas un colis).
select count(*) as sujets_hors_colis
from public.colis_emails_traites
where not est_colis and sujet is not null;
