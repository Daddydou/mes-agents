import { FUSEAU } from './config';
import type { Extraction } from './extraction';
import type { Colis, Statut, SupabaseColis } from './supabase';

/**
 * Tout ce fichier est du code « classique » : c'est lui, et non Claude,
 * qui décide à quel colis se rapporte un mail et ce qu'on écrit.
 */

/** Extraction relue par le code : la sortie de Claude n'est pas fiable par principe. */
export type InfosColis = Omit<Extraction, 'est_colis' | 'resume' | 'confiance'>;

const texte = (v: string | null, max = 300) => {
  const t = v?.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

/** YYYY-MM-DD du jour à Paris pour un instant donné. */
export function jourParis(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(d);
}

function dateValide(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

function instantValide(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function urlValide(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 1000) : null;
  } catch {
    return null;
  }
}

/** Numéro de suivi normalisé (sans espaces, majuscules), ou null s'il est invraisemblable. */
export function normaliserSuivi(v: string | null): string | null {
  const n = v?.replace(/[\s.-]/g, '').toUpperCase();
  return n && /^[A-Z0-9]{6,40}$/.test(n) ? n : null;
}

export function nettoyerExtraction(e: Extraction): InfosColis {
  const fenetre_debut = instantValide(e.fenetre_debut);
  let fenetre_fin = instantValide(e.fenetre_fin);
  if (fenetre_debut && fenetre_fin && fenetre_fin <= fenetre_debut) fenetre_fin = null;

  return {
    marchand: texte(e.marchand, 100),
    transporteur: texte(e.transporteur, 100),
    numero_suivi: normaliserSuivi(e.numero_suivi),
    numero_commande: texte(e.numero_commande, 100),
    description: texte(e.description, 200),
    url_suivi: urlValide(e.url_suivi),
    lieu_livraison: texte(e.lieu_livraison, 500),
    statut: e.statut,
    // Un créneau sans date : la date est celle du créneau.
    date_livraison_prevue:
      dateValide(e.date_livraison_prevue) ?? (fenetre_debut ? jourParis(new Date(fenetre_debut)) : null),
    fenetre_debut,
    fenetre_fin: fenetre_debut ? fenetre_fin : null,
  };
}

/** « Monoprix.fr », « MONOPRIX », « Monoprix » → « monoprix ». */
function cleMarchand(m: string): string {
  return m
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(fr|com|co\.uk|de|es|it|eu|net)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Même marchand, à l'écriture près : Claude n'écrit pas toujours le nom
 * pareil d'un mail à l'autre (vu au dryRun : « Monoprix.fr » / « Monoprix »).
 * « Amazon » et « Amazon EU SARL » correspondent aussi (l'un contient l'autre).
 */
export function memeMarchand(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ka = cleMarchand(a);
  const kb = cleMarchand(b);
  if (!ka || !kb) return false;
  return ka === kb || (Math.min(ka.length, kb.length) >= 4 && (ka.includes(kb) || kb.includes(ka)));
}

/**
 * Règle 3 : un mail de TRANSPORTEUR (numéro de suivi mais pas de numéro de
 * commande) se rattache au colis du même marchand, encore sans numéro de
 * suivi, pas livré, attendu le même jour. Vu au premier passage : la
 * commande Amazon (n° de commande, pas de suivi) puis le mail Colissimo
 * (suivi, pas de n° de commande) donnaient deux colis. On ne rattache que
 * s'il y a UN seul candidat : sinon, on ne devine pas.
 */
export function candidatParDate(c: Colis, infos: InfosColis): boolean {
  return (
    !!infos.numero_suivi &&
    !infos.numero_commande &&
    !!infos.date_livraison_prevue &&
    c.date_livraison_prevue === infos.date_livraison_prevue &&
    !c.numero_suivi &&
    c.statut !== 'livree' &&
    c.statut !== 'annulee' &&
    memeMarchand(c.marchand, infos.marchand)
  );
}

/**
 * Règles de rapprochement, dans l'ordre :
 * 1. numéro de suivi déjà connu → ce colis ;
 * 2. sinon même marchand + même numéro de commande → ce colis, SAUF si les
 *    deux ont un numéro de suivi différent (une commande Amazon peut
 *    partir en plusieurs colis) ;
 * 3. sinon mail de transporteur et UN seul colis compatible (candidatParDate) ;
 * 4. sinon → nouveau colis (null).
 */
export async function trouverColis(db: SupabaseColis, infos: InfosColis): Promise<Colis | null> {
  if (infos.numero_suivi) {
    const { data, error } = await db.from('colis').select('*').eq('numero_suivi', infos.numero_suivi).maybeSingle();
    if (error) throw new Error(`Supabase (colis par suivi) : ${error.message}`);
    if (data) return data as Colis;
  }
  if (infos.marchand && infos.numero_commande) {
    const { data, error } = await db.from('colis').select('*').eq('numero_commande', infos.numero_commande);
    if (error) throw new Error(`Supabase (colis par commande) : ${error.message}`);
    const candidat = (data as Colis[]).find(
      (c) => memeMarchand(c.marchand, infos.marchand) && !(c.numero_suivi && infos.numero_suivi),
    );
    if (candidat) return candidat;
  }
  if (infos.numero_suivi && !infos.numero_commande && infos.date_livraison_prevue) {
    const { data, error } = await db
      .from('colis')
      .select('*')
      .eq('date_livraison_prevue', infos.date_livraison_prevue)
      .is('numero_suivi', null);
    if (error) throw new Error(`Supabase (colis par date) : ${error.message}`);
    const candidats = (data as Colis[]).filter((c) => candidatParDate(c, infos));
    if (candidats.length === 1) return candidats[0];
  }
  return null;
}

/** Ordre normal d'avancement. retard / probleme / annulee sont traités à part. */
const RANG: Partial<Record<Statut, number>> = {
  commande: 0,
  expediee: 1,
  en_transit: 2,
  en_livraison: 3,
  disponible_point_relais: 4,
  livree: 5,
};

/** Un statut ne revient pas en arrière (pas de livree → en_transit), sauf retard / probleme. */
export function statutRetenu(actuel: Statut, nouveau: Statut): Statut {
  if (nouveau === 'retard' || nouveau === 'probleme') return nouveau;
  if (nouveau === 'annulee') return actuel === 'livree' ? actuel : nouveau;
  // Sortie d'un retard, d'un problème ou d'une annulation : le mail le plus
  // récent fait foi (les mails sont traités dans l'ordre chronologique).
  const rangActuel = RANG[actuel];
  if (rangActuel === undefined) return nouveau;
  return (RANG[nouveau] ?? 0) >= rangActuel ? nouveau : actuel;
}

export type Fusion = {
  /** Valeurs à écrire dans `colis` (hors id). */
  valeurs: Omit<Colis, 'id' | 'calendar_event_id' | 'created_at'>;
  /** Ancienne date prévue, si elle vient de changer. */
  ancienneDate: string | null;
};

/**
 * Fusionne l'existant et les infos du mail : une valeur connue n'est
 * jamais écrasée par null.
 */
export function fusionner(actuel: Colis | null, infos: InfosColis, maintenant = new Date()): Fusion {
  const garder = <K extends keyof InfosColis & keyof Colis>(k: K) => (infos[k] ?? actuel?.[k] ?? null) as Colis[K];

  const date = garder('date_livraison_prevue');
  const ancienneDate =
    actuel?.date_livraison_prevue && date && date !== actuel.date_livraison_prevue
      ? actuel.date_livraison_prevue
      : null;

  // Le créneau horaire n'a de sens que pour la date retenue : si la date
  // change sans nouveau créneau, l'ancien créneau est périmé.
  let fenetre_debut = garder('fenetre_debut');
  let fenetre_fin = infos.fenetre_debut ? infos.fenetre_fin : garder('fenetre_fin');
  if (fenetre_debut && (!date || jourParis(new Date(fenetre_debut)) !== date)) {
    fenetre_debut = null;
    fenetre_fin = null;
  }

  return {
    valeurs: {
      marchand: garder('marchand'),
      transporteur: garder('transporteur'),
      numero_suivi: garder('numero_suivi'),
      numero_commande: garder('numero_commande'),
      description: garder('description'),
      url_suivi: garder('url_suivi'),
      lieu_livraison: garder('lieu_livraison'),
      statut: actuel ? statutRetenu(actuel.statut, infos.statut) : infos.statut,
      date_livraison_prevue: date,
      fenetre_debut,
      fenetre_fin,
      derniere_maj: maintenant.toISOString(),
    },
    ancienneDate,
  };
}
