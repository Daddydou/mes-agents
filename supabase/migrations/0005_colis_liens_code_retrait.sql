-- =====================================================================
-- colis — liens vers les mails et code de retrait (agent colis)
--
-- 1. colis_historique.thread_id : le fil Gmail de chaque mail. Le lien
--    qui ouvre le BON mail a besoin du fil ET du message (voir lienMail
--    dans src/lib/colis/gmail.ts et docs/decisions.md, 27/10/2026).
--    Rempli tout de suite pour les lignes existantes à partir de
--    colis_emails_traites, qui conserve déjà le fil de chaque mail.
--    (La reprise ?reprise=1 le relit aussi dans Gmail pour les colis en
--    cours.)
-- 2. colis.code_retrait : code tel qu'écrit dans le mail ; effacé par le
--    code quand le colis est livré ou annulé.
--    colis.qr_code : un mail contient un QR code à présenter (l'image
--    elle-même n'est PAS conservée).
--
-- Aucune donnée supprimée. Tables toujours fermées (RLS sans policy) :
-- les nouvelles colonnes héritent de ces droits.
-- Validée et appliquée au projet « Cater40 » le 27/10/2026.
-- Idempotent : rejouable sans risque.
-- =====================================================================

alter table public.colis_historique add column if not exists thread_id text;

update public.colis_historique h
set thread_id = e.thread_id
from public.colis_emails_traites e
where e.email_id = h.email_id
  and h.thread_id is null
  and e.thread_id is not null;

alter table public.colis add column if not exists code_retrait text;
alter table public.colis add column if not exists qr_code boolean not null default false;

-- ---------------------------------------------------------------------
-- Vérification — à relire après exécution.
-- ---------------------------------------------------------------------
-- Attendu : sans_thread = 0 ; colonnes code_retrait (text) et qr_code (boolean).
select count(*) filter (where thread_id is null) as sans_thread, count(*) as lignes
from public.colis_historique;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'colis' and column_name in ('code_retrait', 'qr_code'))
    or (table_name = 'colis_historique' and column_name = 'thread_id'));
