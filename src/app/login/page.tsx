import { redirect } from 'next/navigation';
import { seConnecter } from './actions';
import { sessionValide } from '@/auth/garde';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; erreur?: string }>;
}) {
  // Le proxy laisse /login passer sans cookie : c'est ici qu'on renvoie un
  // visiteur déjà connecté vers l'app.
  if (await sessionValide()) redirect('/');

  const { next, erreur } = await searchParams;

  return (
    <main style={{ padding: 40, maxWidth: 320 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Accès privé</h1>
      <p style={{ marginBottom: 16 }}>Cet outil est personnel. Mot de passe requis.</p>

      <form action={seConnecter}>
        <input type="hidden" name="next" value={next ?? ''} />
        <input
          type="password"
          name="motDePasse"
          placeholder="Mot de passe"
          autoFocus
          autoComplete="current-password"
          style={{ padding: 8, width: '100%', marginBottom: 8 }}
        />
        <button type="submit">Entrer</button>
      </form>

      {erreur && <p style={{ color: 'crimson', marginTop: 12 }}>Mot de passe incorrect.</p>}
    </main>
  );
}
