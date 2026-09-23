'use client';
import { useState } from 'react';

export default function Home() {
  const [reponse, setReponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [tournoi, setTournoi] = useState('');

  async function demander(agent: string, body: object) {
    setLoading(true);
    setReponse('');
    const res = await fetch(`/api/${agent}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setReponse(data.reponse ?? data.error ?? `Erreur ${res.status}`);
    setLoading(false);
  }

  return (
    <main style={{ padding: 40, maxWidth: 700 }}>
      <div style={{ marginBottom: 30 }}>
        <button onClick={() => demander('ttfl', { question: 'Quel est mon meilleur pick TTFL ce soir ?' })} disabled={loading}>
          Pick TTFL du soir
        </button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Nom du tournoi (ex: Guadalajara, Singapore...)"
          value={tournoi}
          onChange={(e) => setTournoi(e.target.value)}
          style={{ padding: 8, width: 300, marginRight: 8 }}
        />
        <button onClick={() => demander('tennis', { tournoi, stock: 'daddy' })} disabled={loading || !tournoi}>
          Pick Tennis
        </button>
      </div>

      <p style={{ whiteSpace: 'pre-wrap', marginTop: 20 }}>{loading ? 'Réflexion en cours...' : reponse}</p>
    </main>
  );
}