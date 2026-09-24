'use client';
import { useState } from 'react';
import type { Trace } from '@/lib/trace';
import { enregistrerAvis } from './actions';
import { seDeconnecter } from './login/actions';

// Une seule interface « conseiller » : on choisit le sujet, puis on demande.
// Chaque sujet garde sa propre route (/api/ttfl, /api/tennis) : le choix se
// fait ici, sans appel Claude supplémentaire pour « aiguiller » la question.
type Agent = 'ttfl' | 'tennis';
type Stock = 'daddy' | 'laki' | 'thomas';

type Resultat = {
  agent: Agent;
  question: string;
  reponse: string;
  trace?: Trace;
};

export default function Conseiller() {
  const [agent, setAgent] = useState<Agent>('ttfl');
  const [tournoi, setTournoi] = useState('');
  const [stock, setStock] = useState<Stock>('daddy');
  const [loading, setLoading] = useState(false);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState('');

  async function demander() {
    setLoading(true);
    setResultat(null);
    setErreur('');
    const body =
      agent === 'ttfl'
        ? { question: 'Quel est mon meilleur pick TTFL ce soir ?' }
        : { tournoi, stock };
    try {
      const res = await fetch(`/api/${agent}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.reponse !== 'string') {
        setErreur(data.reponse ?? data.error ?? `Erreur ${res.status}`);
      } else {
        setResultat({ agent, question: data.question ?? '', reponse: data.reponse, trace: data.trace });
      }
    } catch {
      setErreur('Serveur injoignable.');
    }
    setLoading(false);
  }

  const peutDemander = !loading && (agent === 'ttfl' || tournoi.trim() !== '');

  return (
    <main style={{ padding: 40, maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>Conseiller</h1>
        <form action={seDeconnecter}>
          <button type="submit" style={{ fontSize: 13 }}>Se déconnecter</button>
        </form>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['ttfl', 'tennis'] as const).map((a) => (
          <button
            key={a}
            role="tab"
            aria-selected={agent === a}
            onClick={() => setAgent(a)}
            disabled={loading}
            style={{
              padding: '6px 14px',
              border: '1px solid currentColor',
              borderRadius: 6,
              fontWeight: agent === a ? 700 : 400,
              opacity: agent === a ? 1 : 0.6,
            }}
          >
            {a === 'ttfl' ? 'TTFL' : 'Tennis'}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (peutDemander) demander();
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}
      >
        {agent === 'tennis' && (
          <>
            <input
              type="text"
              placeholder="Nom du tournoi (ex: Guadalajara, Singapore...)"
              value={tournoi}
              onChange={(e) => setTournoi(e.target.value)}
              style={{ padding: 8, width: 300 }}
            />
            <select value={stock} onChange={(e) => setStock(e.target.value as Stock)} style={{ padding: 8 }}>
              <option value="daddy">Stock Daddy</option>
              <option value="laki">Stock Laki</option>
              <option value="thomas">Stock Thomas</option>
            </select>
          </>
        )}
        <button type="submit" disabled={!peutDemander}>
          {agent === 'ttfl' ? 'Pick TTFL du soir' : 'Pick Tennis'}
        </button>
      </form>
      <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 20 }}>
        Chaque demande coûte des crédits Anthropic (jusqu&apos;à 5 appels Claude + recherches web).
      </p>

      {loading && <p>Réflexion en cours...</p>}
      {erreur && <p style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{erreur}</p>}
      {resultat && <Reponse key={resultat.reponse} resultat={resultat} />}
    </main>
  );
}

function Reponse({ resultat }: { resultat: Resultat }) {
  const { trace } = resultat;
  return (
    <section>
      <p style={{ whiteSpace: 'pre-wrap' }}>{resultat.reponse}</p>
      {trace && <TraceVisible trace={trace} />}
      <Avis resultat={resultat} />
    </section>
  );
}

function TraceVisible({ trace }: { trace: Trace }) {
  return (
    <details style={{ marginTop: 20, padding: 12, border: '1px solid #8884', borderRadius: 6 }}>
      <summary style={{ cursor: 'pointer' }}>
        Voir le raisonnement ({trace.appelsClaude} appel{trace.appelsClaude > 1 ? 's' : ''} Claude,{' '}
        {trace.recherchesWeb} recherche{trace.recherchesWeb > 1 ? 's' : ''} web)
      </summary>
      {trace.etapes.length === 0 && <p>Aucun outil utilisé : réponse sans données internes ni recherche.</p>}
      <ol style={{ paddingLeft: 20 }}>
        {trace.etapes.map((e, i) => (
          <li key={i} style={{ marginTop: 12 }}>
            {e.type === 'donnees_internes' && (
              <>
                <strong>Données internes</strong> ({e.outil})
                <pre style={{ fontSize: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(e.resultat, null, 2)}
                </pre>
              </>
            )}
            {e.type === 'recherche_web' && (
              <>
                <strong>Recherche web</strong> : « {e.requete} »
                <ul style={{ paddingLeft: 20 }}>
                  {e.resultats.map((r) => (
                    <li key={r.url}>
                      <a href={r.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                        {r.titre}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {e.type === 'erreur_outil' && (
              <>
                <strong style={{ color: 'crimson' }}>Erreur d&apos;outil</strong> ({e.outil}) : {e.message}
              </>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function Avis({ resultat }: { resultat: Resultat }) {
  const [commentaire, setCommentaire] = useState('');
  const [etat, setEtat] = useState<'' | 'envoi' | 'ok' | string>('');

  async function envoyer(verdict: 'bon' | 'mauvais') {
    setEtat('envoi');
    const r = await enregistrerAvis({
      agent: resultat.agent,
      verdict,
      question: resultat.question || '(question inconnue)',
      reponse: resultat.reponse,
      trace: resultat.trace,
      commentaire: commentaire.trim() || undefined,
    }).catch(() => ({ ok: false as const, erreur: 'Envoi impossible.' }));
    setEtat(r.ok ? 'ok' : r.erreur);
  }

  if (etat === 'ok') return <p style={{ marginTop: 16, fontSize: 14 }}>Merci, avis enregistré.</p>;

  return (
    <div style={{ marginTop: 16, fontSize: 14 }}>
      <p style={{ marginBottom: 6 }}>Une fois le résultat connu : ce pick était…</p>
      <input
        type="text"
        placeholder="Commentaire (facultatif)"
        value={commentaire}
        maxLength={1000}
        onChange={(e) => setCommentaire(e.target.value)}
        style={{ padding: 6, width: 300, marginRight: 8 }}
      />
      <button onClick={() => envoyer('bon')} disabled={etat === 'envoi'} style={{ marginRight: 8 }}>
        👍 Bon
      </button>
      <button onClick={() => envoyer('mauvais')} disabled={etat === 'envoi'}>
        👎 Mauvais
      </button>
      {etat && etat !== 'envoi' && <p style={{ color: 'crimson' }}>{etat}</p>}
    </div>
  );
}
