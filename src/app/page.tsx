import type { Metadata } from 'next';
import Link from 'next/link';

// Page PUBLIQUE (voir PAGES_PUBLIQUES dans src/proxy.ts) : présentation de
// l'application, exigée par l'écran de consentement OAuth de Google.
// Statique : aucune donnée lue ici.

export const metadata: Metadata = {
  title: 'Agent colis',
  description: 'Application personnelle de suivi des colis à partir des mails de livraison.',
};

export default function Accueil() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 text-zinc-800">
      <h1 className="text-2xl font-semibold">📦 Agent colis</h1>
      <p className="mt-4 leading-relaxed">
        Application <strong>à usage strictement personnel</strong> qui suit les colis de{' '}
        <span className="whitespace-nowrap">lolo.rms@gmail.com</span>.
      </p>
      <p className="mt-3 leading-relaxed">
        Elle lit, en lecture seule, les mails de livraison récents (confirmations de commande,
        avis d&apos;expédition, avis de passage…), en extrait l&apos;état de chaque colis et tient
        à jour un agenda Google dédié, « 📦 Colis », avec les dates de livraison prévues.
      </p>
      <p className="mt-3 leading-relaxed">
        Elle n&apos;est pas ouverte au public : aucune inscription n&apos;est possible.
      </p>

      <nav className="mt-8 flex gap-6 text-sm">
        <Link href="/confidentialite" className="text-sky-700 underline">
          Politique de confidentialité
        </Link>
        <Link href="/login" className="text-zinc-500 underline">
          Accès privé
        </Link>
      </nav>
    </main>
  );
}
