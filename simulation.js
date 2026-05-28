'use strict';

/* ─────────────────────────────────────────────────────────────
   simulation.js — Logique de calcul PEA (fonctions pures)
   Aucune dépendance au DOM ni à Chart.js
───────────────────────────────────────────────────────────── */

const DEFAULTS = {
  mensuel: 200, taux: 7, duree: 20, apport: 0,
  inflation: 2, frais: 0.25, aug: 0,
};

const PRESETS = {
  conservateur: { mensuel: 100, taux: 4,  duree: 20, apport: 0, inflation: 2, frais: 0.25, aug: 0 },
  equilibre:    { mensuel: 200, taux: 7,  duree: 20, apport: 0, inflation: 2, frais: 0.25, aug: 0 },
  ambitieux:    { mensuel: 500, taux: 8,  duree: 25, apport: 0, inflation: 2, frais: 0.25, aug: 0 },
};

/** Plafonds légaux de versements (€) */
const PLAFONDS = { pea: 150000, peapme: 225000, couple: 300000 };

/**
 * Palette de 6 couleurs distinctes pour les phases de vie.
 * Partagée entre ui.js (cartes) et charts.js (zones de fond).
 */
const PHASE_PALETTE = [
  { bar: '#58a6ff', bg: 'rgba(88,166,255,.07)'  },
  { bar: '#3fb950', bg: 'rgba(63,185,80,.07)'   },
  { bar: '#a371f7', bg: 'rgba(163,113,247,.07)' },
  { bar: '#d29922', bg: 'rgba(210,153,34,.07)'  },
  { bar: '#2ea8c4', bg: 'rgba(46,168,196,.07)'  },
  { bar: '#f85149', bg: 'rgba(248,81,73,.07)'   },
];

/**
 * Scénarios pédagogiques prédéfinis.
 * Chaque scénario expose :
 *   nom     {string}   Titre court
 *   desc    {string}   Explication pédagogique (affichée après application)
 *   build   {Function} (duree, mensuel, taux) → Array<Phase>
 */
