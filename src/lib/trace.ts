/**
 * Trace de raisonnement montrée à l'utilisateur : ce que l'agent a lu dans
 * les données internes et ce qu'il a trouvé sur internet, pour pouvoir
 * vérifier un pick avant de le suivre.
 *
 * Elle est reconstruite à partir des étapes que generateText a DÉJÀ faites :
 * aucun appel Claude ni aucune recherche web en plus.
 */

export type EtapeTrace =
  | { type: 'donnees_internes'; outil: string; entree: unknown; resultat: unknown }
  | { type: 'recherche_web'; requete: string; resultats: { titre: string; url: string }[] }
  | { type: 'erreur_outil'; outil: string; message: string };

export type Trace = {
  etapes: EtapeTrace[];
  /** Nombre d'allers-retours avec Claude (5 max, cf. stopWhen). */
  appelsClaude: number;
  recherchesWeb: number;
};

// Forme minimale des étapes de generateText dont on a besoin.
type Etape = {
  content: ReadonlyArray<
    | { type: 'tool-result'; toolName: string; input: unknown; output: unknown }
    | { type: 'tool-error'; toolName: string; error: unknown }
    | { type: string }
  >;
};

function resultatsWeb(output: unknown): { titre: string; url: string }[] {
  if (!Array.isArray(output)) return [];
  return output
    .filter((r): r is { url: string; title?: string } => typeof r?.url === 'string')
    .map((r) => ({ titre: r.title ?? r.url, url: r.url }));
}

export function construireTrace(steps: ReadonlyArray<Etape>): Trace {
  const etapes: EtapeTrace[] = [];

  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === 'tool-result' && 'toolName' in part && 'output' in part) {
        if (part.toolName === 'web_search') {
          const requete = (part.input as { query?: unknown } | undefined)?.query;
          etapes.push({
            type: 'recherche_web',
            requete: typeof requete === 'string' ? requete : '(requête inconnue)',
            resultats: resultatsWeb(part.output),
          });
        } else {
          etapes.push({
            type: 'donnees_internes',
            outil: part.toolName,
            entree: part.input,
            resultat: part.output,
          });
        }
      } else if (part.type === 'tool-error' && 'toolName' in part && 'error' in part) {
        etapes.push({
          type: 'erreur_outil',
          outil: part.toolName,
          message: part.error instanceof Error ? part.error.message : String(part.error),
        });
      }
    }
  }

  return {
    etapes,
    appelsClaude: steps.length,
    recherchesWeb: etapes.filter((e) => e.type === 'recherche_web').length,
  };
}
