-- =====================================================================
-- RLS sur les 24 tables d'autres apps qui n'en avaient pas
-- (alerte « rls_disabled » de Supabase, projet « Cater40 »).
--
-- Sans RLS, la clé anon (visible dans le code des sites) permettait de
-- LIRE ET MODIFIER ces tables, y compris de tout supprimer.
--
-- Méthode : inventaire du code de chaque app (27/10/2026, voir
-- mes-agents/docs/decisions.md), puis une règle par opération RÉELLEMENT
-- utilisée par le navigateur ou par une session utilisateur. Tout le
-- reste est refusé. Les scripts et routes d'administration utilisent la
-- clé service, qui contourne la RLS : ils ne sont pas concernés.
--
-- Idempotent : rejouable sans risque (drop policy if exists).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables inutilisées (aucun code, 0 ligne) : verrouillées, aucune règle.
-- ---------------------------------------------------------------------
alter table public.cdm_pick_third_players enable row level security;
alter table public.cdm_match_leaderboard  enable row level security;
alter table public.l1_player_usage        enable row level security;
-- Écrite uniquement par l'Edge Function match-reminder (clé service).
alter table public.cdm_notification_log   enable row level security;

-- ---------------------------------------------------------------------
-- 2. Données de référence : lecture pour tous, écriture par la clé
--    service uniquement (scripts d'import, routes admin).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    -- Ligue1 (import-effectifs, import-matches, import-player-stats, seed-structure)
    'l1_seasons', 'l1_clubs', 'l1_season_clubs', 'l1_players', 'l1_season_squads',
    'l1_phases', 'l1_gameweeks', 'l1_player_ratings',
    -- CDM (cdm26 / hub : écritures via lib/supabase/admin)
    'cdm_groups', 'cdm_nations', 'cdm_players', 'cdm_matches',
    -- cdm (fantasy) : lecture seule depuis la page draft
    'fantasy_phase_limits'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lecture publique" on public.%I', t);
    execute format('create policy "lecture publique" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. cater40 (navigateur, clé anon, pas de comptes)
--    rooms   : lecture, modification (statut de la partie)
--    players : lecture, ajout, modification (score) ; suppression via
--              la fonction reset_room (SECURITY INVOKER : elle agit avec
--              les droits de l'appelant)
--    answers : lecture + suppression (reset_room)
--    Pas d'ajout ni de suppression de salles depuis le navigateur.
-- ---------------------------------------------------------------------
alter table public.rooms   enable row level security;
alter table public.players enable row level security;
alter table public.answers enable row level security;

drop policy if exists "lecture"      on public.rooms;
drop policy if exists "modification" on public.rooms;
create policy "lecture"      on public.rooms for select to anon, authenticated using (true);
create policy "modification" on public.rooms for update to anon, authenticated using (true) with check (true);

drop policy if exists "lecture"      on public.players;
drop policy if exists "ajout"        on public.players;
drop policy if exists "modification" on public.players;
drop policy if exists "suppression"  on public.players;
create policy "lecture"      on public.players for select to anon, authenticated using (true);
create policy "ajout"        on public.players for insert to anon, authenticated with check (true);
create policy "modification" on public.players for update to anon, authenticated using (true) with check (true);
create policy "suppression"  on public.players for delete to anon, authenticated using (true);

drop policy if exists "lecture"     on public.answers;
drop policy if exists "suppression" on public.answers;
create policy "lecture"     on public.answers for select to anon, authenticated using (true);
create policy "suppression" on public.answers for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- 4. cultureg (navigateur, clé anon) : verrous de questions de l'animateur
--    (lecture, upsert = ajout + modification, suppression, temps réel)
-- ---------------------------------------------------------------------
alter table public.cg_locked_questions enable row level security;
drop policy if exists "lecture"      on public.cg_locked_questions;
drop policy if exists "ajout"        on public.cg_locked_questions;
drop policy if exists "modification" on public.cg_locked_questions;
drop policy if exists "suppression"  on public.cg_locked_questions;
create policy "lecture"      on public.cg_locked_questions for select to anon, authenticated using (true);
create policy "ajout"        on public.cg_locked_questions for insert to anon, authenticated with check (true);
create policy "modification" on public.cg_locked_questions for update to anon, authenticated using (true) with check (true);
create policy "suppression"  on public.cg_locked_questions for delete to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- 5. hub (picks CDM) : inscription. L'ajout au groupe se fait juste après
--    auth.signUp, parfois AVANT que la session existe (confirmation par
--    mail) : il faut l'autoriser à anon aussi. Pas de lecture publique.
-- ---------------------------------------------------------------------
alter table public.cdm_group_members enable row level security;
drop policy if exists "ajout a l'inscription" on public.cdm_group_members;
create policy "ajout a l'inscription" on public.cdm_group_members for insert to anon, authenticated with check (true);

-- ---------------------------------------------------------------------
-- 6. Abonnements aux notifications (hub, cdm26) : chacun ne voit et ne
--    modifie QUE son propre abonnement (user_id = son cdm_users.id).
--    L'Edge Function d'envoi lit tout avec la clé service.
-- ---------------------------------------------------------------------
alter table public.cdm_push_subscriptions enable row level security;
drop policy if exists "son abonnement" on public.cdm_push_subscriptions;
create policy "son abonnement" on public.cdm_push_subscriptions for all to authenticated
  using (user_id in (select u.id from public.cdm_users u where u.auth_id::text = auth.uid()::text))
  with check (user_id in (select u.id from public.cdm_users u where u.auth_id::text = auth.uid()::text));

-- ---------------------------------------------------------------------
-- 7. Ligue1 : participants. Lecture pour l'app (classement, middleware) ;
--    inscription seulement pour soi-même (auth_id = l'utilisateur connecté),
--    et jamais en admin (l'app envoie is_admin = false).
-- ---------------------------------------------------------------------
alter table public.l1_participants enable row level security;
drop policy if exists "lecture"           on public.l1_participants;
drop policy if exists "inscription de soi" on public.l1_participants;
create policy "lecture" on public.l1_participants for select to anon, authenticated using (true);
create policy "inscription de soi" on public.l1_participants for insert to authenticated
  with check (auth_id::text = auth.uid()::text and is_admin is not true);
