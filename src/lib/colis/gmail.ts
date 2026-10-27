import 'server-only';
import type { Gmail } from './google';
import { COMPTE_GMAIL, TAILLE_MAX_CORPS } from './config';

/** Un mail prêt à être analysé. Le corps ne quitte jamais la mémoire du serveur. */
export type Mail = {
  id: string;
  threadId: string | null;
  sujet: string;
  expediteur: string;
  recuLe: Date;
  corps: string;
};

/**
 * Identifiants des mails correspondant à la requête, du plus RÉCENT au plus
 * ancien (ordre renvoyé par Gmail). Plafonné pour ne pas parcourir des
 * milliers de mails si la requête est trop large.
 */
export async function listerMails(gmail: Gmail, requete: string, plafond = 500): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: requete,
      maxResults: 100,
      pageToken,
    });
    for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < plafond);
  return ids.slice(0, plafond);
}

type Partie = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: Partie[] | null;
};

function decoder(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

/** Premier contenu du type demandé, en parcourant l'arbre MIME. */
function chercher(partie: Partie | undefined, type: string): string | null {
  if (!partie) return null;
  if (partie.mimeType === type && partie.body?.data) return decoder(partie.body.data);
  for (const p of partie.parts ?? []) {
    const trouve = chercher(p, type);
    if (trouve) return trouve;
  }
  return null;
}

export async function lireMail(gmail: Gmail, id: string): Promise<Mail> {
  const { data } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const entetes = data.payload?.headers ?? [];
  const entete = (nom: string) =>
    entetes.find((h) => h.name?.toLowerCase() === nom)?.value ?? '';

  // Le HTML est souvent plus complet que la version texte (tableaux de
  // suivi, adresses de point relais) : on le préfère quand il existe.
  const html = chercher(data.payload as Partie, 'text/html');
  const texte = html ? htmlVersTexte(html) : chercher(data.payload as Partie, 'text/plain') ?? '';

  return {
    id,
    threadId: data.threadId ?? null,
    sujet: entete('subject'),
    expediteur: entete('from'),
    recuLe: new Date(Number(data.internalDate ?? Date.now())),
    corps: tronquer(nettoyer(texte || data.snippet || ''), TAILLE_MAX_CORPS),
  };
}

const ENTITES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç',
  ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euro: '€',
  rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…',
};

/**
 * HTML → texte brut, sans dépendance : on retire styles, scripts et
 * balises, on garde les sauts de ligne utiles et les liens (le lien de
 * suivi est souvent seulement dans un `href`).
 */
export function htmlVersTexte(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Lien de suivi : on garde l'URL à côté du texte du lien. Les URL de
    // tracking publicitaire géantes mangeraient le budget de 6000 caractères.
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, txt: string) =>
      /^https?:/i.test(href) && href.length <= 400 ? `${txt} (${href}) ` : txt,
    )
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, nom: string) => ENTITES[nom.toLowerCase()] ?? m);
}

function nettoyer(texte: string): string {
  return texte
    .replace(/[​-‍﻿­͏]/g, '') // caractères invisibles des mails marketing
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tronquer(texte: string, max: number): string {
  return texte.length <= max ? texte : `${texte.slice(0, max)}\n[… mail tronqué]`;
}

/**
 * Lien qui ouvre UN mail précis dans Gmail (testé le 27/10/2026, voir
 * docs/decisions.md). `#all/<id du fil>` ouvre la conversation sur son mail
 * le plus RÉCENT : faux quand Gmail range deux avis Colissimo dans le même
 * fil. `#all/<id du message>` échoue pour le 1er mail d'un fil (son id est
 * aussi celui du fil). La forme `thread-f:<fil>|msg-f:<message>` (ids en
 * décimal) ouvre toujours le bon mail ; sans fil connu, on se rabat sur l'id
 * du message.
 */
export function lienMail(emailId: string, threadId: string | null): string {
  const base = `https://mail.google.com/mail/?authuser=${COMPTE_GMAIL}#all/`;
  const decimal = (hex: string) => BigInt(`0x${hex}`).toString();
  if (!threadId || !/^[0-9a-f]{1,16}$/i.test(threadId) || !/^[0-9a-f]{1,16}$/i.test(emailId)) {
    return `${base}${encodeURIComponent(emailId)}`;
  }
  return `${base}${encodeURIComponent(`#thread-f:${decimal(threadId)}|msg-f:${decimal(emailId)}`)}`;
}
