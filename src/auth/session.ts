import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Session à mot de passe unique (outil personnel mono-utilisateur).
 *
 * Le cookie ne contient qu'une date d'expiration, signée en HMAC-SHA256 : il
 * n'y a rien à stocker côté serveur. Sans le secret, le jeton n'est pas
 * forgeable ; l'expiration étant DANS la charge signée, elle n'est pas
 * modifiable par le client (contrairement au `Max-Age` du cookie).
 *
 * Module volontairement sans `next/headers` : il doit rester importable
 * depuis `proxy.ts`, qui s'exécute avant le rendu.
 */

export const COOKIE_NAME = 'agents_session';
/** 30 jours — outil perso, on ne se reconnecte pas tous les jours. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function motDePasseAttendu(): string {
  const p = process.env.APP_PASSWORD;
  if (!p) {
    throw new Error(
      'APP_PASSWORD non défini : toute l’app serait accessible sans mot de passe.',
    );
  }
  return p;
}

/**
 * Clé de signature. `AUTH_SECRET` de préférence ; à défaut on la dérive du mot
 * de passe — changer le mot de passe invalide alors les sessions en cours, ce
 * qui est le comportement souhaitable.
 */
function cleSignature(): string {
  return process.env.AUTH_SECRET || `derive:v1:${motDePasseAttendu()}`;
}

/** Comparaison à temps constant, robuste aux longueurs différentes. */
function egaliteConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual exige des longueurs égales : on compare les empreintes,
  // de taille fixe, puis la longueur réelle.
  const ha = createHmac('sha256', 'cmp').update(ba).digest();
  const hb = createHmac('sha256', 'cmp').update(bb).digest();
  return timingSafeEqual(ha, hb) && ba.length === bb.length;
}

export function verifierMotDePasse(saisi: string): boolean {
  return egaliteConstante(saisi, motDePasseAttendu());
}

function signer(charge: string): string {
  return createHmac('sha256', cleSignature()).update(charge).digest('base64url');
}

/** Jeton `<charge base64url>.<signature base64url>`. */
export function creerJeton(maintenant = Date.now()): string {
  const charge = Buffer.from(
    JSON.stringify({ exp: Math.floor(maintenant / 1000) + COOKIE_MAX_AGE }),
  ).toString('base64url');
  return `${charge}.${signer(charge)}`;
}

export function verifierJeton(
  jeton: string | undefined | null,
  maintenant = Date.now(),
): boolean {
  if (!jeton) return false;
  const point = jeton.indexOf('.');
  if (point <= 0) return false;

  const charge = jeton.slice(0, point);
  const signature = jeton.slice(point + 1);

  // Signature d'abord : on ne parse jamais une charge non authentifiée.
  if (!egaliteConstante(signature, signer(charge))) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp * 1000 > maintenant;
  } catch {
    return false;
  }
}

/** Options du cookie de session. `httpOnly` : illisible en JavaScript. */
export function optionsCookie() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}
