import type { Metadata } from 'next';
import Link from 'next/link';

// Page PUBLIQUE (voir PAGES_PUBLIQUES dans src/proxy.ts). Si le code de
// l'agent colis change ce qu'il lit ou conserve, mettre cette page à jour.

export const metadata: Metadata = {
  title: 'Confidentialité — Agent colis',
  description: 'Politique de confidentialité de l’application personnelle Agent colis.',
};

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{titre}</h2>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}

export default function Confidentialite() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 text-zinc-800">
      <p className="text-sm">
        <Link href="/" className="text-sky-700 underline">
          ← Agent colis
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Politique de confidentialité</h1>
      <p className="mt-2 text-sm text-zinc-500">Dernière mise à jour : 27 octobre 2026</p>

      <Section titre="Usage strictement personnel">
        <p>
          Agent colis est une application personnelle. Son seul utilisateur est le titulaire du
          compte <span className="whitespace-nowrap">lolo.rms@gmail.com</span>, qui l&apos;utilise
          pour suivre ses propres colis. Elle n&apos;est ouverte à personne d&apos;autre.
        </p>
      </Section>

      <Section titre="Données Google utilisées">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Gmail, en lecture seule</strong> (<code>gmail.readonly</code>) : l&apos;application
            lit les mails récents qui ressemblent à des mails de livraison, uniquement pour détecter
            les colis et leur état. Elle ne peut ni envoyer, ni modifier, ni supprimer de mail.
          </li>
          <li>
            <strong>Google Agenda, limité à son propre agenda</strong> (
            <code>calendar.app.created</code>) : elle crée et met à jour un agenda dédié, « 📦
            Colis ». Elle n&apos;a pas accès aux autres agendas.
          </li>
        </ul>
      </Section>

      <Section titre="Ce qui est conservé">
        <p>
          <strong>Le contenu des mails n&apos;est jamais enregistré.</strong> L&apos;application
          conserve uniquement :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            les informations de chaque colis : marchand, transporteur, numéros de suivi et de
            commande, courte description, statut, dates et créneau de livraison, lieu de livraison
            ou point relais, lien de suivi ;
          </li>
          <li>pour chaque mail de livraison : son sujet et un résumé d&apos;une phrase ;</li>
          <li>
            l&apos;identifiant technique Gmail des mails déjà analysés, pour ne pas les relire (sans
            sujet ni contenu pour les mails qui ne concernent pas un colis).
          </li>
        </ul>
      </Section>

      <Section titre="Partage">
        <p>
          Aucune donnée n&apos;est vendue, cédée, partagée avec des tiers ni utilisée à des fins
          publicitaires. Seuls les prestataires techniques nécessaires au fonctionnement la traitent,
          pour le compte de l&apos;utilisateur :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Anthropic</strong> (API Claude) : le texte d&apos;un mail de livraison lui est
            transmis pour en extraire les informations du colis ; l&apos;application ne conserve que
            le résultat ;
          </li>
          <li>
            <strong>Supabase</strong> : base de données où sont stockées les informations de colis
            ci-dessus ;
          </li>
          <li>
            <strong>Vercel</strong> : hébergement de l&apos;application.
          </li>
        </ul>
        <p>
          L&apos;utilisation et le transfert des informations reçues des API Google respectent les{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-sky-700 underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            règles d&apos;utilisation des données des API Google
          </a>
          , y compris les exigences d&apos;utilisation limitée (« Limited Use »).
        </p>
      </Section>

      <Section titre="Révocation et suppression">
        <p>
          L&apos;accès peut être retiré à tout moment depuis{' '}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-sky-700 underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            myaccount.google.com/permissions
          </a>
          . Les données de colis peuvent être supprimées sur simple demande.
        </p>
      </Section>

      <Section titre="Contact">
        <p>lolo.rms@gmail.com</p>
      </Section>
    </main>
  );
}
