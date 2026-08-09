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

/**
 * Taux mensuel équivalent à un taux annuel (conversion géométrique).
 * (1 + taux/100)^(1/12) − 1 : capitaliser 12 mois redonne exactement le taux annuel.
 */
function tauxMensuel(tauxAnnuel) {
  return Math.pow(1 + tauxAnnuel / 100, 1 / 12) - 1;
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
 * @param {Object} overrides - Personnalisation fine par année/mois :
 *                          { [annee]: { mensuel?, taux?, mois?: { [1..12]: { versement?, taux? } } } }
 *                          Priorité : mois > année > phase > paramètres globaux.
 */
function compute(p, vps = [], opts = {}, phases = [], overrides = {}) {
  const fraisR   = p.frais     / 100;
  const augR     = p.aug       / 100;
  const inflR    = p.inflation / 100;

  const plafond      = opts.plafond      ?? PLAFONDS.pea;
  const enveloppe    = opts.enveloppe    ?? null;
  const tauxAuDelaM  = tauxMensuel(opts.tauxAuDela != null ? opts.tauxAuDela : p.taux);
  const fraisAuDelaR =  (opts.fraisAuDela != null ? opts.fraisAuDela : p.frais)  / 100;

  const apportInPEA = Math.min(p.apport, plafond);
  const apportExc   = Math.max(0, p.apport - plafond);

  // Séries annuelles
  const yrs = [], versL = [], gainL = [], totL = [], reelL = [], fraisL = [];
  const capAuDelaL = [], phaseIdxL = [], mensAnL = [], tauxAnL = [];

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
    const ov    = overrides[an] || null;

    // Priorité : override année > phase > paramètres globaux (avec aug sur mensuel).
    const mensuelBase = phase ? phase.mensuel : p.mensuel * Math.pow(1 + augR, an - 1);
    const mensuelAn   = ov && ov.mensuel != null ? ov.mensuel : mensuelBase;
    const tauxAn      = ov && ov.taux    != null ? ov.taux    : (phase ? phase.taux : p.taux);

    // Moyennes effectives de l'année (tiennent compte des mois personnalisés)
    let sumVers = 0, sumTaux = 0;

    // ── 12 mois de capitalisation ──
    for (let m = 1; m <= 12; m++) {
      const ovM      = ov && ov.mois ? ov.mois[m] : null;
      const versMois = ovM && ovM.versement != null ? ovM.versement : mensuelAn;
      const tauxMois = ovM && ovM.taux      != null ? ovM.taux      : tauxAn;
      const tauxM    = tauxMensuel(tauxMois);
      sumVers += versMois;
      sumTaux += tauxMois;

      let inPEA = 0, auDela = 0;

      if (versNets < plafond) {
        inPEA  = Math.min(versMois, plafond - versNets);
        auDela = versMois - inPEA;
        versé    += inPEA;
        versNets += inPEA;
        if (versNets >= plafond && plafondAn === null) plafondAn = an;
      } else {
        auDela = versMois;
      }

      cap = (cap + inPEA) * (1 + tauxM);
      verseAuDela += auDela;
      if (enveloppe) capAuDela = (capAuDela + auDela) * (1 + tauxAuDelaM);
    }

    const mensEffAn = sumVers / 12;
    const tauxEffAn = sumTaux / 12;
    totalMensuelW += mensEffAn;
    totalTauxW    += tauxEffAn;

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
    mensAnL.push(mensEffAn);
    tauxAnL.push(tauxEffAn);
  }

  if (!totL.length) {
    return {
      yrs: [], versL: [], gainL: [], totL: [], reelL: [], fraisL: [],
      capAuDelaL: [], phaseIdxL: [], mensAnL: [], tauxAnL: [],
      versé: 0, final: 0, gain: 0, reel: 0, fraisTot: 0, mult: 0,
      plafondAn: null, versNets: 0, verseAuDela: 0,
      capAuDelaFinal: 0, gainAuDela: 0,
      mensuelMoyen: p.mensuel, tauxMoyen: p.taux,
    };
  }

  const i = totL.length - 1;
  return {
    yrs, versL, gainL, totL, reelL, fraisL, capAuDelaL, phaseIdxL, mensAnL, tauxAnL,
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

/* ── Phase de rente (décumulation) ───────────────────────── */

/** Prélèvements sociaux sur la plus-value des retraits PEA (> 5 ans) */
const PS_PEA = 0.172;

/**
 * Simule la phase de rente : on retire chaque mois le brut nécessaire pour
 * obtenir la rente nette demandée, le reste du capital continue de fructifier.
 * Fiscalité PEA > 5 ans : chaque retrait est composé pro-rata de versements
 * (non taxés) et de plus-value (PS 17.2 %), comme le calcule la banque.
 *
 * @param {Object}  p
 * @param {number}  p.capital     Capital PEA au départ de la rente (€)
 * @param {number}  p.versements  Versements nets cumulés — base non taxée (€)
 * @param {number}  p.renteNette  Rente mensuelle nette souhaitée (€)
 * @param {number}  p.taux        Rendement annuel brut pendant la rente (%)
 * @param {number}  p.frais       Frais annuels ETF (%)
 * @param {number}  p.inflation   Inflation annuelle (%) — pour indexer la rente
 * @param {boolean} p.indexer     Revaloriser la rente de l'inflation chaque année
 * @param {number}  p.dureeMax    Horizon simulé en années (défaut 50)
 * @returns {Object} { capL, retraitL, psL, moisEpuisement, capFinal,
 *                     retraitNetTotal, psTotal, renteFinale }
 *                   moisEpuisement = null si le capital survit à l'horizon.
 */
function computeRente(p) {
  const dureeMax = p.dureeMax || 50;
  const tauxM    = tauxMensuel(p.taux);
  const fraisR   = (p.frais || 0) / 100;
  const inflR    = (p.inflation || 0) / 100;

  let cap   = p.capital;
  let vers  = Math.min(Math.max(0, p.versements), p.capital);
  let rente = Math.max(0, p.renteNette);

  const capL = [], retraitL = [], psL = [];
  let retraitNetCum = 0, psCum = 0, moisEpuisement = null;

  outer:
  for (let an = 1; an <= dureeMax; an++) {
    let retraitAn = 0;
    for (let m = 1; m <= 12; m++) {
      // Part de plus-value du capital → brut à retirer pour la rente nette
      const gainShare = cap > 0 ? Math.max(0, 1 - vers / cap) : 0;
      const brut      = rente / (1 - PS_PEA * gainShare);

      if (brut >= cap) {
        // Dernier retrait partiel : on vide le PEA
        const net = cap * (1 - PS_PEA * gainShare);
        retraitNetCum += net; retraitAn += net; psCum += cap - net;
        cap = 0; vers = 0;
        moisEpuisement = (an - 1) * 12 + m;
        capL.push(0); retraitL.push(retraitAn); psL.push(psCum);
        break outer;
      }

      vers = Math.max(0, vers - brut * (vers / cap));
      cap -= brut;
      retraitNetCum += rente; retraitAn += rente; psCum += brut - rente;
      cap *= 1 + tauxM;
    }
    cap -= cap * fraisR;
    capL.push(cap); retraitL.push(retraitAn); psL.push(psCum);
    if (p.indexer) rente *= 1 + inflR;
  }

  return {
    capL, retraitL, psL,
    moisEpuisement,
    capFinal:        cap,
    retraitNetTotal: retraitNetCum,
    psTotal:         psCum,
    renteFinale:     rente,
  };
}

/**
 * Rente nette mensuelle maximale (au mois 1) telle que le capital n'est pas
 * épuisé au bout de `annees` années — trouvée par dichotomie sur computeRente.
 */
function renteMaxPourDuree(p, annees) {
  let lo = 0, hi = Math.max(100, p.capital);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = computeRente({ ...p, renteNette: mid, dureeMax: annees });
    if (r.moisEpuisement === null) lo = mid; else hi = mid;
  }
  return lo;
}

/* ── Simulation Monte Carlo ──────────────────────────────────
   Au lieu d'un rendement fixe, on tire des trajectoires aléatoires :
   rendement log-normal mensuel calibré pour que l'ESPÉRANCE de croissance
   égale le taux déterministe (la médiane, elle, est plus basse — c'est
   le coût de la volatilité). Frais TER déduits annuellement comme dans
   compute(). Les phases/overrides/versements ponctuels sont ignorés :
   la simulation porte sur le plan « régulier » (apport + mensuel + aug). */

function _gaussienne() {
  /* Box-Muller (méthode polaire), sans état module : appelée par paires. */
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (!s || s >= 1);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/**
 * @param {Object} p    - Paramètres globaux (mensuel, taux, duree, apport, frais, aug)
 * @param {Object} opts - { vol = 15 (%/an), runs = 1000, objectif = null (€) }
 * @returns {Object} { yrs, p10, p50, p90, verséL,
 *                     medianeFinale, p10Final, p90Final, verséTotal,
 *                     probPerte, probObjectif, runs, vol }
 */
function computeMonteCarlo(p, opts = {}) {
  const runs   = Math.max(100, Math.min(5000, opts.runs || 1000));
  const vol    = (opts.vol != null ? opts.vol : 15) / 100;
  const muM    = Math.log(1 + p.taux / 100) / 12;
  const sigM   = vol / Math.sqrt(12);
  const driftM = muM - sigM * sigM / 2;   // log-normale : E[exp(·)] = (1+taux)^(1/12)
  const fraisR = p.frais / 100;
  const augR   = p.aug / 100;

  const parAnnee = Array.from({ length: p.duree }, () => new Float64Array(runs));
  const verséL   = [];

  for (let r = 0; r < runs; r++) {
    let cap = p.apport;
    for (let an = 1; an <= p.duree; an++) {
      const mensuel = p.mensuel * Math.pow(1 + augR, an - 1);
      for (let m = 0; m < 12; m++) {
        cap = (cap + mensuel) * Math.exp(driftM + sigM * _gaussienne());
      }
      cap -= cap * fraisR;
      parAnnee[an - 1][r] = cap;
    }
  }

  /* Versements cumulés (identiques pour toutes les trajectoires) */
  let versé = p.apport;
  for (let an = 1; an <= p.duree; an++) {
    versé += 12 * p.mensuel * Math.pow(1 + augR, an - 1);
    verséL.push(versé);
  }

  const pct = (sorted, q) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

  const yrs = [], p10 = [], p50 = [], p90 = [];
  for (let i = 0; i < p.duree; i++) {
    const s = parAnnee[i].slice().sort();
    yrs.push(i + 1);
    p10.push(pct(s, 0.10));
    p50.push(pct(s, 0.50));
    p90.push(pct(s, 0.90));
  }

  const finals = parAnnee[p.duree - 1];
  let nbPerte = 0, nbObjectif = 0;
  for (let r = 0; r < runs; r++) {
    if (finals[r] < versé) nbPerte++;
    if (opts.objectif > 0 && finals[r] >= opts.objectif) nbObjectif++;
  }

  return {
    yrs, p10, p50, p90, verséL,
    medianeFinale: p50[p50.length - 1],
    p10Final:      p10[p10.length - 1],
    p90Final:      p90[p90.length - 1],
    verséTotal:    versé,
    probPerte:     nbPerte / runs,
    probObjectif:  opts.objectif > 0 ? nbObjectif / runs : null,
    runs, vol: vol * 100,
  };
}

/* ── Backtest sur séquences historiques ──────────────────────
   Rendements annuels APPROXIMATIFS du MSCI World (USD, dividendes bruts
   réinvestis), arrondis — à titre pédagogique : l'ordre de grandeur et
   la chronologie des crises comptent plus que la décimale. */

const HISTO_MSCI_WORLD = [
  { annee: 1970, taux: -2 },  { annee: 1971, taux: 18 },  { annee: 1972, taux: 22 },
  { annee: 1973, taux: -15 }, { annee: 1974, taux: -25 }, { annee: 1975, taux: 32 },
  { annee: 1976, taux: 13 },  { annee: 1977, taux: 0 },   { annee: 1978, taux: 16 },
  { annee: 1979, taux: 11 },  { annee: 1980, taux: 25 },  { annee: 1981, taux: -5 },
  { annee: 1982, taux: 9 },   { annee: 1983, taux: 22 },  { annee: 1984, taux: 4 },
  { annee: 1985, taux: 40 },  { annee: 1986, taux: 41 },  { annee: 1987, taux: 16 },
  { annee: 1988, taux: 23 },  { annee: 1989, taux: 16 },  { annee: 1990, taux: -17 },
  { annee: 1991, taux: 18 },  { annee: 1992, taux: -5 },  { annee: 1993, taux: 22 },
  { annee: 1994, taux: 5 },   { annee: 1995, taux: 20 },  { annee: 1996, taux: 13 },
  { annee: 1997, taux: 15 },  { annee: 1998, taux: 24 },  { annee: 1999, taux: 25 },
  { annee: 2000, taux: -13 }, { annee: 2001, taux: -17 }, { annee: 2002, taux: -20 },
  { annee: 2003, taux: 33 },  { annee: 2004, taux: 15 },  { annee: 2005, taux: 9 },
  { annee: 2006, taux: 20 },  { annee: 2007, taux: 9 },   { annee: 2008, taux: -40 },
  { annee: 2009, taux: 30 },  { annee: 2010, taux: 12 },  { annee: 2011, taux: -5 },
  { annee: 2012, taux: 15 },  { annee: 2013, taux: 27 },  { annee: 2014, taux: 5 },
  { annee: 2015, taux: -1 },  { annee: 2016, taux: 8 },   { annee: 2017, taux: 22 },
  { annee: 2018, taux: -9 },  { annee: 2019, taux: 28 },  { annee: 2020, taux: 16 },
  { annee: 2021, taux: 22 },  { annee: 2022, taux: -18 }, { annee: 2023, taux: 24 },
  { annee: 2024, taux: 18 },
];

/**
 * Applique la séquence réelle des rendements à partir d'une année de départ
 * au plan d'épargne courant (apport + mensuel + aug + frais).
 * @returns {Object|null} { yrs, totL, tauxL, verséL, duree, final, versé,
 *                          anneeDebut, anneeFin, tronque, cagr, pireAnnee }
 */
function computeBacktest(p, anneeDepart) {
  const dispo = HISTO_MSCI_WORLD.filter(h => h.annee >= anneeDepart);
  const duree = Math.min(p.duree, dispo.length);
  if (!duree) return null;

  const fraisR = p.frais / 100;
  const augR   = p.aug / 100;

  let cap = p.apport, versé = p.apport;
  const yrs = [], totL = [], tauxL = [], verséL = [];

  for (let an = 1; an <= duree; an++) {
    const taux = dispo[an - 1].taux;
    const tM   = tauxMensuel(taux);
    const mensuel = p.mensuel * Math.pow(1 + augR, an - 1);
    for (let m = 0; m < 12; m++) {
      cap = (cap + mensuel) * (1 + tM);
      versé += mensuel;
    }
    cap -= cap * fraisR;
    yrs.push(an); totL.push(cap); tauxL.push(taux); verséL.push(versé);
  }

  const pire = dispo.slice(0, duree)
    .reduce((a, b) => (b.taux < a.taux ? b : a));

  return {
    yrs, totL, tauxL, verséL, duree,
    final:      cap,
    versé,
    anneeDebut: anneeDepart,
    anneeFin:   dispo[duree - 1].annee,
    tronque:    duree < p.duree,
    cagr:       versé > 0 && duree > 0 ? (Math.pow(cap / versé, 1 / duree) - 1) * 100 : null,
    pireAnnee:  pire,
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
