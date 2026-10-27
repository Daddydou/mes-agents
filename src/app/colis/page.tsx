import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sessionValide } from '@/auth/garde';
import { FUSEAU } from '@/lib/colis/config';
import { LIBELLES_STATUT, supabaseColis, type Colis, type Statut } from '@/lib/colis/supabase';

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

function Carte({ c }: { c: Colis }) {
  return (
    <li className="rounded-lg border border-zinc-200 p-3">
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
    </li>
  );
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
  const erreur = enCours.error ?? livres.error;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6">
      <h1 className="text-xl font-semibold">📦 Colis</h1>
      {erreur && <p className="mt-4 text-sm text-red-700">Erreur Supabase : {erreur.message}</p>}

      <h2 className="mt-6 mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">En cours</h2>
      {enCours.data?.length ? (
        <ul className="space-y-2">{(enCours.data as Colis[]).map((c) => <Carte key={c.id} c={c} />)}</ul>
      ) : (
        <p className="text-sm text-zinc-500">Aucun colis en cours.</p>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Livrés ces 7 derniers jours</h2>
      {livres.data?.length ? (
        <ul className="space-y-2">{(livres.data as Colis[]).map((c) => <Carte key={c.id} c={c} />)}</ul>
      ) : (
        <p className="text-sm text-zinc-500">Rien de livré cette semaine.</p>
      )}
    </main>
  );
}
