import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Nombre de joueurs demandés à Tennis App par moitié de tableau. Large, car on
// retire ensuite ceux que le stock a déjà pickés.
const LIMITE_TENNIS_APP = 10;

// Réponse de GET /api/agent/tour-courant (Tennis App). Seuls les champs
// utilisés sont typés ; le reste est laissé tel quel.
const ReponseTourCourant = z.object({
  ok: z.boolean(),
  tournoi: z.unknown(),
  tours: z.unknown(),
  tour_en_cours: z.unknown(),
  projections: z.unknown(),
  recommandations: z.array(
    z.object({
      moitie: z.union([z.string(), z.number()]).nullable(),
      joueurs: z.array(
        z.object({
          player_id: z.union([z.string(), z.number()]),
          nom: z.string(),
          esperance_points: z.number(),
        })
      ),
    })
  ),
});

// Appel serveur uniquement : le jeton ne doit jamais partir vers le navigateur.
async function lireTourCourant(tournamentId: string) {
  const base = process.env.TENNIS_APP_URL;
  const jeton = process.env.AGENT_API_TOKEN;
  if (!base || !jeton) {
    return { erreur: 'TENNIS_APP_URL ou AGENT_API_TOKEN non défini.' } as const;
  }

  const url = new URL('/api/agent/tour-courant', base);
  url.searchParams.set('tournoi', tournamentId);
  url.searchParams.set('limite', String(LIMITE_TENNIS_APP));

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${jeton}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { erreur: `Tennis App injoignable : ${(e as Error).message}` } as const;
  }
  if (!res.ok) {
    return { erreur: `Tennis App a répondu HTTP ${res.status}.` } as const;
  }

  const parse = ReponseTourCourant.safeParse(await res.json().catch(() => null));
  if (!parse.success || !parse.data.ok) {
    return { erreur: 'Réponse de Tennis App illisible ou en échec.' } as const;
  }
  return { donnees: parse.data } as const;
}

const get_tennis_recommendation = tool({
  description:
    "Donne les meilleurs picks tennis du tour en cours d'un tournoi (calculés par Tennis App), par moitié de tableau, en excluant les joueurs déjà pickés par ce stock.",
  inputSchema: z.object({
    tournoi: z.string().describe("Nom (ou partie du nom) du tournoi, ex: 'Guadalajara'"),
    stock: z.enum(['daddy', 'laki', 'thomas']).default('daddy').describe("Le stock de picks à considérer"),
  }),
  execute: async ({ tournoi, stock }) => {
    // 1. Trouver le tournoi par son nom
    const { data: tournaments, error: errT } = await supabase
      .from('tn_tournaments')
      .select('id, name')
      .ilike('name', `%${tournoi}%`);

    if (errT) return { error: `Erreur Supabase (tournois): ${errT.message}` };
    if (!tournaments || tournaments.length === 0) {
      const { data: tous } = await supabase.from('tn_tournaments').select('name');
      return { status: 'tournoi_introuvable', tournois_disponibles: tous?.map((t) => t.name) };
    }
    const tournamentId = tournaments[0].id;

    // 2. Tour en cours et recommandations : logique de Tennis App
    const tourCourant = await lireTourCourant(tournamentId);
    if ('erreur' in tourCourant) {
      return { status: 'tennis_app_indisponible', message: tourCourant.erreur };
    }
    const d = tourCourant.donnees;

    if (d.tour_en_cours === null) {
      return { status: 'tournoi_termine', tournoi: tournaments[0].name };
    }
    if (d.projections === 'absentes') {
      return {
        status: 'projections_absentes',
        tournoi: tournaments[0].name,
        tour: d.tour_en_cours,
        message: 'Les projections de ce tour ne sont pas encore calculées. Réessaie plus tard.',
      };
    }

    // 3. Trouver le participant_id du stock demandé (null = Daddy)
    let participantId: number | null = null;
    if (stock !== 'daddy') {
      const { data: participants } = await supabase
        .from('tn_participants')
        .select('id, name')
        .ilike('name', `%${stock}%`);
      participantId = participants?.[0]?.id ?? null;
    }

    // 4. Joueurs déjà pickés par ce stock sur ce tournoi (tous tours confondus)
    let picksQuery = supabase.from('tn_picks').select('player_id').eq('tournament_id', tournamentId);
    picksQuery = participantId === null
      ? picksQuery.is('participant_id', null)
      : picksQuery.eq('participant_id', participantId);
    const { data: dejaPickes } = await picksQuery;
    const idsDejaPickes = new Set((dejaPickes ?? []).map((p) => String(p.player_id)));

    // 5. Recommandations de Tennis App, sans les joueurs déjà pickés.
    // En demi-finale/finale il n'y a qu'un bloc, avec moitie: null.
    const recommandations = d.recommandations.map((bloc) => ({
      moitie: bloc.moitie,
      joueurs: bloc.joueurs
        .filter((j) => !idsDejaPickes.has(String(j.player_id)))
        .map((j) => ({ joueur: j.nom, esperance_points: j.esperance_points })),
    }));

    return { status: 'ok', tournoi: tournaments[0].name, tour: d.tour_en_cours, recommandations };
  },
});

// Corps envoyé par la page : { tournoi, stock }
const Corps = z.object({
  tournoi: z.string().trim().min(1),
  stock: z.enum(['daddy', 'laki', 'thomas']).default('daddy'),
});

export async function POST(req: Request) {
  const corps = Corps.safeParse(await req.json().catch(() => null));
  if (!corps.success) {
    return Response.json({ reponse: 'Requête invalide : indique un nom de tournoi.' }, { status: 400 });
  }
  const { tournoi, stock } = corps.data;
  const question = `Quel est mon meilleur pick tennis pour le tour en cours du tournoi « ${tournoi} », avec le stock « ${stock} » ?`;

  const result = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    tools: {
      get_tennis_recommendation,
      web_search: anthropic.tools.webSearch_20250305(),
    },
    stopWhen: ({ steps }) => steps.length >= 5,
    system: `Tu es un conseiller de picks tennis expert. Utilise TOUJOURS d'abord l'outil get_tennis_recommendation pour connaître les meilleurs candidats du tour en cours. Si le tournoi n'est pas trouvé, propose la liste des tournois disponibles reçue. Les recommandations sont regroupées par moitié de tableau (champ "moitie", null en demi-finale/finale) : présente le meilleur candidat de chaque moitié. Ensuite, cherche sur internet (web_search) des infos complémentaires sur le ou les meilleurs joueurs recommandés : forme récente, blessure, surface, actualité du tournoi. Termine par une recommandation claire, justifiée par les statistiques internes ET le contexte externe.

RÈGLE ABSOLUE : si l'outil ne renvoie pas de recommandations (status "tournoi_termine", "projections_absentes", "tennis_app_indisponible" ou erreur), ne recommande AUCUN joueur et n'effectue pas de recherche web. Explique simplement la situation (tournoi terminé, ou projections pas encore prêtes / Tennis App indisponible : réessayer plus tard).`,
    prompt: question,
  });

  return Response.json({ reponse: result.text });
}