const SCENARIOS = {
  crash2008: {
    nom: 'Krach boursier',
    desc: 'Crise sévère sur une année (−40 %), rebond vigoureux l\'année suivante (+25 %), puis retour à la normale. Voyez pourquoi continuer à investir pendant un krach amplifie les gains : vous achetez des parts à prix cassé, qui se revalorisent ensuite massivement.',
    build: (duree, mensuel, taux) => [
      { label: 'Avant crise',   anneeDebut: 1, anneeFin: Math.min(4, duree),  mensuel, taux },
      { label: 'Krach −40 %',  anneeDebut: 5, anneeFin: Math.min(5, duree),  mensuel, taux: -40 },
      { label: 'Rebond +25 %', anneeDebut: 6, anneeFin: Math.min(6, duree),  mensuel, taux: 25  },
      { label: 'Reprise',      anneeDebut: 7, anneeFin: duree,               mensuel, taux },
    ].filter(ph => ph.anneeDebut <= duree && ph.anneeDebut <= ph.anneeFin),
  },
  decennie: {
    nom: 'Décennie perdue',
    desc: '10 ans de stagnation (~1 %/an) avant la reprise. Modélise une période comme les années 2000–2010. Montre l\'importance de continuer à verser régulièrement même quand les marchés ne progressent pas — les versements accumulent des parts à bas prix.',
    build: (duree, mensuel, taux) => [
      { label: 'Stagnation (1 %)', anneeDebut: 1,  anneeFin: Math.min(10, duree), mensuel, taux: 1 },
      { label: 'Reprise normale',  anneeDebut: 11, anneeFin: duree,               mensuel, taux },
    ].filter(ph => ph.anneeDebut <= duree && ph.anneeDebut <= ph.anneeFin),
  },
  inflation: {
    nom: 'Crise inflationniste',
    desc: '3 ans de marchés sous pression (taux élevés → actions moins attractives, ~2 %/an). Compare l\'impact d\'un environnement inflationniste prolongé sur votre capital final par rapport à un scénario ordinaire.',
    build: (duree, mensuel, taux) => [
      { label: 'Inflation haute (2 %)', anneeDebut: 1, anneeFin: Math.min(3, duree), mensuel, taux: 2 },
      { label: 'Normalisation',        anneeDebut: 4, anneeFin: duree,               mensuel, taux },
    ].filter(ph => ph.anneeDebut <= duree && ph.anneeDebut <= ph.anneeFin),
  },
  carriere: {
    nom: 'Carrière en U',
    desc: 'Versements élevés en début de carrière (pas d\'enfants, charges légères), réduction au milieu (charges familiales importantes), forte remontée ensuite (carrière avancée, enfants indépendants, revenus au pic). Trajectoire de vie très réaliste.',
    build: (duree, mensuel, taux) => {
      const t1 = Math.max(1, Math.round(duree / 3));
      const t2 = Math.max(t1 + 1, Math.round(duree * 2 / 3));
      return [
        { label: 'Début de carrière', anneeDebut: 1,      anneeFin: t1,    mensuel: Math.round(mensuel * 1.5), taux },
        { label: 'Avec enfants',      anneeDebut: t1 + 1, anneeFin: t2,    mensuel: Math.round(mensuel * 0.6), taux },
        { label: 'Fin de carrière',   anneeDebut: t2 + 1, anneeFin: duree, mensuel: Math.round(mensuel * 1.8), taux },
      ].filter(ph => ph.anneeDebut <= duree && ph.anneeDebut <= ph.anneeFin);
    },
  },
  bull: {
    nom: 'Bull market exceptionnel',
    desc: '5 ans de marchés euphoriques (12 %/an), puis refroidissement (8 %), puis retour à la normale. Montre la puissance des intérêts composés sur un marché haussier prolongé et l\'effet de la normalisation sur la durée totale.',
    build: (duree, mensuel, taux) => [
      { label: 'Bull market (12 %)',    anneeDebut: 1, anneeFin: Math.min(5, duree), mensuel, taux: 12 },
      { label: 'Refroidissement (8 %)', anneeDebut: 6, anneeFin: Math.min(8, duree), mensuel, taux: 8  },
      { label: 'Régime normal',        anneeDebut: 9, anneeFin: duree,              mensuel, taux },
    ].filter(ph => ph.anneeDebut <= duree && ph.anneeDebut <= ph.anneeFin),
  },
};

/* ── Utilitaires de formatage ────────────────────────────── */

