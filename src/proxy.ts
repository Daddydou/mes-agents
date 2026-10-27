import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifierJeton } from '@/auth/session';

/**
 * Porte d'entrée : tout est privé sauf /login, la page de présentation (/)
 * et /confidentialite (pages exigées par l'écran de consentement Google).
 *
 * En Next.js 16 `middleware.ts` a été renommé `proxy.ts` (runtime Node.js par
 * défaut, d'où l'accès à node:crypto pour vérifier la signature du cookie).
 *
 * ⚠ Le proxy ne remplace pas les contrôles applicatifs : les Server Actions
 * sont des POST vers la route qui les héberge, pas des routes distinctes. Les
 * écritures re-vérifient donc la session de leur côté (`auth/garde.ts`).
 */
const PAGES_PUBLIQUES = new Set(['/', '/confidentialite']);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === '/login') return NextResponse.next();

  // Pages publiques statiques. Une Server Action peut être appelée via
  // n'importe quelle URL : sur ces pages, on ne laisse passer que la lecture.
  const estServerAction = request.headers.get('next-action') !== null;
  if (PAGES_PUBLIQUES.has(pathname) && !estServerAction) return NextResponse.next();

  // Appel machine (GitHub Actions) : pas de cookie possible. La route
  // vérifie elle-même le jeton `Authorization: Bearer <CRON_SECRET>`.
  if (pathname === '/api/colis/sync') return NextResponse.next();

  if (verifierJeton(request.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  // Appels machine (fetch, curl) et Server Actions : une redirection HTML
  // serait illisible pour l'appelant. On répond 401.
  if (pathname.startsWith('/api/') || estServerAction) {
    return Response.json(
      { ok: false, error: 'Non authentifié.' },
      { status: 401 },
    );
  }

  const login = new URL('/login', request.url);
  // Retour à la page demandée après connexion. Chemin interne uniquement :
  // `//evil.com` est une URL protocol-relative, donc une redirection ouverte.
  const cible = `${pathname}${search}`;
  if (cible.startsWith('/') && !cible.startsWith('//')) {
    login.searchParams.set('next', cible);
  }
  return NextResponse.redirect(login);
}

export const config = {
  // Tout, sauf les assets statiques — /api inclus, volontairement.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
