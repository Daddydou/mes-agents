import 'server-only';
import type { Agenda } from './google';
import { FUSEAU, NOM_AGENDA } from './config';
import { lienMail } from './gmail';
import { LIBELLES_STATUT, type Colis, type LigneHistorique, type SupabaseColis } from './supabase';

export type ActionAgenda = 'cree' | 'modifie' | 'supprime' | 'aucune';

/** Code HTTP d'une erreur Google (gaxios), si présent. */
function statutHttp(e: unknown): number | undefined {
  const err = e as { status?: number; code?: number | string; response?: { status?: number } };
  return err?.response?.status ?? err?.status ?? (typeof err?.code === 'number' ? err.code : undefined);
}
const introuvable = (e: unknown) => [404, 410].includes(statutHttp(e) ?? 0);

/**
 * Id de l'agenda « 📦 Colis », créé au premier passage et mémorisé dans
 * colis_config. Recréé s'il a été supprimé à la main dans Google Agenda.
 * En simulation (dryRun), on ne crée rien : renvoie null si absent.
 */
export async function idAgendaColis(db: SupabaseColis, agenda: Agenda, simulation: boolean): Promise<string | null> {
  const { data, error } = await db.from('colis_config').select('valeur').eq('cle', 'calendar_id').maybeSingle();
  if (error) throw new Error(`Supabase (colis_config) : ${error.message}`);

  if (data?.valeur) {
    try {
      await agenda.calendars.get({ calendarId: data.valeur });
      return data.valeur;
    } catch (e) {
      if (!introuvable(e)) throw e;
    }
  }
  if (simulation) return null;

  const { data: cree } = await agenda.calendars.insert({
    requestBody: { summary: NOM_AGENDA, timeZone: FUSEAU, description: 'Tenu à jour par l’agent colis (mes-agents).' },
  });
  if (!cree.id) throw new Error('Google Agenda n’a pas renvoyé d’id pour l’agenda créé.');
  const { error: e2 } = await db
    .from('colis_config')
    .upsert({ cle: 'calendar_id', valeur: cree.id }, { onConflict: 'cle' });
  if (e2) throw new Error(`Supabase (colis_config) : ${e2.message}`);
  return cree.id;
}

const PREFIXES: Partial<Record<Colis['statut'], string>> = {
  en_livraison: '🚚',
  disponible_point_relais: '📍',
  retard: '⚠️',
  probleme: '⚠️',
  livree: '✅',
};

export function titreEvenement(c: Colis): string {
  const prefixe = PREFIXES[c.statut];
  const qui = c.marchand ?? c.transporteur ?? 'Colis';
  const quoi = c.description ?? c.numero_suivi ?? 'colis';
  const cle = c.code_retrait || c.qr_code ? ' 🔑' : '';
  return `${prefixe ? `${prefixe} ` : ''}📦${cle} ${qui} — ${quoi}`;
}

const echapper = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const jourFr = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, day: '2-digit', month: '2-digit' }).format(
    new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso),
  );
const horodatageFr = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, dateStyle: 'short', timeStyle: 'short' }).format(d);
/** « 27/10 14:32 » */
const jourHeureFr = (d: Date) =>
  new Intl.DateTimeFormat('fr-FR', {
    timeZone: FUSEAU, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d).replace(',', '');

const lien = (url: string) => `<a href="${echapper(url)}">${echapper(url)}</a>`;
const lienLigne = (h: LigneHistorique) => (h.email_id ? lienMail(h.email_id, h.thread_id) : null);

/** Ce que l'historique affiche d'une ligne, sans le préfixe technique de changement de date. */
export const resumeAffiche = (h: LigneHistorique) => (h.resume ?? '').replace(RE_CHANGEMENT, '');

/** Préfixe écrit dans colis_historique.resume quand la date prévue change. */
export const changementDate = (avant: string, apres: string) => `Date modifiée : ${avant} → ${apres}. `;
const RE_CHANGEMENT = /^Date modifiée : (\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})\. /;

