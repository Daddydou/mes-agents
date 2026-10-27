/**
 * Réglages de l'agent colis, regroupés ici pour être faciles à ajuster.
 */

/** Modèle d'extraction. Haiku : rapide et économique, suffisant pour remplir un schéma. */
export const MODELE_EXTRACTION = 'claude-haiku-5-5';

export const FUSEAU = 'Europe/Paris';

/**
 * Présélection Gmail. Volontairement un peu large : Claude écarte ensuite
 * les pubs et newsletters (champ `est_colis`). Syntaxe : celle de la barre
 * de recherche Gmail.
 */
const MOTS_SUJET = [
  'colis', 'livraison', 'livré', 'livrée', 'expédié', 'expédiée', 'expédition',
  'commande', 'suivi', 'tracking', '"point relais"', 'delivery', 'delivered',
  'shipped', 'shipment', 'order',
];
const EXPEDITEURS = [
  'amazon', 'colissimo', 'chronopost', 'ups', 'dhl', 'fedex', 'mondialrelay',
  '"mondial relay"', 'dpd', 'gls', '"relais colis"', 'relaiscolis', 'laposte',
  'vinted', 'cdiscount', 'fnac', 'aliexpress', 'temu', 'shein', 'leboncoin',
  'darty', 'boulanger', 'decathlon', 'ikea', 'zalando', 'vintedgo', 'cainiao',
];
export const REQUETE_GMAIL =
  `newer_than:14d (subject:(${MOTS_SUJET.join(' OR ')}) OR from:(${EXPEDITEURS.join(' OR ')}))`;

/** Mails analysés au maximum par passage (le reste sera pris au suivant). */
export const MAX_MAILS_PAR_PASSAGE = 15;

/** Corps du mail envoyé à Claude, en caractères (texte brut). */
export const TAILLE_MAX_CORPS = 6000;

/** Analyses Claude menées en parallèle (la route a 60 s au total). */
export const ANALYSES_EN_PARALLELE = 5;

/** Au-delà, on n'entame plus de nouveau mail : la route doit répondre avant 60 s. */
export const BUDGET_TEMPS_MS = 45_000;

export const NOM_AGENDA = '📦 Colis';

/** Compte Gmail lu par l'agent : sert à ouvrir les liens vers les mails dans le bon compte. */
export const COMPTE_GMAIL = 'lolo.rms@gmail.com';
