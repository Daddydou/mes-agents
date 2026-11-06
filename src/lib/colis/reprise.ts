import 'server-only';
import { clientsGoogle } from './google';
import { lireEntetes } from './gmail';
import { descriptionEvenement, idAgendaColis, synchroniserEvenement, titreEvenement } from './agenda';
import { supabaseColis, type Colis, type LigneHistorique } from './supabase';
import { ANALYSES_EN_PARALLELE } from './config';

/**
 * Reprise UNIQUE des colis EN COURS (ni livrés ni annulés), après l'ajout
 * de l'expéditeur et de l'objet dans l'historique (06/11/2026, migration
 * 0006). La reprise du 27/10 (liens + code de retrait) est faite : ce
 * fichier la remplace.
 *
 * - chaque mail de l'historique est relu dans Gmail, EN-TÊTES SEULEMENT
 *   (expéditeur, objet, fil) : aucun appel Claude, aucun contenu lu ;
 * - l'historique du colis est complété (ce sont tous des mails de colis) ;
 * - son événement d'agenda EXISTANT est mis à jour. On ne crée jamais
 *   d'événement ici : pas de doublon possible.
 *
 * En simulation, rien n'est écrit (ni Supabase, ni agenda) : le rapport
 * montre la description qui serait écrite. Ne lit que des colonnes qui
 * existaient avant la migration 0006 : la simulation peut tourner avant
 * de l'appliquer.
 */

type MailRelu = {
  email_id: string;
  thread_id: string | null;
  expediteur: string | null;
  sujet: string | null;
  erreur?: string;
};

export type DetailReprise = {
  colis_id: string;
  nom: string;
  statut: Colis['statut'];
  mails: MailRelu[];
  agenda: 'modifie' | 'à modifier' | 'aucun événement (rien à faire)' | 'non modifié (erreur de lecture)';
  titre?: string;
  description?: string;
};

export type RapportReprise = {
  simulation: boolean;
  appels_claude: number;
  colis: DetailReprise[];
  erreurs: { colis_id: string; message: string }[];
};

const messageErreur = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);

/** Description HTML de l'agenda → texte lisible dans le rapport JSON. */
const enTexte = (html: string) =>
  html
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function relire(gmail: ReturnType<typeof clientsGoogle>['gmail'], emailId: string): Promise<MailRelu> {
  try {
    const { threadId, expediteur, sujet } = await lireEntetes(gmail, emailId);
    return { email_id: emailId, thread_id: threadId, expediteur, sujet };
  } catch (e) {
    return { email_id: emailId, thread_id: null, expediteur: null, sujet: null, erreur: messageErreur(e) };
  }
}

export async function reprendreColisEnCours(options: { simulation: boolean }): Promise<RapportReprise> {
  const { simulation } = options;
  const rapport: RapportReprise = { simulation, appels_claude: 0, colis: [], erreurs: [] };
  const db = supabaseColis();
  const { gmail, agenda } = clientsGoogle();

  const { data: enCours, error } = await db.from('colis').select('*').not('statut', 'in', '(livree,annulee)');
  if (error) throw new Error(`Supabase (colis) : ${error.message}`);

  const calendarId = await idAgendaColis(db, agenda, true); // true : ne crée jamais l'agenda ici

  for (const c of enCours as Colis[]) {
    const nom = `${c.marchand ?? c.transporteur ?? 'Colis'} — ${c.description ?? c.numero_suivi ?? 'colis'}`;
    try {
      const { data: lignes, error: eh } = await db
        .from('colis_historique')
        .select('email_id, thread_id, statut, resume, created_at')
        .eq('colis_id', c.id)
        .order('created_at', { ascending: false });
      if (eh) throw new Error(`Supabase (colis_historique) : ${eh.message}`);
      const historique = lignes as LigneHistorique[];

      // Relecture des en-têtes, plusieurs à la fois.
      const ids = historique.map((h) => h.email_id).filter((id): id is string => !!id);
      const relus: MailRelu[] = [];
      for (let i = 0; i < ids.length; i += ANALYSES_EN_PARALLELE) {
        relus.push(...(await Promise.all(ids.slice(i, i + ANALYSES_EN_PARALLELE).map((id) => relire(gmail, id)))));
      }
      const parId = new Map(relus.map((m) => [m.email_id, m]));
      const historiqueComplet: LigneHistorique[] = historique.map((h) => {
        const m = h.email_id ? parId.get(h.email_id) : undefined;
        return { ...h, thread_id: h.thread_id ?? m?.thread_id ?? null, expediteur: m?.expediteur ?? null, sujet: m?.sujet ?? null };
      });

      const aEvenement = Boolean(c.calendar_event_id && calendarId && c.date_livraison_prevue);
      const detail: DetailReprise = {
        colis_id: c.id,
        nom,
        statut: c.statut,
        mails: relus,
        agenda: aEvenement ? (simulation ? 'à modifier' : 'modifie') : 'aucun événement (rien à faire)',
      };
      rapport.colis.push(detail);
      if (aEvenement) {
        detail.titre = titreEvenement(c);
        detail.description = enTexte(descriptionEvenement(c, historiqueComplet));
      }

      // Un mail illisible : on n'écrit rien pour ce colis (il garderait une ligne incomplète).
      if (relus.some((m) => m.erreur)) {
        detail.agenda = 'non modifié (erreur de lecture)';
        rapport.erreurs.push({ colis_id: c.id, message: 'Au moins un mail n’a pas pu être relu : colis laissé tel quel.' });
        continue;
      }
      if (simulation) continue;

      for (const h of historiqueComplet) {
        if (!h.email_id) continue;
        const { error: et } = await db
          .from('colis_historique')
          .update({ thread_id: h.thread_id, expediteur: h.expediteur, sujet: h.sujet })
          .eq('colis_id', c.id)
          .eq('email_id', h.email_id);
        if (et) throw new Error(`Supabase (colis_historique) : ${et.message}`);
      }

      if (aEvenement) {
        // Patch de l'événement existant (retrouvé par colis_id s'il a été supprimé à la main).
        const { eventId } = await synchroniserEvenement(agenda, calendarId!, c, historiqueComplet);
        if (eventId !== c.calendar_event_id) {
          const { error: ee } = await db.from('colis').update({ calendar_event_id: eventId }).eq('id', c.id);
          if (ee) throw new Error(`Supabase (colis.calendar_event_id) : ${ee.message}`);
        }
      }
    } catch (e) {
      rapport.erreurs.push({ colis_id: c.id, message: messageErreur(e) });
    }
  }
  return rapport;
}
