import 'server-only';
import { clientsGoogle } from './google';
import { lireMail } from './gmail';
import { extraire } from './extraction';
import { nettoyerExtraction } from './rapprochement';
import { descriptionEvenement, idAgendaColis, synchroniserEvenement, titreEvenement } from './agenda';
import { supabaseColis, type Colis, type LigneHistorique } from './supabase';
import { ANALYSES_EN_PARALLELE } from './config';

/**
 * Reprise UNIQUE des colis EN COURS (ni livrés ni annulés), après l'ajout
 * des liens vers les mails et du code de retrait (27/10/2026) :
 *
 * - chaque mail de l'historique est relu dans Gmail : on y retrouve son fil
 *   (thread_id) et Claude (sans outil, même schéma que la synchro) y relève
 *   le code de retrait / la présence d'un QR code ;
 * - le colis est complété (un code connu n'est jamais écrasé par null) ;
 * - son événement d'agenda EXISTANT est mis à jour. On ne crée jamais
 *   d'événement ici : pas de doublon possible.
 *
 * En simulation, rien n'est écrit (ni Supabase, ni agenda) : le rapport
 * montre le titre et la description qui seraient écrits. Ne lit que des
 * colonnes qui existaient avant la migration 0005 : la simulation peut
 * tourner avant de l'appliquer.
 */

type MailRelu = {
  email_id: string;
  thread_id: string | null;
  code_retrait: string | null;
  qr_code: boolean;
  erreur?: string;
};

export type DetailReprise = {
  colis_id: string;
  nom: string;
  statut: Colis['statut'];
  mails: MailRelu[];
  code_retrait: { avant: string | null; apres: string | null };
  qr_code: { avant: boolean; apres: boolean };
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
    const mail = await lireMail(gmail, emailId);
    const infos = nettoyerExtraction(await extraire(mail));
    return { email_id: emailId, thread_id: mail.threadId, code_retrait: infos.code_retrait, qr_code: infos.qr_code_dans_mail };
  } catch (e) {
    return { email_id: emailId, thread_id: null, code_retrait: null, qr_code: false, erreur: messageErreur(e) };
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

  for (const brut of enCours as Colis[]) {
    // Avant la migration 0005, ces colonnes n'existent pas encore.
    const c: Colis = { ...brut, code_retrait: brut.code_retrait ?? null, qr_code: brut.qr_code ?? false };
    const nom = `${c.marchand ?? c.transporteur ?? 'Colis'} — ${c.description ?? c.numero_suivi ?? 'colis'}`;
    try {
      const { data: lignes, error: eh } = await db
        .from('colis_historique')
        .select('email_id, statut, resume, created_at')
        .eq('colis_id', c.id)
        .order('created_at', { ascending: false });
      if (eh) throw new Error(`Supabase (colis_historique) : ${eh.message}`);
      const historique = lignes as Omit<LigneHistorique, 'thread_id'>[];

      // Relecture des mails, plusieurs à la fois.
      const ids = historique.map((h) => h.email_id).filter((id): id is string => !!id);
      const relus: MailRelu[] = [];
      for (let i = 0; i < ids.length; i += ANALYSES_EN_PARALLELE) {
        relus.push(...(await Promise.all(ids.slice(i, i + ANALYSES_EN_PARALLELE).map((id) => relire(gmail, id)))));
      }
      rapport.appels_claude += relus.filter((m) => !m.erreur).length;
      const parId = new Map(relus.map((m) => [m.email_id, m]));

      // Code : celui du mail le plus récent qui en donne un, sinon celui déjà connu.
      const code = relus.find((m) => m.code_retrait)?.code_retrait ?? c.code_retrait;
      const qr = c.qr_code || relus.some((m) => m.qr_code);
      const apres: Colis = { ...c, code_retrait: code, qr_code: qr };
      const historiqueComplet: LigneHistorique[] = historique.map((h) => ({
        ...h,
        thread_id: (h.email_id && parId.get(h.email_id)?.thread_id) || null,
      }));

      const detail: DetailReprise = {
        colis_id: c.id,
        nom,
        statut: c.statut,
        mails: relus,
        code_retrait: { avant: c.code_retrait, apres: code },
        qr_code: { avant: c.qr_code, apres: qr },
        agenda: c.calendar_event_id && calendarId ? (simulation ? 'à modifier' : 'modifie') : 'aucun événement (rien à faire)',
      };
      rapport.colis.push(detail);
      if (c.calendar_event_id && c.date_livraison_prevue) {
        detail.titre = titreEvenement(apres);
        detail.description = enTexte(descriptionEvenement(apres, historiqueComplet));
      }

      // Un mail illisible : on n'écrit rien pour ce colis (il garderait un lien incomplet).
      if (relus.some((m) => m.erreur)) {
        detail.agenda = 'non modifié (erreur de lecture)';
        rapport.erreurs.push({ colis_id: c.id, message: 'Au moins un mail n’a pas pu être relu : colis laissé tel quel.' });
        continue;
      }
      if (simulation) continue;

      for (const h of historiqueComplet) {
        if (!h.email_id || !h.thread_id) continue;
        const { error: et } = await db
          .from('colis_historique')
          .update({ thread_id: h.thread_id })
          .eq('colis_id', c.id)
          .eq('email_id', h.email_id);
        if (et) throw new Error(`Supabase (colis_historique.thread_id) : ${et.message}`);
      }
      const { error: ec } = await db.from('colis').update({ code_retrait: code, qr_code: qr }).eq('id', c.id);
      if (ec) throw new Error(`Supabase (colis) : ${ec.message}`);

      if (c.calendar_event_id && calendarId) {
        // Patch de l'événement existant (retrouvé par colis_id s'il a été supprimé à la main).
        const { eventId } = await synchroniserEvenement(agenda, calendarId, apres, historiqueComplet);
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