/** Description de l'événement (Google Agenda accepte un HTML simple). */
export function descriptionEvenement(c: Colis, historique: LigneHistorique[], maintenant = new Date()): string {
  const lignes: string[] = [];

  // En tête : ce qu'il faut au moment du retrait, puis le dernier mail.
  if (c.code_retrait) lignes.push(`🔑 Code : <b>${echapper(c.code_retrait)}</b>`);
  else if (c.qr_code) lignes.push('📱 QR code à présenter : voir le mail');
  const dernier = historique.find((h) => h.email_id);
  if (dernier) lignes.push(`📧 Dernier mail : ${lien(lienLigne(dernier)!)}`);

  // Historique : les 5 dernières mises à jour, la plus récente d'abord, chacune avec SON mail.
  const recents = historique.slice(0, 5);
  if (recents.length) {
    if (lignes.length) lignes.push('');
    lignes.push('<b>Dernières mises à jour :</b>');
    for (const h of recents) {
      const url = lienLigne(h);
      lignes.push(
        `${jourHeureFr(new Date(h.created_at))} — ${echapper(resumeAffiche(h))}${url ? ` — ${lien(url)}` : ''}`,
      );
    }
  }

  lignes.push('', `<b>Statut :</b> ${LIBELLES_STATUT[c.statut]}`);
  if (c.transporteur) lignes.push(`<b>Transporteur :</b> ${echapper(c.transporteur)}`);
  if (c.numero_suivi) lignes.push(`<b>Numéro de suivi :</b> ${echapper(c.numero_suivi)}`);
  if (c.numero_commande) lignes.push(`<b>Commande :</b> ${echapper(c.numero_commande)}`);
  if (c.url_suivi) lignes.push(`<a href="${echapper(c.url_suivi)}">Suivre le colis</a>`);
  if (c.lieu_livraison) lignes.push(`<b>Livraison :</b> ${echapper(c.lieu_livraison)}`);

  // Dernier changement de date, retrouvé dans l'historique (plus récent d'abord).
  for (const h of historique) {
    const m = h.resume?.match(RE_CHANGEMENT);
    if (m) {
      lignes.push(`<b>Date modifiée :</b> ${jourFr(m[1])} → ${jourFr(m[2])}`);
      break;
    }
  }

  lignes.push('', `<i>Mis à jour le ${horodatageFr(maintenant)} par l’agent colis</i>`);
  return lignes.join('<br>');
}

function lendemain(jour: string): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Rappel des événements « journée entière » : la veille à 20 h (voir docs/decisions.md). */
const RAPPEL_VEILLE_20H = 4 * 60;

function corpsEvenement(c: Colis, historique: LigneHistorique[]) {
  const date = c.date_livraison_prevue!;
  const horaire = c.fenetre_debut
    ? {
        start: { dateTime: c.fenetre_debut, timeZone: FUSEAU, date: null },
        end: {
          dateTime: c.fenetre_fin ?? new Date(new Date(c.fenetre_debut).getTime() + 60 * 60_000).toISOString(),
          timeZone: FUSEAU,
          date: null,
        },
      }
    : {
        start: { date, dateTime: null, timeZone: null },
        end: { date: lendemain(date), dateTime: null, timeZone: null },
      };

  const avecRappel = !c.fenetre_debut && c.statut !== 'livree';
  return {
    summary: titreEvenement(c),
    description: descriptionEvenement(c, historique),
    ...horaire,
    transparency: 'transparent', // n'apparaît pas comme « occupé »
    reminders: {
      useDefault: false,
      overrides: avecRappel ? [{ method: 'popup', minutes: RAPPEL_VEILLE_20H }] : [],
    },
    extendedProperties: { private: { colis_id: c.id } },
  };
}

/**
 * Crée, met à jour ou supprime l'événement du colis. Idempotent : on
 * retrouve l'événement par `calendar_event_id`, à défaut par la propriété
 * privée `colis_id` (cas d'un passage interrompu juste après la création),
 * et on le met à jour (patch) au lieu d'en créer un second.
 */
export async function synchroniserEvenement(
  agenda: Agenda,
  calendarId: string,
  c: Colis,
  historique: LigneHistorique[],
): Promise<{ action: ActionAgenda; eventId: string | null }> {
  const eventId = c.calendar_event_id;

  if (c.statut === 'annulee') {
    if (!eventId) return { action: 'aucune', eventId: null };
    try {
      await agenda.events.delete({ calendarId, eventId });
    } catch (e) {
      if (!introuvable(e)) throw e;
    }
    return { action: 'supprime', eventId: null };
  }

  // Pas de date connue : pas d'événement (il sera créé dès qu'une date arrive).
  if (!c.date_livraison_prevue) return { action: 'aucune', eventId };

  const requestBody = corpsEvenement(c, historique);

  if (eventId) {
    try {
      await agenda.events.patch({ calendarId, eventId, requestBody });
      return { action: 'modifie', eventId };
    } catch (e) {
      if (!introuvable(e)) throw e; // supprimé à la main : on le recrée
    }
  }

  const { data: existants } = await agenda.events.list({
    calendarId,
    privateExtendedProperty: [`colis_id=${c.id}`],
    maxResults: 1,
  });
  const existant = existants.items?.[0]?.id;
  if (existant) {
    await agenda.events.patch({ calendarId, eventId: existant, requestBody });
    return { action: 'modifie', eventId: existant };
  }

  const { data: cree } = await agenda.events.insert({ calendarId, requestBody });
  return { action: 'cree', eventId: cree.id ?? null };
}
