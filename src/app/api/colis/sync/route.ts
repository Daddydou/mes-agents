import { createHash, timingSafeEqual } from 'node:crypto';
import { synchroniserColis } from '@/lib/colis/sync';
import { reprendreColisEnCours } from '@/lib/colis/reprise';

// Appelée toutes les 30 min par GitHub Actions (.github/workflows/colis-sync.yml).
// Le proxy la laisse passer sans cookie : c'est ce jeton qui la protège.
export const maxDuration = 60;

function jetonValide(req: Request): boolean {
  const attendu = process.env.CRON_SECRET;
  if (!attendu) return false; // pas de secret configuré : on refuse tout
  const recu = req.headers.get('authorization') ?? '';
  // Empreintes de taille fixe : comparaison à temps constant.
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(recu), h(`Bearer ${attendu}`));
}

export async function GET(req: Request) {
  if (!jetonValide(req)) {
    return Response.json({ ok: false, error: 'Non autorisé.' }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  // ?dryRun=1 : lit et analyse, n'écrit RIEN (ni Supabase, ni agenda).
  const simulation = params.get('dryRun') === '1';
  // ?max=N (simulation seulement, 50 au plus) : voir plus de mails d'un coup pour régler le tri.
  const max = simulation && params.get('max') ? Math.min(Math.max(Number(params.get('max')) || 1, 1), 50) : undefined;

  try {
    // ?reprise=1 : remise à jour unique des colis en cours (liens + code de retrait), voir reprise.ts.
    if (params.get('reprise') === '1') {
      return Response.json({ ok: true, ...(await reprendreColisEnCours({ simulation })) });
    }
    const rapport = await synchroniserColis({ simulation, max });
    return Response.json({ ok: true, ...rapport });
  } catch (e) {
    // Message seulement : jamais l'objet d'erreur complet (il peut contenir un mail).
    const message = e instanceof Error ? e.message : String(e);
    console.error('[colis/sync]', message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
