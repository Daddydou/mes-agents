'use server';

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { exigerSession } from '@/auth/garde';

/**
 * Avis « ce pick était bon / mauvais » envoyé par la page.
 *
 * Ce n'est PAS un agent qui écrit : c'est l'utilisateur, via cette Server
 * Action protégée par le mot de passe. Aucun appel Claude ici.
 * L'écriture passe par la fonction dédiée enregistrer_avis_agent
 * (supabase/migrations/0002_avis_agents.sql), qui ne sait faire qu'insérer.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const Avis = z.object({
  agent: z.enum(['ttfl', 'tennis']),
  verdict: z.enum(['bon', 'mauvais']),
  question: z.string().min(1).max(2000),
  reponse: z.string().min(1).max(20000),
  trace: z.unknown().optional(),
  commentaire: z.string().max(1000).optional(),
});

export async function enregistrerAvis(
  avis: z.input<typeof Avis>
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  await exigerSession();

  const parse = Avis.safeParse(avis);
  if (!parse.success) return { ok: false, erreur: 'Avis invalide.' };
  const a = parse.data;

  const { error } = await supabase.rpc('enregistrer_avis_agent', {
    p_agent: a.agent,
    p_verdict: a.verdict,
    p_question: a.question,
    p_reponse: a.reponse,
    p_trace: a.trace ?? null,
    p_commentaire: a.commentaire ?? null,
  });
  if (error) return { ok: false, erreur: `Erreur Supabase : ${error.message}` };
  return { ok: true };
}
