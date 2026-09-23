import { cookies } from 'next/headers';
import { COOKIE_NAME, verifierJeton } from './session';

/**
 * Contrôle de session à l'intérieur du code applicatif.
 *
 * Le proxy ne suffit PAS : les Server Actions ne sont pas des routes à part,
 * ce sont des POST vers la route qui les utilise. Un changement de matcher ou
 * un déplacement d'action peut donc silencieusement les sortir de la
 * couverture du proxy. La doc Next 16 est explicite là-dessus : vérifier
 * l'authentification DANS chaque Server Function.
 *
 * Cette garde est la ligne de défense qui compte ; le proxy n'est là que pour
 * rediriger proprement vers /login.
 */
export async function sessionValide(): Promise<boolean> {
  const jar = await cookies();
  return verifierJeton(jar.get(COOKIE_NAME)?.value);
}

/** Lève si la session est absente ou invalide. À appeler dans toute écriture. */
export async function exigerSession(): Promise<void> {
  if (!(await sessionValide())) {
    throw new Error('Non authentifié.');
  }
}
