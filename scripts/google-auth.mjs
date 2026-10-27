// Autorisation Google, à lancer UNE SEULE FOIS pour obtenir le refresh token :
//
//   node --env-file=.env.local scripts/google-auth.mjs
//
// (.env.local doit déjà contenir GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.)
//
// Le script ouvre la page de consentement Google, récupère le code sur
// http://localhost:3456/callback, l'échange et AFFICHE le refresh token :
// copie-le dans GOOGLE_REFRESH_TOKEN (.env.local puis Vercel).
//
// Avec --ecrire-env, il n'affiche RIEN : il écrit GOOGLE_REFRESH_TOKEN
// directement dans .env.local (en remplaçant l'ancienne valeur).

import http from 'node:http';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { OAuth2Client } from 'google-auth-library';

// Mêmes droits que src/lib/colis/google.ts — et rien d'autre.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.app.created',
];
const PORT = 3456;
const REDIRECT = `http://localhost:${PORT}/callback`;

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET manquants.');
  console.error('Lance : node --env-file=.env.local scripts/google-auth.mjs');
  process.exit(1);
}

const client = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  redirectUri: REDIRECT,
});

const url = client.generateAuthUrl({
  access_type: 'offline', // pour obtenir un refresh token
  prompt: 'consent', // force Google à renvoyer le refresh token
  scope: SCOPES,
  login_hint: 'lolo.rms@gmail.com',
});

const serveur = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', REDIRECT);
  if (u.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const erreur = u.searchParams.get('error');
  const code = u.searchParams.get('code');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  if (erreur || !code) {
    res.end(`<p>Autorisation refusée (${erreur ?? 'pas de code'}). Tu peux fermer cet onglet.</p>`);
    console.error(`\nAutorisation refusée : ${erreur ?? 'pas de code'}`);
    serveur.close();
    process.exitCode = 1;
    return;
  }

  try {
    const { tokens } = await client.getToken(code);
    res.end('<p>C’est bon ✅ Retourne dans le terminal. Tu peux fermer cet onglet.</p>');
    if (!tokens.refresh_token) {
      console.error('\nGoogle n’a pas renvoyé de refresh token. Retire l’accès de l’app sur');
      console.error('https://myaccount.google.com/permissions puis relance le script.');
      process.exitCode = 1;
    } else if (process.argv.includes('--ecrire-env')) {
      const ligne = `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`;
      let env = fs.readFileSync('.env.local', 'utf8');
      env = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(env)
        ? env.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, ligne)
        : `${env.replace(/\n*$/, '\n')}${ligne}\n`;
      fs.writeFileSync('.env.local', env);
      console.log('\nRefresh token écrit dans .env.local (non affiché).');
      console.log('Droits accordés :', tokens.scope);
    } else {
      console.log('\nRefresh token (à mettre dans GOOGLE_REFRESH_TOKEN, ne le partage pas) :\n');
      console.log(tokens.refresh_token);
      console.log('\nDroits accordés :', tokens.scope);
    }
  } catch (e) {
    res.end('<p>Erreur pendant l’échange du code. Regarde le terminal.</p>');
    console.error('\nÉchange du code impossible :', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
  serveur.close();
});

serveur.listen(PORT, () => {
  if (process.argv.includes('--ecrire-env')) {
    // L'adresse contient le client ID : on ne l'affiche pas dans ce mode.
    console.log('Le navigateur s’ouvre sur la page de consentement Google…');
    console.log('(S’il ne s’ouvre pas, relance le script sans --ecrire-env pour voir l’adresse.)');
  } else {
    console.log('Ouvre cette adresse si le navigateur ne s’ouvre pas tout seul :\n');
    console.log(url, '\n');
  }
  const ouvrir =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(ouvrir, () => {});
});
