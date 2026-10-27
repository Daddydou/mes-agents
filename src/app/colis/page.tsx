import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sessionValide } from '@/auth/garde';
import { FUSEAU } from '@/lib/colis/config';
import { lienMail } from '@/lib/colis/gmail';
import { resumeAffiche } from '@/lib/colis/agenda';
import { LIBELLES_STATUT, supabaseColis, type Colis, type LigneHistorique, type Statut } from '@/lib/colis/supabase';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Colis' };

const COULEURS: Record<Statut, string> = {
  commande: 'bg-zinc-100 text-zinc-700',
  expediee: 'bg-sky-100 text-sky-800',
  en_transit: 'bg-sky-100 text-sky-800',
  en_livraison: 'bg-indigo-100 text-indigo-800',
  disponible_point_relais: 'bg-violet-100 text-violet-800',
  livree: 'bg-emerald-100 text-emerald-800',
  retard: 'bg-amber-100 text-amber-900',
  probleme: 'bg-red-100 text-red-800',
  annulee: 'bg-zinc-100 text-zinc-500 line-through',
};

const jour = (d: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${d}T12:00:00Z`),
  );
const heure = (d: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, timeStyle: 'short' }).format(new Date(d));
const jourHeure = (d: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: FUSEAU, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(d)).replace(',', '');

type Ligne = LigneHistorique & { colis_id: string };

function LienMail({ h, children }: { h: Ligne; children: React.ReactNode }) {
  if (!h.email_id) return <>{children}</>;
  return (
    <a href={lienMail(h.email_id, h.thread_id)} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">
      {children}
    </a>
  );
}

function Carte({ c, historique }: { c: Colis; historique: Ligne[] }) {
  const dernier = historique.find((h) => h.email_id);
  return (
    <li className="rounded-lg border border-zinc-200 p-3">
      {c.code_retrait ? (
        <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
          🔑 Code : <span className="font-mono text-base font-semibold tracking-wider">{c.code_retrait}</span>
        </p>
      ) : (
        c.qr_code && (
          <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
            📱 QR code à présenter :{' '}
            {dernier ? <LienMail h={dernier}>voir le mail</LienMail> : 'voir le mail'}
          </p>
        )
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{c.marchand ?? c.transporteur ?? 'Colis'}</p>
          {c.description && <p className="text-sm text-zinc-600">{c.description}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COULEURS[c.statut]}`}>
          {LIBELLES_STATUT[c.statut]}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-700">
        {c.date_livraison_prevue ? (
          <>
            Prévu {jour(c.date_livraison_prevue)}
            {c.fenetre_debut && ` · ${heure(c.fenetre_debut)}${c.fenetre_fin ? `–${heure(c.fenetre_fin)}` : ''}`}
          </>
        ) : (
          <span className="text-zinc-500">Date inconnue</span>
        )}
        {c.transporteur && <> · {c.transporteur}</>}
      </p>
      {c.lieu_livraison && <p className="mt-1 text-xs text-zinc-500">{c.lieu_livraison}</p>}
      {c.url_suivi && (
        <a href={c.url_suivi} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-sky-700 underline">
          Suivre {c.numero_suivi ?? 'le colis'}
        </a>
      )}
      {dernier && (
        <p className="mt-2 text-sm">
          📧 <LienMail h={dernier}>Dernier mail</LienMail>
        </p>
      )}
      {historique.length > 0 && (
        <details className="mt-2 text-xs text-zinc-600">
          <summary className="cursor-pointer">Dernières mises à jour</summary>
          <ul className="mt-1 space-y-1">
            {historique.slice(0, 5).map((h) => (
              <li key={`${h.email_id}-${h.created_at}`}>
                {jourHeure(h.created_at)} — {resumeAffiche(h)}
                {h.email_id && (
                  <>
                    {' — '}
                    <LienMail h={h}>mail</LienMail>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** Historique des colis affichés, le plus récent d'abord, regroupé par colis. */
async function chargerHistorique(ids: string[]) {
  const parColis = new Map<string, Ligne[]>();
  if (!ids.length) return { parColis, error: null };
  const { data, error } = await supabaseColis()
    .from('colis_historique')
    .select('colis_id, email_id, thread_id, statut, resume, created_at')
    .in('colis_id', ids)
    .order('created_at', { ascending: false });
  for (const h of (data ?? []) as Ligne[]) parColis.set(h.colis_id, [...(parColis.get(h.colis_id) ?? []), h]);
  return { parColis, error };
}

async function chargerColis() {
  const db = supabaseColis();
  const ilYa7Jours = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  return Promise.all([
    db
      .from('colis')
      .select('*')
      .not('statut', 'in', '(livree,annulee)')
      .order('date_livraison_prevue', { ascending: true, nullsFirst: false }),
    db
      .from('colis')
      .select('*')
      .eq('statut', 'livree')
      .gte('derniere_maj', ilYa7Jours)
      .order('derniere_maj', { ascending: false }),
  ]);
}

export default async function PageColis() {
  // Le proxy redirige déjà sans session ; cette page lit des données perso
  // avec la clé service role, donc on revérifie ici.
  if (!(await sessionValide())) redirect('/login?next=/colis');

  const [enCours, livres] = await chargerColis();
  const affiches = [...((enCours.data ?? []) as Colis[]), ...((livres.data ?? []) as Colis[])];
  const historique = await chargerHistorique(affiches.map((c) => c.id));
  const erreur = enCours.error ?? livres.error ?? historique.error;
  const carte = (c: Colis) => <Carte key={c.id} c={c} historique={historique.parColis.get(c.id) ?? []} />;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6">
      <h1 className="text-xl font-semibold">📦 Colis</h1>
      {erreur && <p className="mt-4 text-sm text-red-700">Erreur Supabase : {erreur.message}</p>}

      <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">En cours</h2>
      {enCours.data?.length ? (
        <ul className="space-y-2">{(enCours.data as Colis[]).map(carte)}</ul>
      ) : (
        <p className="text-sm text-zinc-500">Aucun colis en cours.</p>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Livrés ces 7 derniers jours</h2>
      {livres.data?.length ? (
        <ul className="space-y-2">{(livres.data as Colis[]).map(carte)}</ul>
      ) : (
        <p className="text-sm text-zinc-500">Rien de livré cette semaine.</p>
      )}
    </main>
  );
}
