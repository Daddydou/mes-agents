import 'server-only';
import { clientsGoogle, type Agenda } from './google';
import { listerMails, lireMail, type Mail } from './gmail';
import { extraire, type Extraction } from './extraction';
import { candidatParDate, fusionner, memeMarchand, nettoyerExtraction, trouverColis, type InfosColis } from './rapprochement';
import { changementDate, idAgendaColis, synchroniserEvenement, type ActionAgenda } from './agenda';
import { supabaseColis, type Colis, type LigneHistorique, type SupabaseColis } from './supabase';
import { ANALYSES_EN_PARALLELE, BUDGET_TEMPS_MS, MAX_MAILS_PAR_PASSAGE, REQUETE_GMAIL } from './config';

/**
 * Le pipeline de l'agent colis, étape par étape :
 *
 *   Gmail (lecture) → Claude (comprendre UN mail, sans outil)
 *   → code (rapprochement) → Supabase (état + historique) → Google Agenda
 *
 * Claude n'intervient qu'à l'étape « comprendre ». Tout le reste est du code
 * déterministe : mêmes entrées, mêmes écritures.
 */

export type DetailMail = {
  email_id: string;
  recu_le: string;
  sujet: string;
  est_colis: boolean;
  confiance?: Extraction['confiance'];
  resume?: string;
  /** « nouveau » ou l'id du colis existant. */
  colis?: string;
  infos?: InfosColis;
  agenda?: ActionAgenda | 'ignoré (confiance faible)' | 'à créer' | 'à modifier' | 'à supprimer';
};

export type RapportSync = {
  simulation: boolean;
  mails_en_attente: number;
  mails_analyses: number;
  ignores: number;
  colis_crees: number;
  colis_mis_a_jour: number;
  evenements: { crees: number; modifies: number; supprimes: number };
  restant_pour_le_prochain_passage: number;
  erreurs: { email_id: string; etape: string; message: string }[];
  details: DetailMail[];
  remarques: string[];
};

/** Message d'erreur sans données : jamais l'objet complet, qui peut contenir le corps du mail. */
const messageErreur = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);

/** Table absente : seulement toléré en simulation, avant d'appliquer la migration 0003. */
const tableAbsente = (code?: string) => code === 'PGRST205' || code === '42P01';

async function emailsDejaTraites(db: SupabaseColis, ids: string[], simulation: boolean, remarques: string[]) {
  const vus = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('colis_emails_traites').select('email_id').in('email_id', ids.slice(i, i + 100));
    if (error) {
      if (simulation && tableAbsente(error.code)) {
        remarques.push('Tables colis absentes (migration 0003 non appliquée) : simulation faite comme si aucun mail n’avait été vu.');
        return vus;
      }
      throw new Error(`Supabase (colis_emails_traites) : ${error.message}`);
    }
    for (const r of data) vus.add(r.email_id);
  }
  return vus;
}

