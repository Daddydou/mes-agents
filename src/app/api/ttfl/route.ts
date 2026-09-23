import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

// Connexion à ta base Supabase existante
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// OUTIL 1 : va chercher le pick du soir dans Supabase
const get_ttfl_pick = tool({
  description:
    "Récupère le pick TTFL du soir recommandé par le moteur d'optimisation interne (projection, forme, ceiling, matchup, explication, statut du joueur). À utiliser en premier pour toute question sur le pick du jour.",
  inputSchema: z.object({}), // pas besoin de paramètre, toujours "aujourd'hui"
  execute: async () => {
    // Les tables ttfl_* sont fermées à la clé anon : on passe par la fonction
    // SECURITY DEFINER en lecture seule (supabase/migrations/0001_get_ttfl_pick_du_jour.sql),
    // qui renvoie { status: 'ok', ... } ou { status: 'no_pick_yet', game_date }.
    const { data, error } = await supabase.rpc('get_ttfl_pick_du_jour', { p_mode: 'regular' });

    if (error) {
      return { error: `Erreur Supabase: ${error.message}` };
    }
    if (data?.status !== 'ok') {
      return { status: 'no_pick_yet', message: `Pas encore de pick calculé pour le ${data?.game_date}.` };
    }
    return { status: 'ok', pick: data };
  },
});

// La route API que ton navigateur va appeler
export async function POST(req: Request) {
  const { question } = await req.json();

  const result = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    tools: {
      get_ttfl_pick,
      web_search: anthropic.tools.webSearch_20250305(),
    },
    stopWhen: ({ steps }) => steps.length >= 5, // garde-fou : jamais plus de 5 allers-retours
    system: `Tu es un conseiller TTFL expert. Pour répondre, utilise TOUJOURS d'abord l'outil get_ttfl_pick pour connaître le pick recommandé par le moteur interne. Ensuite, cherche sur internet (web_search) des informations complémentaires sur ce joueur : actualité du jour, statut de blessure, repos, contexte du match — tout ce que le moteur interne ne peut pas savoir. Si le champ "player_status" ou "is_urgent" du pick indique un problème potentiel, vérifie-le en priorité sur internet. Termine par une recommandation claire, justifiée à la fois par les statistiques internes et par le contexte externe trouvé.

RÈGLE ABSOLUE : si get_ttfl_pick ne renvoie pas de pick (status "no_pick_yet" ou erreur), ne recommande AUCUN joueur, même à partir d'infos trouvées sur internet. Réponds simplement qu'aucun pick n'est calculé pour ce soir (avec la date renvoyée) et n'effectue pas de recherche web. Les articles en ligne peuvent être anciens : ne présente jamais un match comme étant « ce soir » sans que l'outil interne le confirme.`,
    prompt: question,
  });

  return Response.json({ reponse: result.text });
}