function fmt(n) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtAbs(n) {
  return Math.abs(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

/* ── Calcul principal ────────────────────────────────────── */

/**
 * Projette l'évolution d'un PEA année par année, avec gestion du plafond
 * et d'une enveloppe complémentaire optionnelle pour le surplus.
 *
 * @param {Object} p    - Paramètres de simulation
 * @param {Array}  vps  - Versements ponctuels [{id, annee, montant, recurrent}]
 * @param {Object} opts - Options avancées
 * @param {number} opts.plafond       Plafond de versements PEA (défaut : 150 000 €)
 * @param {string} opts.enveloppe     Enveloppe au-delà : 'cto' | 'av' | 'peapme' | null
 * @param {number} opts.tauxAuDela    Rendement enveloppe complémentaire (%)
 * @param {number} opts.fraisAuDela   Frais enveloppe complémentaire (%)
 */
/**
 * Projette l'évolution d'un PEA année par année.
 * Rétrocompatible : sans phases, comportement identique à avant.
 *
 * @param {Object} p      - Paramètres globaux de simulation
 * @param {Array}  vps    - Versements ponctuels [{id, annee, montant, recurrent}]
 * @param {Object} opts   - { plafond, enveloppe, tauxAuDela, fraisAuDela }
 * @param {Array}  phases - Phases de vie [{anneeDebut, anneeFin, mensuel, taux, label}]
 *                          Si vide, p.mensuel / p.taux / p.aug s'appliquent uniformément.
 *                          Si défini, chaque année utilise la phase qui la couvre (ou p si aucune).
 */
function compute(p, vps = [], opts = {}, phases = []) {
  const fraisR   = p.frais     / 100;
  const augR     = p.aug       / 100;
  const inflR    = p.inflation / 100;

  const plafond      = opts.plafond      ?? PLAFONDS.pea;
  const enveloppe    = opts.enveloppe    ?? null;
  const tauxAuDelaM  = ((opts.tauxAuDela  != null ? opts.tauxAuDela  : p.taux)  / 100) / 12;
  const fraisAuDelaR =  (opts.fraisAuDela != null ? opts.fraisAuDela : p.frais)  / 100;

  const apportInPEA = Math.min(p.apport, plafond);
  const apportExc   = Math.max(0, p.apport - plafond);

  // Séries annuelles
  const yrs = [], versL = [], gainL = [], totL = [], reelL = [], fraisL = [];
  const capAuDelaL = [], phaseIdxL = [];

  let cap         = apportInPEA;
  let versé       = apportInPEA;
  let versNets    = apportInPEA;
  let fraisCum    = 0;
  let capAuDela   = apportExc;
  let verseAuDela = apportExc;
  let plafondAn   = (versNets >= plafond && plafond > 0) ? 0 : null;

  // Accumulateurs pour les moyennes pondérées
  let totalMensuelW = 0;
  let totalTauxW    = 0;

  for (let an = 1; an <= p.duree; an++) {
    // ── Sélection des paramètres de cette année ──
    const phIdx = phases.findIndex(ph => an >= ph.anneeDebut && an <= ph.anneeFin);
    const phase = phIdx >= 0 ? phases[phIdx] : null;

    // Si une phase couvre cette année, elle définit mensuel ET taux.
    // Sinon, on utilise les paramètres globaux (avec aug sur mensuel).
    const mensuelAn = phase ? phase.mensuel : p.mensuel * Math.pow(1 + augR, an - 1);
    const tauxAn    = phase ? phase.taux    : p.taux;
    const tauxM     = tauxAn / 100 / 12;

    totalMensuelW += mensuelAn;
    totalTauxW    += tauxAn;

    // ── 12 mois de capitalisation ──
    for (let m = 0; m < 12; m++) {
      let inPEA = 0, auDela = 0;

      if (versNets < plafond) {
        inPEA  = Math.min(mensuelAn, plafond - versNets);
        auDela = mensuelAn - inPEA;
        versé    += inPEA;
        versNets += inPEA;
        if (versNets >= plafond && plafondAn === null) plafondAn = an;
      } else {
        auDela = mensuelAn;
      }

      cap = (cap + inPEA) * (1 + tauxM);
      verseAuDela += auDela;
      if (enveloppe) capAuDela = (capAuDela + auDela) * (1 + tauxAuDelaM);
    }

    // ── Frais ETF PEA (annuels) ──
    const f = cap * fraisR;
    cap -= f; fraisCum += f;

    // ── Versements ponctuels (fin d'année) ──
    for (const v of vps) {
      const actif = v.recurrent ? an >= (v.annee || 1) : an === v.annee;
      if (actif && v.montant > 0) {
        const eff = Math.min(v.montant, Math.max(0, plafond - versNets));
        const exc = v.montant - eff;
        cap += eff; versé += eff; versNets += eff;
        if (eff > 0 && versNets >= plafond && plafondAn === null) plafondAn = an;
        verseAuDela += exc;
        if (enveloppe) capAuDela += exc;
      }
    }

    // ── Frais enveloppe complémentaire (annuels) ──
    if (enveloppe && capAuDela > 0) capAuDela -= capAuDela * fraisAuDelaR;

    yrs.push(an);
    versL.push(versé);
    gainL.push(Math.max(0, cap - versé));
    totL.push(cap);
    reelL.push(cap / Math.pow(1 + inflR, an));
    fraisL.push(fraisCum);
    capAuDelaL.push(enveloppe ? capAuDela : 0);
    phaseIdxL.push(phIdx); // -1 = paramètres globaux
  }

  if (!totL.length) {
    return {
      yrs: [], versL: [], gainL: [], totL: [], reelL: [], fraisL: [],
      capAuDelaL: [], phaseIdxL: [],
      versé: 0, final: 0, gain: 0, reel: 0, fraisTot: 0, mult: 0,
      plafondAn: null, versNets: 0, verseAuDela: 0,
      capAuDelaFinal: 0, gainAuDela: 0,
      mensuelMoyen: p.mensuel, tauxMoyen: p.taux,
    };
  }

  const i = totL.length - 1;
  return {
    yrs, versL, gainL, totL, reelL, fraisL, capAuDelaL, phaseIdxL,
    versé:          versL[i],
    final:          totL[i],
    gain:           gainL[i],
    reel:           reelL[i],
    fraisTot:       fraisL[i],
    mult:           versL[i] > 0 ? totL[i] / versL[i] : 0,
    plafondAn,
    versNets,
    verseAuDela,
    capAuDelaFinal: capAuDelaL[i],
    gainAuDela:     Math.max(0, capAuDelaL[i] - verseAuDela),
    // Moyennes pondérées sur la durée simulée
    mensuelMoyen:   p.duree > 0 ? totalMensuelW / p.duree : p.mensuel,
    tauxMoyen:      p.duree > 0 ? totalTauxW    / p.duree : p.taux,
  };
}

/* ── Comparaison fiscale ─────────────────────────────────── */

/**
 * Calcule la fiscalité comparée selon différentes enveloppes.
 * @param {Object} d    - Résultat de compute()
 * @param {Object} opts - { couple }
 */
function computeFiscal(d, opts = {}) {
  const couple     = opts.couple ?? false;
  const abattement = couple ? 9200 : 4600; // abattement AV annuel (€)

  // ── PEA ──
  const impotPEA = d.gain * 0.172;
  const netPEA   = d.final - impotPEA;

  // ── Enveloppe complémentaire ──
  const capAuDela   = d.capAuDelaFinal || 0;
  const gainAuDela  = d.gainAuDela     || 0;
  const verseAuDela = d.verseAuDela    || 0;

  // CTO : flat tax 30 % sur la plus-value
  const impotCTO   = gainAuDela * 0.30;
  const netCTO_ade = capAuDela  - impotCTO;

  // Assurance-vie > 8 ans : abattement unique sur retrait puis 7.5 % IR + 17.2 % PS = 24.7 %
  const gainAVTaxable = Math.max(0, gainAuDela - abattement);
  const impotAV       = gainAVTaxable * 0.247;
  const netAV_ade     = capAuDela - impotAV;

  // PEA-PME : même fiscalité que le PEA (PS 17.2 % sur la plus-value)
  const impotPEAPME   = gainAuDela * 0.172;
  const netPEAPME_ade = capAuDela  - impotPEAPME;

  // ── Baseline : tout en CTO ──
  const gainTotal    = d.gain + gainAuDela;
  const finalTotal   = d.final + capAuDela;
  const impotCTO_all = gainTotal * 0.30;
  const netCTO_all   = finalTotal - impotCTO_all;

  // Économie PEA vs CTO (part PEA uniquement, hors complément)
  const economiePEAvsCTO = netPEA - (d.final - d.gain * 0.30);

  return {
    impotPEA, netPEA,
    capAuDela, gainAuDela, verseAuDela,
    impotCTO, netCTO_ade,
    gainAVTaxable, impotAV, netAV_ade, abattement,
    impotPEAPME, netPEAPME_ade,
    gainTotal, finalTotal, impotCTO_all, netCTO_all,
    economiePEAvsCTO,
  };
}

/** Scénario de référence (défauts, sans versements ponctuels) — sert à calculer les deltas */
const DEF = compute(DEFAULTS, []);