/** Exécute `f` sur chaque élément, `n` à la fois ; n'en démarre plus quand `continuer()` est faux. */
async function enParallele<T, R>(items: T[], n: number, f: (t: T) => Promise<R>, continuer: () => boolean) {
  const resultats: (R | undefined)[] = new Array(items.length);
  let suivant = 0;
  const ouvrier = async () => {
    while (suivant < items.length && continuer()) {
      const i = suivant++;
      resultats[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, ouvrier));
  return resultats;
}

type Analyse =
  | { ok: true; mail: Mail; extraction: Extraction }
  | { ok: false; email_id: string; etape: string; message: string };

export async function synchroniserColis(options: { simulation: boolean; max?: number }): Promise<RapportSync> {
  const debut = Date.now();
  const { simulation } = options;
  const max = options.max ?? MAX_MAILS_PAR_PASSAGE;
  const rapport: RapportSync = {
    simulation,
    mails_en_attente: 0,
    mails_analyses: 0,
    ignores: 0,
    colis_crees: 0,
    colis_mis_a_jour: 0,
    evenements: { crees: 0, modifies: 0, supprimes: 0 },
    restant_pour_le_prochain_passage: 0,
    erreurs: [],
    details: [],
    remarques: [],
  };

  const db = supabaseColis();
  const { gmail, agenda } = clientsGoogle();

  // 1. LECTURE — mails candidats pas encore traités, du plus ancien au plus récent.
  const ids = await listerMails(gmail, REQUETE_GMAIL);
  const dejaVus = await emailsDejaTraites(db, ids, simulation, rapport.remarques);
  const enAttente = ids.filter((id) => !dejaVus.has(id)).reverse();
  rapport.mails_en_attente = enAttente.length;
  const lot = enAttente.slice(0, max);

  // 2. EXTRACTION — un appel Claude par mail, plusieurs en parallèle.
  const analyses = await enParallele<string, Analyse>(
    lot,
    ANALYSES_EN_PARALLELE,
    async (id) => {
      let mail: Mail;
      try {
        mail = await lireMail(gmail, id);
      } catch (e) {
        return { ok: false, email_id: id, etape: 'lecture Gmail', message: messageErreur(e) };
      }
      try {
        return { ok: true, mail, extraction: await extraire(mail) };
      } catch (e) {
        return { ok: false, email_id: id, etape: 'extraction Claude', message: messageErreur(e) };
      }
    },
    () => Date.now() - debut < BUDGET_TEMPS_MS,
  );

  const faites = analyses.filter((a): a is Analyse => a !== undefined);
  rapport.mails_analyses = faites.length;
  rapport.restant_pour_le_prochain_passage = enAttente.length - faites.length;

  // Les analyses parallèles finissent dans le désordre : on remet l'ordre
  // chronologique pour que l'historique et les statuts avancent dans l'ordre.
  const reussies = faites
    .filter((a): a is Extract<Analyse, { ok: true }> => a.ok)
    .sort((a, b) => a.mail.recuLe.getTime() - b.mail.recuLe.getTime());
  for (const a of faites) if (!a.ok) rapport.erreurs.push({ email_id: a.email_id, etape: a.etape, message: a.message });

  // Agenda : préparé une seule fois (création de « 📦 Colis » au premier passage).
  let calendarId: string | null = null;
  try {
    calendarId = await idAgendaColis(db, agenda, simulation);
  } catch (e) {
    if (!simulation) {
      rapport.erreurs.push({ email_id: '-', etape: 'agenda (préparation)', message: messageErreur(e) });
    }
  }

  // En simulation, rien n'est écrit : on garde en mémoire les colis « qui
  // auraient été créés » pour que deux mails du même colis se rapprochent.
  const simules: Colis[] = [];
  const evenementsSimules = new Set<string>();

  // 3 à 6. RAPPROCHEMENT, STOCKAGE, AGENDA — un mail à la fois, dans l'ordre.
  for (const { mail, extraction } of reussies) {
    const detail: DetailMail = {
      email_id: mail.id,
      recu_le: mail.recuLe.toISOString(),
      sujet: mail.sujet,
      est_colis: extraction.est_colis,
    };
    rapport.details.push(detail);

    try {
      if (!extraction.est_colis) {
        rapport.ignores++;
        if (!simulation) await marquerTraite(db, mail, false);
        continue;
      }

      detail.confiance = extraction.confiance;
      detail.resume = extraction.resume;
      const infos = nettoyerExtraction(extraction);
      detail.infos = infos;

      if (simulation) {
        simulerMail(rapport, detail, infos, extraction, simules, evenementsSimules, await trouverColisSimulation(db, infos, simules));
        continue;
      }

      const actuel = await trouverColis(db, infos);
      const { valeurs, ancienneDate } = fusionner(actuel, infos, mail.recuLe);
      const colis = await enregistrerColis(db, actuel, valeurs);
      if (actuel) rapport.colis_mis_a_jour++;
      else rapport.colis_crees++;
      detail.colis = actuel ? actuel.id : `nouveau (${colis.id})`;

      const resume =
        (ancienneDate && valeurs.date_livraison_prevue
          ? changementDate(ancienneDate, valeurs.date_livraison_prevue)
          : '') + extraction.resume.slice(0, 500);
      const { error: eh } = await db.from('colis_historique').upsert(
        {
          colis_id: colis.id,
          email_id: mail.id,
          statut: extraction.statut,
          resume,
          created_at: mail.recuLe.toISOString(),
        },
        { onConflict: 'colis_id,email_id', ignoreDuplicates: true },
      );
      if (eh) throw new Error(`Supabase (colis_historique) : ${eh.message}`);

      if (extraction.confiance === 'faible') {
        detail.agenda = 'ignoré (confiance faible)';
      } else if (calendarId) {
        detail.agenda = await mettreAJourAgenda(db, agenda, calendarId, colis, rapport);
      } else {
        throw new Error('Agenda « 📦 Colis » indisponible (voir l’erreur de préparation).');
      }

      // Marqué traité en DERNIER : si une étape plante, le mail est retenté au
      // prochain passage, sans doublon (historique unique, événement patché).
      await marquerTraite(db, mail, true);
    } catch (e) {
      rapport.erreurs.push({ email_id: mail.id, etape: 'enregistrement', message: messageErreur(e) });
    }
  }

  return rapport;
}

async function marquerTraite(db: SupabaseColis, mail: Mail, estColis: boolean) {
  // Le sujet n'est gardé que pour un mail de colis : pour les autres
  // (newsletter, mail perso...), seul l'identifiant Gmail est conservé.
  const { error } = await db.from('colis_emails_traites').upsert(
    { email_id: mail.id, thread_id: mail.threadId, sujet: estColis ? mail.sujet.slice(0, 300) : null, est_colis: estColis },
    { onConflict: 'email_id' },
  );
  if (error) throw new Error(`Supabase (colis_emails_traites) : ${error.message}`);
}

async function enregistrerColis(
  db: SupabaseColis,
  actuel: Colis | null,
  valeurs: ReturnType<typeof fusionner>['valeurs'],
): Promise<Colis> {
  const requete = actuel
    ? db.from('colis').update(valeurs).eq('id', actuel.id)
    : db.from('colis').insert(valeurs);
  const { data, error } = await requete.select('*').single();
  if (error) throw new Error(`Supabase (colis) : ${error.message}`);
  return data as Colis;
}

async function mettreAJourAgenda(
  db: SupabaseColis,
  agenda: Agenda,
  calendarId: string,
  colis: Colis,
  rapport: RapportSync,
): Promise<ActionAgenda> {
  const { data, error } = await db
    .from('colis_historique')
    .select('email_id, statut, resume, created_at')
    .eq('colis_id', colis.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`Supabase (colis_historique) : ${error.message}`);

  const { action, eventId } = await synchroniserEvenement(agenda, calendarId, colis, data as LigneHistorique[]);
  if (action === 'cree') rapport.evenements.crees++;
  if (action === 'modifie') rapport.evenements.modifies++;
  if (action === 'supprime') rapport.evenements.supprimes++;

  if (eventId !== colis.calendar_event_id) {
    const { error: e2 } = await db.from('colis').update({ calendar_event_id: eventId }).eq('id', colis.id);
    if (e2) throw new Error(`Supabase (colis.calendar_event_id) : ${e2.message}`);
  }
  return action;
}

// --- Simulation (dryRun) : mêmes décisions, aucune écriture ---------------

async function trouverColisSimulation(db: SupabaseColis, infos: InfosColis, simules: Colis[]) {
  // D'abord les colis « créés » plus tôt dans cette simulation, avec les mêmes règles.
  const enMemoire = simules.find(
    (c) =>
      (infos.numero_suivi && c.numero_suivi === infos.numero_suivi) ||
      (infos.marchand &&
        infos.numero_commande &&
        c.numero_commande === infos.numero_commande &&
        memeMarchand(c.marchand, infos.marchand) &&
        !(c.numero_suivi && infos.numero_suivi)),
  );
  if (enMemoire) return enMemoire;
  const parDate = simules.filter((c) => candidatParDate(c, infos));
  if (parDate.length === 1) return parDate[0];
  try {
    return await trouverColis(db, infos);
  } catch {
    return null; // tables absentes avant la migration
  }
}

function simulerMail(
  rapport: RapportSync,
  detail: DetailMail,
  infos: InfosColis,
  extraction: Extraction,
  simules: Colis[],
  evenementsSimules: Set<string>,
  actuel: Colis | null,
) {
  const { valeurs } = fusionner(actuel, infos);
  const colis: Colis = {
    id: actuel?.id ?? `simulé-${simules.length + 1}`,
    calendar_event_id: actuel?.calendar_event_id ?? null,
    created_at: actuel?.created_at ?? new Date().toISOString(),
    ...valeurs,
  };
  const i = simules.findIndex((c) => c.id === colis.id);
  if (i >= 0) simules[i] = colis;
  else simules.push(colis);

  if (actuel) rapport.colis_mis_a_jour++;
  else rapport.colis_crees++;
  detail.colis = actuel ? actuel.id : `nouveau (${colis.id})`;

  // Agenda : ce qui serait fait, compté une fois par colis (état final).
  const aEvenement = Boolean(colis.calendar_event_id) || evenementsSimules.has(colis.id);
  if (extraction.confiance === 'faible') detail.agenda = 'ignoré (confiance faible)';
  else if (colis.statut === 'annulee') detail.agenda = aEvenement ? 'à supprimer' : 'aucune';
  else if (!colis.date_livraison_prevue) detail.agenda = 'aucune';
  else {
    detail.agenda = aEvenement ? 'à modifier' : 'à créer';
    evenementsSimules.add(colis.id);
  }
  if (detail.agenda === 'à créer') rapport.evenements.crees++;
  if (detail.agenda === 'à modifier') rapport.evenements.modifies++;
  if (detail.agenda === 'à supprimer') rapport.evenements.supprimes++;
}
