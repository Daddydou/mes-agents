'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  COOKIE_NAME,
  creerJeton,
  optionsCookie,
  verifierMotDePasse,
} from '@/auth/session';

/** Chemin interne uniquement : `//evil.com` serait une redirection ouverte. */
function destinationSure(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
    ? next
    : '/';
}

/**
 * Action de formulaire native (`<form action={seConnecter}>`) : la connexion
 * fonctionne donc aussi sans JavaScript. L'échec repasse par /login, l'erreur
 * étant portée par l'URL — un formulaire de mot de passe n'a pas d'état à
 * conserver.
 */
export async function seConnecter(data: FormData): Promise<void> {
  const saisi = data.get('motDePasse');
  const next = destinationSure(data.get('next'));

  // Ralentit un bourrinage naïf sur l'unique mot de passe de l'app.
  await new Promise((r) => setTimeout(r, 300));

  if (typeof saisi !== 'string' || !verifierMotDePasse(saisi)) {
    const echec = new URLSearchParams({ erreur: '1' });
    if (next !== '/') echec.set('next', next);
    redirect(`/login?${echec}`);
  }

  const jar = await cookies();
  jar.set(COOKIE_NAME, creerJeton(), optionsCookie());

  redirect(next);
}

export async function seDeconnecter(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect('/login');
}
