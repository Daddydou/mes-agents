-- =====================================================================
-- avis_agents — avis « ce pick était bon / mauvais » sur les réponses
-- des agents de mes-agents, pour affiner les prompts dans le temps.
--
-- Qui écrit ? La PAGE (Server Action protégée par le mot de passe de
-- l'app), jamais un agent : les agents restent en lecture seule.
--
-- Même schéma que get_ttfl_pick_du_jour : la table est fermée (RLS
-- activée, aucune policy, aucun droit pour anon/authenticated) et on
-- expose UNE fonction SECURITY DEFINER qui ne sait faire qu'une chose :
-- ajouter un avis. Pas de lecture, pas de modification, pas de
-- suppression via l'API. Les avis se relisent dans l'éditeur SQL.
--
-- Limite connue : la clé anon est partagée avec les autres apps du
-- projet ; quelqu'un qui la possède pourrait ajouter de faux avis (mais
-- ni les lire ni toucher à autre chose). Les tailles sont bornées.
--
-- Idempotent : rejouable sans risque.
-- =====================================================================

create table if not exists public.avis_agents (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  agent       text not null check (agent in ('ttfl', 'tennis')),
  verdict     text not null check (verdict in ('bon', 'mauvais')),
  question    text not null check (char_length(question) <= 2000),
  reponse     text not null check (char_length(reponse) <= 20000),
  trace       jsonb check (octet_length(trace::text) <= 200000),
  commentaire text check (char_length(commentaire) <= 1000)
);

comment on table public.avis_agents is
  'Avis bon/mauvais sur les réponses des agents mes-agents. Écriture uniquement via enregistrer_avis_agent().';

alter table public.avis_agents enable row level security;
revoke all on table public.avis_agents from anon, authenticated;

create or replace function public.enregistrer_avis_agent(
  p_agent       text,
  p_verdict     text,
  p_question    text,
  p_reponse     text,
  p_trace       jsonb default null,
  p_commentaire text default null
)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.avis_agents (agent, verdict, question, reponse, trace, commentaire)
  values (p_agent, p_verdict, p_question, p_reponse, p_trace, nullif(btrim(p_commentaire), ''))
  returning id;
$$;

comment on function public.enregistrer_avis_agent(text, text, text, text, jsonb, text) is
  'Ajoute un avis bon/mauvais sur une réponse d''agent. SECURITY DEFINER, insertion seule.';

revoke all on function public.enregistrer_avis_agent(text, text, text, text, jsonb, text) from public;
-- anon seulement : c'est la clé qu'utilise mes-agents (serveur uniquement).
grant execute on function public.enregistrer_avis_agent(text, text, text, text, jsonb, text) to anon;
revoke execute on function public.enregistrer_avis_agent(text, text, text, text, jsonb, text) from authenticated;

-- ---------------------------------------------------------------------
-- Relire les avis (éditeur SQL Supabase) :
-- ---------------------------------------------------------------------
-- select created_at, agent, verdict, question, commentaire, reponse
-- from public.avis_agents order by created_at desc;
