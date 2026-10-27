-- =====================================================================
-- colis — suivi des colis à partir des mails de livraison (agent colis)
--
-- Qui écrit ? Le CODE de la route /api/colis/sync (côté serveur, clé
-- service role), jamais Claude : Claude n'a aucun outil, il se contente
-- de remplir un schéma à partir d'un mail. C'est le code qui décide du
-- rapprochement et des écritures.
--
-- Tables fermées : RLS activée, AUCUNE policy, aucun droit pour anon et
-- authenticated. Seul le service role (qui contourne la RLS) y accède.
-- La clé anon, partagée avec les autres apps du projet, ne voit donc
-- rien (adresses de livraison, numéros de suivi...).
--
-- On ne stocke JAMAIS le corps d'un mail : sujet + résumé d'une phrase.
--
-- Vérifié le 27/10/2026 : aucune table colis* dans le projet « Cater40 ».
-- Idempotent : rejouable sans risque.
-- =====================================================================

create table if not exists public.colis (
  id                    uuid primary key default gen_random_uuid(),
  marchand              text,
  transporteur          text,
  numero_suivi          text,
  numero_commande       text,
  description           text,
  statut                text not null default 'commande'
                        check (statut in ('commande', 'expediee', 'en_transit', 'en_livraison',
                                          'disponible_point_relais', 'livree', 'retard',
                                          'probleme', 'annulee')),
  date_livraison_prevue date,
  fenetre_debut         timestamptz,
  fenetre_fin           timestamptz,
  lieu_livraison        text,
  url_suivi             text,
  calendar_event_id     text,
  derniere_maj          timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create unique index if not exists colis_numero_suivi_uniq
  on public.colis (numero_suivi) where numero_suivi is not null;
-- Rapprochement n°2 (marchand + numéro de commande).
create index if not exists colis_numero_commande_idx
  on public.colis (numero_commande) where numero_commande is not null;

comment on table public.colis is
  'État courant de chaque colis (agent colis de mes-agents). Écrit uniquement par /api/colis/sync (service role).';

create table if not exists public.colis_historique (
  id         uuid primary key default gen_random_uuid(),
  colis_id   uuid not null references public.colis(id) on delete cascade,
  email_id   text,
  statut     text,
  resume     text,
  -- Date de RÉCEPTION du mail (et non date de traitement) : le premier
  -- passage traite 14 jours d'un coup, l'historique doit rester daté.
  created_at timestamptz not null default now()
);
-- Un mail ne produit qu'une ligne par colis : si un passage plante après
-- avoir écrit l'historique, le passage suivant ne la duplique pas.
create unique index if not exists colis_historique_email_uniq
  on public.colis_historique (colis_id, email_id);
create index if not exists colis_historique_colis_idx
  on public.colis_historique (colis_id, created_at desc);

create table if not exists public.colis_emails_traites (
  email_id  text primary key,
  thread_id text,
  sujet     text,
  est_colis boolean,
  traite_le timestamptz not null default now()
);

create table if not exists public.colis_config (
  cle    text primary key,
  valeur text not null
);

alter table public.colis                enable row level security;
alter table public.colis_historique     enable row level security;
alter table public.colis_emails_traites enable row level security;
alter table public.colis_config         enable row level security;
-- Aucune policy : seul le service role (côté serveur) peut y accéder.
revoke all on table public.colis, public.colis_historique,
                     public.colis_emails_traites, public.colis_config
  from anon, authenticated;

-- ---------------------------------------------------------------------
-- Vérification — à relire après exécution.
-- ---------------------------------------------------------------------
-- Attendu : 4 lignes, rls = true.
select c.relname as table_name, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'colis%' and c.relkind = 'r'
order by 1;
