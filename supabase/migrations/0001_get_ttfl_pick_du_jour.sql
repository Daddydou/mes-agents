-- =====================================================================
-- get_ttfl_pick_du_jour — pick TTFL du soir, lisible avec la clé anon
--
-- Les tables ttfl_* sont réservées au rôle `authenticated` (RLS, voir
-- ttfl/supabase_schema.sql) et la vue ttfl_latest_projections est en
-- security_invoker : avec la clé anon, elle ne renvoie rien.
--
-- Plutôt que d'ouvrir les tables à `anon`, on expose UNE fonction
-- SECURITY DEFINER qui ne renvoie que la ligne `is_pick` du dernier run
-- du jour — comme get_dashboard_picks_full pour le Dashboard. L'historique
-- des picks (ttfl_picks) reste inaccessible.
--
-- Lecture seule : `stable`, aucun INSERT/UPDATE/DELETE, search_path vide
-- (tous les objets sont qualifiés par leur schéma).
--
-- Idempotent : rejouable sans risque.
-- =====================================================================

create or replace function public.get_ttfl_pick_du_jour(p_mode text default 'regular')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Date du jour à Paris (le moteur tourne en journée pour les matchs
  -- du soir), pas en UTC.
  select coalesce(
    (
      select jsonb_build_object(
        'status',              'ok',
        'game_date',           r.game_date,
        'computed_at',         r.computed_at,
        'injury_report_fresh', r.injury_report_fresh,
        'rank',                p.rank,
        'player',              p.player,
        'team',                p.team,
        'opponent',            p.opponent,
        'position',            p.position,
        'projection',          p.projection,
        'forme',               p.forme,
        'ceiling',             p.ceiling,
        'matchup_factor',      p.matchup_factor,
        'player_status',       p.status,
        'is_urgent',           p.is_urgent,
        'series_state',        p.series_state,
        'expected_nights_left', p.expected_nights_left,
        'explanation',         p.explanation
      )
      from public.ttfl_runs r
      join public.ttfl_projections p on p.run_id = r.id and p.is_pick
      where r.mode = p_mode
        and r.game_date = (now() at time zone 'Europe/Paris')::date
      order by r.computed_at desc, r.id desc
      limit 1
    ),
    jsonb_build_object(
      'status',    'no_pick_yet',
      'game_date', (now() at time zone 'Europe/Paris')::date
    )
  );
$$;

comment on function public.get_ttfl_pick_du_jour(text) is
  'Pick TTFL du jour (dernier run, ligne is_pick). SECURITY DEFINER en lecture seule, appelable avec la clé anon.';

-- Par défaut PUBLIC peut exécuter toute nouvelle fonction : on restreint.
revoke all on function public.get_ttfl_pick_du_jour(text) from public;
grant execute on function public.get_ttfl_pick_du_jour(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Vérification — à relire après exécution.
-- ---------------------------------------------------------------------
-- Attendu : security_definer = true, volatility = s (stable).
select p.proname, p.prosecdef as security_definer, p.provolatile as volatility
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_ttfl_pick_du_jour';

-- Attendu : un objet JSON (status = 'ok' ou 'no_pick_yet').
select public.get_ttfl_pick_du_jour();
