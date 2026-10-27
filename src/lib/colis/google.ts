import 'server-only';
import { OAuth2Client } from 'google-auth-library';
import { gmail } from '@googleapis/gmail';
import { calendar } from '@googleapis/calendar';

/**
 * Accès Google au nom de lolo.rms@gmail.com, via le refresh token obtenu
 * une seule fois avec `scripts/google-auth.mjs`.
 *
 * Droits accordés (et rien d'autre) :
 * - gmail.readonly : lire les mails, impossible d'en envoyer, d'en
 *   supprimer ou de les étiqueter ;
 * - calendar.app.created : gérer UNIQUEMENT les agendas créés par cette
 *   app (« 📦 Colis »), jamais l'agenda principal.
 */
export const SCOPES_GOOGLE = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];

function clientOAuth(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou GOOGLE_REFRESH_TOKEN manquant (voir scripts/google-auth.mjs).',
    );
  }
  const client = new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
  });
  client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return client;
}

export function clientsGoogle() {
  const auth = clientOAuth();
  return {
    gmail: gmail({ version: 'v1', auth }),
    agenda: calendar({ version: 'v3', auth }),
  };
}

export type Gmail = ReturnType<typeof clientsGoogle>['gmail'];
export type Agenda = ReturnType<typeof clientsGoogle>['agenda'];
