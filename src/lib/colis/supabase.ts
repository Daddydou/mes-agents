import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Client Supabase de l'agent colis, avec la clé SERVICE ROLE.
 *
 * Pourquoi pas la clé anon comme les autres agents ? Les tables colis*
 * contiennent des données perso (adresses, numéros de suivi) : elles sont
 * fermées à anon (RLS sans policy, migration 0003). La clé anon étant
 * partagée avec les autres apps du projet, ouvrir ces tables à anon les
 * rendrait lisibles par n'importe quelle app.
 *
 * ⚠ La clé service role contourne toute la RLS du projet : elle ne doit
 * JAMAIS arriver dans le navigateur. `server-only` fait échouer le build si
 * ce module est importé depuis un composant client. Par convention, ce
 * client ne touche qu'aux tables colis*.
 */
export function supabaseColis() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant.');
  }
  return createClient(url, cle, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SupabaseColis = ReturnType<typeof supabaseColis>;

export const STATUTS = [
  'commande',
  'expediee',
  'en_transit',
  'en_livraison',
  'disponible_point_relais',
  'livree',
  'retard',
  'probleme',
  'annulee',
] as const;
export type Statut = (typeof STATUTS)[number];

/** Une ligne de la table `colis`. */
export type Colis = {
  id: string;
  marchand: string | null;
  transporteur: string | null;
  numero_suivi: string | null;
  numero_commande: string | null;
  description: string | null;
  statut: Statut;
  date_livraison_prevue: string | null;
  fenetre_debut: string | null;
  fenetre_fin: string | null;
  lieu_livraison: string | null;
  url_suivi: string | null;
  /** Code de retrait tel qu'écrit dans le mail ; effacé à la livraison ou à l'annulation. */
  code_retrait: string | null;
  /** Un mail du colis contient un QR code à présenter (l'image n'est pas conservée). */
  qr_code: boolean;
  calendar_event_id: string | null;
  derniere_maj: string;
  created_at: string;
};

export type LigneHistorique = {
  email_id: string | null;
  thread_id: string | null;
  statut: string | null;
  resume: string | null;
  created_at: string;
};

export const LIBELLES_STATUT: Record<Statut, string> = {
  commande: 'Commandé',
  expediee: 'Expédié',
  en_transit: 'En transit',
  en_livraison: 'En cours de livraison',
  disponible_point_relais: 'Disponible en point relais',
  livree: 'Livré',
  retard: 'En retard',
  probleme: 'Problème',
  annulee: 'Annulé',
};
