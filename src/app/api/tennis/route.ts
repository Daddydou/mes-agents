import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Ordre standard des tours, pour trouver "le tour en cours"
const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'];

// Statuts d'un match pas encore joué (les autres : completed, retired, walkover, bye)
const STATUTS_EN_ATTENTE = ['scheduled', 'live', 'in_progress'];

const get_tennis_recommendation = tool({
  description:
    "Donne les meilleurs picks tennis disponibles pour le tour en cours d'un tournoi, en excluant les joueurs déjà pickés par ce stock et les joueurs déjà éliminés à ce tour.",
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

    // 2. Trouver le participant_id du stock demandé (null = Daddy)
    let participantId: number | null = null;
    if (stock !== 'daddy') {
      const { data: participants } = await supabase
        .from('tn_participants')
        .select('id, name')
        .ilike('name', `%${stock}%`);
      participantId = participants?.[0]?.id ?? null;
    }

    // 3. Déterminer le tour en cours : premier tour (dans l'ordre standard)
    // qui a encore un match non terminé
    const { data: matchesEnCours } = await supabase
      .from('tn_matches')
      .select('round')
      .eq('tournament_id', tournamentId)
      .in('status', STATUTS_EN_ATTENTE);

    if (!matchesEnCours || matchesEnCours.length === 0) {
      return { status: 'aucun_tour_en_cours', message: 'Aucun match en attente pour ce tournoi.' };
    }
    const roundsEnCours = [...new Set(matchesEnCours.map((m) => m.round))];
    const tourActuel = roundsEnCours.sort(
      (a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b)
    )[0];

    // 4. Joueurs déjà pickés par ce stock sur ce tournoi (tous tours confondus)
    let picksQuery = supabase.from('tn_picks').select('player_id').eq('tournament_id', tournamentId);
    picksQuery = participantId === null
      ? picksQuery.is('participant_id', null)
      : picksQuery.eq('participant_id', participantId);
    const { data: dejaPickes } = await picksQuery;
    const idsDejaPickes = dejaPickes?.map((p) => p.player_id) ?? [];

    // 5. Joueurs dont le match de ce tour n'est plus en attente : on ne peut
    // plus les picker pour ce tour, qu'ils aient gagné ou perdu. Couvre
    // completed, retired, walkover et bye (qualifié sans jouer).
    const { data: matchesDuTour } = await supabase
      .from('tn_matches')
      .select('player1_id, player2_id, status')
      .eq('tournament_id', tournamentId)
      .eq('round', tourActuel);

    const idsDejaJoues = (matchesDuTour ?? [])
      .filter((m) => !STATUTS_EN_ATTENTE.includes(m.status))
      .flatMap((m) => [m.player1_id, m.player2_id])
      .filter((id) => id != null);

    const idsAExclure = [...new Set([...idsDejaPickes, ...idsDejaJoues])];

    // 6. Les projections pour ce tour, triées par e_points
    let projQuery = supabase
      .from('tn_projections')
      .select('player_id, e_points')
      .eq('tournament_id', tournamentId)
      .eq('from_round', tourActuel)
      .eq('round', tourActuel)
      .gt('e_points', 0)
      .order('e_points', { ascending: false })
      .limit(10);

    if (idsAExclure.length > 0) {
      projQuery = projQuery.not('player_id', 'in', `(${idsAExclure.join(',')})`);
    }

    const { data: projections, error: errP } = await projQuery;
    if (errP) return { error: `Erreur Supabase (projections): ${errP.message}` };

    // 7. Récupérer les noms des joueurs
    const idsJoueurs = (projections ?? []).map((p) => p.player_id);
    const { data: joueurs } = await supabase
      .from('tn_players')
      .select('id, name')
      .in('id', idsJoueurs.length > 0 ? idsJoueurs : [-1]);

    const recommandations = (projections ?? []).map((p) => ({
      joueur: joueurs?.find((j) => j.id === p.player_id)?.name ?? `Joueur #${p.player_id}`,
      e_points: p.e_points,
    }));

    return { status: 'ok', tournoi: tournaments[0].name, tour: tourActuel, recommandations };
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
    system: `Tu es un conseiller de picks tennis expert. Utilise TOUJOURS d'abord l'outil get_tennis_recommendation pour connaître les meilleurs candidats du tour en cours. Si le tournoi n'est pas trouvé, propose la liste des tournois disponibles reçue. Ensuite, cherche sur internet (web_search) des infos complémentaires sur le ou les meilleurs joueurs recommandés : forme récente, blessure, surface, actualité du tournoi. Termine par une recommandation claire, justifiée par les statistiques internes ET le contexte externe.`,
    prompt: question,
  });

  return Response.json({ reponse: result.text });
}