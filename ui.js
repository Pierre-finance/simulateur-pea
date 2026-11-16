'use strict';

/* ─────────────────────────────────────────────────────────────
   ui.js — Gestion de l'interface : sliders, événements, rendu
   Dépendances : simulation.js, charts.js

   ../common.js est facultatif : dans l'écosystème local il fournit les
   notifications et la boîte de confirmation (peaToast, peaConfirm) ;
   publié seul sur GitHub Pages, le simulateur retombe sur celles du
   navigateur — voir notifier() et confirmer().
───────────────────────────────────────────────────────────── */

/* ── État de l'application ───────────────────────────────── */
let vpId = 0;
let vps  = [];

// Phases de vie : [{id, label, anneeDebut, anneeFin, mensuel, taux}]
let phases        = [];
let phaseId       = 0;
let editingPhaseId = null;   // ID de la phase en cours d'édition (mode inline)
let showYearView  = false;   // bascule tableau année par année

// Personnalisation fine : { [annee]: { mensuel?, taux?, mois?: { [1..12]: { versement?, taux? } } } }
let overrides     = {};
let expandedYears = new Set(); // années dont la grille mensuelle est dépliée

/* ── Clés localStorage ───────────────────────────────────── */
const LS_PARAMS    = 'pea_params';
const LS_VPS       = 'pea_vps';
const LS_FISC      = 'pea_fisc';
const LS_COUPLE    = 'pea_couple';
const LS_AUDE      = 'pea_aude';
const LS_PHASES    = 'pea_phases';
const LS_OVERRIDES = 'pea_overrides';
const LS_SCENARIOS = 'pea_scenarios';
const LS_RENTE     = 'pea_rente';
const LS_MC        = 'pea_mc';
const LS_BT        = 'pea_bt';
const LS_SECTIONS  = 'pea_sections';
const MAX_SCENARIOS = 20;

/* ── Tableau enrichi ─────────────────────────────────────── */
let _tableSort     = { col: null, dir: 'asc' };
let _tableFilter   = '';
let _lastTableData = null;

/* ── Scénarios sauvegardés ───────────────────────────────── */
let _compareId = null;   // id du scénario dont la courbe est superposée au graphique

/* « Partir de mon PEA réel » : valeurs appliquées, pour savoir si elles le sont encore */
let _peaReel = null;     // { apport, mensuel } | null

/** « 1 an », « 20 ans » */
const ans = n => `${n} an${n > 1 ? 's' : ''}`;

/* ── Animation des KPI ───────────────────────────────────── */
const _kpiPrev = {};
const _kpiRaf  = {};

function animateKpi(id, toVal, fmtFn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (_kpiRaf[id]) cancelAnimationFrame(_kpiRaf[id]);
  const fromVal = _kpiPrev[id] !== undefined ? _kpiPrev[id] : toVal;
  _kpiPrev[id]  = toVal;
  if (SANS_ANIMATION || Math.abs(toVal - fromVal) < 0.5) { el.textContent = fmtFn(toVal); return; }
  const DUR = 300;
  let t0 = null; // origine prise sur le 1er timestamp rAF (même base de temps que les suivants)
  const tick = now => {
    if (t0 === null) t0 = now;
    const progress = Math.min(Math.max((now - t0) / DUR, 0), 1);
    const ease     = 1 - Math.pow(1 - progress, 3);
    el.textContent = fmtFn(fromVal + (toVal - fromVal) * ease);
    if (progress < 1) { _kpiRaf[id] = requestAnimationFrame(tick); }
    else { el.textContent = fmtFn(toVal); delete _kpiRaf[id]; }
  };
  _kpiRaf[id] = requestAnimationFrame(tick);
}

/* ── Debounce ────────────────────────────────────────────── */
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

/* ── Notifications et confirmations ──────────────────────────
   Dans l'écosystème, celles du socle commun (même allure que sur les
   autres pages). Publié seul, common.js n'existe pas : on retombe sur les
   boîtes du navigateur. Une erreur doit rester visible ; une réussite peut
   se passer de message, l'écran a déjà changé. */
function notifier(message, type = 'ok') {
  if (typeof peaToast === 'function') peaToast(message, { type });
  else if (type === 'erreur') alert(message);
}

function confirmer({ titre, message = '', ok = 'Confirmer', danger = false }) {
  if (typeof peaConfirm === 'function') return peaConfirm({ titre, message, ok, danger });
  return Promise.resolve(confirm(message ? `${titre}\n\n${message}` : titre));
}

/* ── Fenêtres modales ────────────────────────────────────────
   Une seule à la fois. Échap ou un clic sur le fond la ferme, la
   tabulation reste dans la boîte, la page est figée derrière et le focus
   revient au bouton qui l'a ouverte. Tout élément portant data-fermer
   (« Annuler », « Fermer ») la ferme aussi. */
function ouvrirModale(contenu, { large = false, focus = null, surFermeture = null } = {}) {
  const ouvreur = document.activeElement;
  const fond    = document.createElement('div');
  fond.className = 'modal-overlay';
  fond.innerHTML =
    `<div class="modal-box${large ? ' modal-box-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modale-titre">${contenu}</div>`;

  const focalisables = () => [...fond.querySelectorAll('button, input, select, textarea, a[href]')]
    .filter(el => !el.disabled && el.getClientRects().length);

  function clavier(e) {
    if (e.key === 'Escape') { e.preventDefault(); fermer(); return; }
    if (e.key !== 'Tab') return;
    const champs = focalisables();
    if (!champs.length) { e.preventDefault(); return; }
    const premier = champs[0], dernier = champs[champs.length - 1];
    const dedans  = fond.contains(document.activeElement);
    if (e.shiftKey && (!dedans || document.activeElement === premier)) { e.preventDefault(); dernier.focus(); }
    else if (!e.shiftKey && (!dedans || document.activeElement === dernier)) { e.preventDefault(); premier.focus(); }
  }

  function fermer() {
    if (!fond.isConnected) return;
    document.removeEventListener('keydown', clavier);
    document.documentElement.classList.remove('modale-ouverte');
    fond.remove();
    if (ouvreur && document.contains(ouvreur)) ouvreur.focus();
    if (surFermeture) surFermeture();
  }

  /* Le fond lui-même : pas une sélection de texte commencée dans la boîte
     et relâchée dehors. */
  let appuiSurFond = false;
  fond.addEventListener('pointerdown', e => { appuiSurFond = e.target === fond; });
  fond.addEventListener('click', e => {
    if ((e.target === fond && appuiSurFond) || e.target.closest('[data-fermer]')) fermer();
  });
  document.addEventListener('keydown', clavier);
  document.documentElement.classList.add('modale-ouverte');
  document.body.appendChild(fond);
  const cible = (focus && fond.querySelector(focus)) || focalisables()[0];
  if (cible) cible.focus();
  return { fond, fermer };
}

/* ── Slider ──────────────────────────────────────────────── */
function fillSlider(sl) {
  const pct = ((+sl.value - +sl.min) / (+sl.max - +sl.min)) * 100;
  sl.style.background = `linear-gradient(to right, var(--brand) ${pct}%, var(--surface-3) ${pct}%)`;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ── Lecture des paramètres ──────────────────────────────── */

/* Le champ numérique fait foi (on peut y taper 215 € alors que le curseur
   avance de 10 en 10), ramené dans les bornes du curseur — y compris
   pendant qu'on tape un nombre encore incomplet. La durée est entière. */
function lireParam(nom) {
  const sl = document.getElementById('s-' + nom);
  const v  = clamp(+document.getElementById('n-' + nom).value || 0, +sl.min, +sl.max);
  return nom === 'duree' ? Math.round(v) : v;
}

function getParams() {
  return {
    mensuel:   lireParam('mensuel'),
    taux:      lireParam('taux'),
    duree:     lireParam('duree'),
    apport:    lireParam('apport'),
    inflation: lireParam('inflation'),
    frais:     lireParam('frais'),
    aug:       lireParam('aug'),
  };
}

/* Relie un curseur (s-nom) et son champ numérique (n-nom) */
function wire(nom) {
  const sl = document.getElementById('s-' + nom);
  const nu = document.getElementById('n-' + nom);
  fillSlider(sl);
  sl.addEventListener('input', () => {
    nu.value = sl.value; fillSlider(sl);
    updateCtrlValues(); debouncedRender();
  });
  nu.addEventListener('input', () => {
    sl.value = lireParam(nom); fillSlider(sl);
    updateCtrlValues(); debouncedRender();
  });
  nu.addEventListener('change', () => {
    /* Saisie validée : le champ affiche la valeur réellement retenue */
    const v = lireParam(nom);
    nu.value = v; sl.value = v; fillSlider(sl);
    updateCtrlValues(); debouncedRender();
  });
}

function isCouple() {
  return document.getElementById('cb-couple').checked;
}

function getPlafond() {
  return isCouple() ? PLAFONDS.couple : PLAFONDS.pea;
}

function getAuDelaOpts() {
  const enabled = document.getElementById('cb-aude').checked;
  if (!enabled) return { enveloppe: null };
  return {
    enveloppe:   document.getElementById('aude-enveloppe').value,
    tauxAuDela:  +document.getElementById('n-taux-aude').value,
    fraisAuDela: +document.getElementById('n-frais-aude').value,
  };
}

function getRenteOpts() {
  return {
    enabled:    document.getElementById('cb-rente').checked,
    renteNette: +document.getElementById('n-rente').value,
    taux:       +document.getElementById('n-taux-rente').value,
    indexer:    document.getElementById('cb-rente-index').checked,
  };
}

function getMCOpts() {
  return {
    enabled:  document.getElementById('cb-mc').checked,
    vol:      +document.getElementById('n-vol-mc').value,
    runs:     +document.getElementById('n-runs-mc').value,
    objectif: +document.getElementById('n-objectif-mc').value,
  };
}

/* ── Mise à jour immédiate des ctrl-values ───────────────── */
function updateCtrlValues() {
  const p = getParams();
  document.getElementById('cv-mensuel').textContent   = fmt(p.mensuel);
  document.getElementById('cv-taux').textContent      = fmtTaux(p.taux);
  document.getElementById('cv-duree').textContent     = ans(p.duree);
  document.getElementById('cv-apport').textContent    = fmt(p.apport);
  document.getElementById('cv-inflation').textContent = fmtTaux(p.inflation);
  document.getElementById('cv-frais').textContent     = fmtTaux(p.frais);
  document.getElementById('cv-aug').textContent       = fmtTaux(p.aug);

  /* Sous chaque curseur de la première rangée, ce que le réglage veut dire */
  const indication = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };
  indication('mensuel-hint', `soit <strong>${fmt(p.mensuel * 12)}</strong> par an`);
  indication('duree-hint',   `jusqu'en <strong>${new Date().getFullYear() + p.duree}</strong>`);
  indication('apport-hint',  p.apport > 0 ? 'placé dès le premier jour' : 'facultatif');

  // Rendement net : frais déduits, puis inflation déduite (approche multiplicative)
  const netFrais = (1 + p.taux / 100) * (1 - p.frais / 100) - 1;
  const netReel  = (1 + netFrais) / (1 + p.inflation / 100) - 1;
  /* Deux indications côte à côte, ou l'une sous l'autre si la place manque :
     le point qui les sépare est dessiné par la feuille de style, pour ne
     jamais rester seul en fin de ligne. */
  indication('taux-net-hint',
    `<span>net de frais : <strong>${fmtPct(netFrais * 100, 2)}</strong></span>` +
    `<span>net d'inflation : <strong>${fmtPct(netReel * 100, 2)}</strong></span>`);
}

/* ── localStorage ────────────────────────────────────────── */
function applyParams(p) {
  const set = (sId, nId, val) => {
    if (val == null) return;
    const sl = document.getElementById(sId);
    const nu = document.getElementById(nId);
    const v  = clamp(+val, +sl.min, +sl.max);
    sl.value = nu.value = v; fillSlider(sl);
  };
  set('s-mensuel',   'n-mensuel',   p.mensuel);
  set('s-taux',      'n-taux',      p.taux);
  set('s-duree',     'n-duree',     p.duree);
  set('s-apport',    'n-apport',    p.apport);
  set('s-inflation', 'n-inflation', p.inflation);
  set('s-frais',     'n-frais',     p.frais);
  set('s-aug',       'n-aug',       p.aug);
  updateCtrlValues();
}

function saveParams() {
  try {
    localStorage.setItem(LS_PARAMS, JSON.stringify(getParams()));
    localStorage.setItem(LS_VPS,    JSON.stringify(vps));
    localStorage.setItem(LS_FISC,   document.getElementById('cb-fisc').checked);
    localStorage.setItem(LS_COUPLE, document.getElementById('cb-couple').checked);
    const auDeEl = document.getElementById('cb-aude');
    localStorage.setItem(LS_AUDE, JSON.stringify({
      enabled:     auDeEl.checked,
      enveloppe:   document.getElementById('aude-enveloppe').value,
      tauxAuDela:  +document.getElementById('n-taux-aude').value,
      fraisAuDela: +document.getElementById('n-frais-aude').value,
    }));
    localStorage.setItem(LS_PHASES, JSON.stringify(phases));
    localStorage.setItem(LS_OVERRIDES, JSON.stringify(overrides));
    localStorage.setItem(LS_RENTE, JSON.stringify(getRenteOpts()));
    localStorage.setItem(LS_MC, JSON.stringify(getMCOpts()));
    const btSel = document.getElementById('bt-annee');
    if (btSel && btSel.value) localStorage.setItem(LS_BT, btSel.value);
  } catch (_) {}
}

function applyRenteOpts(r) {
  if (!r || typeof r !== 'object') return;
  document.getElementById('cb-rente').checked = !!r.enabled;
  if (r.renteNette != null) document.getElementById('n-rente').value      = r.renteNette;
  if (r.taux       != null) document.getElementById('n-taux-rente').value = r.taux;
  if (r.indexer    != null) document.getElementById('cb-rente-index').checked = !!r.indexer;
  document.getElementById('rente-params').className =
    r.enabled ? 'aude-params-visible' : 'aude-params-hidden';
}

function loadParams() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PARAMS));
    if (p && typeof p === 'object') applyParams(p);

    const v = JSON.parse(localStorage.getItem(LS_VPS));
    if (Array.isArray(v) && v.length) {
      vps  = v;
      vpId = v.reduce((m, x) => Math.max(m, x.id || 0), 0);
      renderVP();
    }

    const f = localStorage.getItem(LS_FISC);
    if (f !== null) document.getElementById('cb-fisc').checked = (f === 'true');

    const c = localStorage.getItem(LS_COUPLE);
    if (c !== null) document.getElementById('cb-couple').checked = (c === 'true');

    const a = JSON.parse(localStorage.getItem(LS_AUDE));
    if (a && typeof a === 'object') {
      document.getElementById('cb-aude').checked = !!a.enabled;
      if (a.enveloppe) document.getElementById('aude-enveloppe').value = a.enveloppe;
      if (a.tauxAuDela  != null) document.getElementById('n-taux-aude').value  = a.tauxAuDela;
      if (a.fraisAuDela != null) document.getElementById('n-frais-aude').value = a.fraisAuDela;
      document.getElementById('aude-params').className =
        a.enabled ? 'aude-params-visible' : 'aude-params-hidden';
    }

    const ph = JSON.parse(localStorage.getItem(LS_PHASES));
    if (Array.isArray(ph) && ph.length) {
      phases  = ph;
      phaseId = ph.reduce((m, x) => Math.max(m, x.id || 0), 0);
      renderPhases();
    }

    const ov = JSON.parse(localStorage.getItem(LS_OVERRIDES));
    if (ov && typeof ov === 'object' && !Array.isArray(ov)) overrides = ov;

    applyRenteOpts(JSON.parse(localStorage.getItem(LS_RENTE)));

    const mc = JSON.parse(localStorage.getItem(LS_MC));
    if (mc && typeof mc === 'object') {
      document.getElementById('cb-mc').checked = !!mc.enabled;
      if (mc.vol      != null) document.getElementById('n-vol-mc').value      = mc.vol;
      if (mc.runs)             document.getElementById('n-runs-mc').value     = mc.runs;
      if (mc.objectif != null) document.getElementById('n-objectif-mc').value = mc.objectif;
      document.getElementById('mc-params').className =
        mc.enabled ? 'aude-params-visible' : 'aude-params-hidden';
    }

    const bt = localStorage.getItem(LS_BT);
    if (bt && document.querySelector(`#bt-annee option[value="${bt}"]`)) {
      document.getElementById('bt-annee').value = bt;
    }
  } catch (_) {}
}

/* ── Badge delta ─────────────────────────────────────────── */
function setDelta(id, cur, ref, isCur = true, invert = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const d = cur - ref;
  if (Math.abs(d) < (isCur ? 0.5 : 0.005)) {
    el.textContent = ''; el.className = 'kpi-delta'; return;
  }
  if (isCur) {
    const pct    = ref !== 0 ? Math.round(Math.abs(d / ref) * 100) : null;
    const pctStr = pct != null ? ` (${signe(d)}${pct} %)` : '';
    el.textContent = signe(d) + fmtAbs(d) + pctStr;
  } else {
    el.textContent = `${signe(d)}${fmtNb(Math.abs(d), 2)}`;
  }
  el.title = 'Écart avec le plan par défaut';
  const good = invert ? d < 0 : d > 0;
  el.className = 'kpi-delta ' + (good ? 'pos' : 'neg');
}

/* ── Versements ponctuels ────────────────────────────────── */
function renderVP() {
  const duree = getParams().duree;
  const list  = document.getElementById('vp-list');
  const badge = document.getElementById('vp-count');
  if (!vps.length) {
    list.innerHTML = `<p class="vp-empty">Aucun versement ponctuel. Ajoutez une prime, un bonus ou un héritage prévu.</p>`;
    badge.textContent = ''; badge.classList.remove('show');
    return;
  }
  list.innerHTML = vps.map(v => `
    <div class="vp-row" data-id="${v.id}">
      <label class="vp-field">
        <span class="lbl-yr">${v.recurrent ? "Dès l'an" : 'Année'}</span>
        <input class="vp-input vp-input-yr vp-yr" type="number" min="1" max="${duree}" value="${v.annee}" inputmode="numeric">
      </label>
      <label class="vp-field">
        <span>Montant (€)</span>
        <input class="vp-input vp-input-amt vp-amt" type="number" min="0" step="100" value="${v.montant}" inputmode="decimal">
      </label>
      <label class="vp-field vp-field-large">
        <span>Libellé</span>
        <input class="vp-input vp-input-lbl vp-lbl" type="text" maxlength="60" placeholder="Prime, bonus, héritage…" value="${escHtml(v.libelle || '')}">
      </label>
      <label class="vp-check-col">
        <span>Récurrent</span>
        <input class="cb-custom vp-rec" type="checkbox" ${v.recurrent ? 'checked' : ''}>
      </label>
      <button class="vp-btn-del" type="button" aria-label="Supprimer ce versement" title="Supprimer">✕</button>
      <p class="vp-hors" hidden>Au-delà de la durée simulée : ce versement n'est pas pris en compte.</p>
    </div>`).join('');
  badge.textContent = vps.length;
  badge.classList.add('show');
  majVPHorsDuree(duree);
}

/* Un versement prévu après la fin de la simulation n'est pas compté : on le
   signale, plutôt que de le déplacer d'office — la durée se règle au
   curseur, on la fait varier pour comparer, puis on revient. */
function majVPHorsDuree(duree) {
  document.querySelectorAll('#vp-list .vp-row').forEach(row => {
    const v    = vps.find(x => x.id === +row.dataset.id);
    const hors = !!v && v.annee > duree;
    row.classList.toggle('hors-duree', hors);
    row.querySelector('.vp-hors').hidden = !hors;
    row.querySelector('.vp-yr').max = duree;
  });
}

/* ── Fiscalité PEA vs CTO ────────────────────────────────── */
function renderFisc(gain, final) {
  const div   = document.getElementById('fisc-details');
  const badge = document.getElementById('fisc-badge');
  const on    = document.getElementById('cb-fisc').checked;
  const psPS  = gain * PS_PEA,   netPEA = final - psPS;
  const flat  = gain * FLAT_TAX, netCTO = final - flat;
  /* Les taux affichés viennent des constantes de simulation.js : un seul endroit à tenir à jour */
  const txPS  = fmtTaux(PS_PEA * 100), txPFU = fmtTaux(FLAT_TAX * 100);

  badge.textContent = on && gain > 0 ? `− ${fmt(psPS)}` : '';
  badge.classList.toggle('show', on && gain > 0);
  if (!on) { div.innerHTML = ''; return; }
  if (gain <= 0) {
    div.innerHTML = '<p class="annees-hint">Pas de plus-value dans cette simulation : aucun prélèvement à la sortie.</p>';
    return;
  }
  div.innerHTML = `
    <div class="fisc-comparison">
      <div class="fisc-box mieux">
        <div class="fisc-box-title">PEA — retrait après 5 ans</div>
        <div class="fisc-line"><span class="fisc-lbl">Plus-value brute</span><span>${fmt(gain)}</span></div>
        <div class="fisc-line"><span class="fisc-lbl">Prélèvements sociaux (${txPS})</span><span class="fisc-neg">− ${fmt(psPS)}</span></div>
        <div class="fisc-line fisc-line-total"><span class="fisc-lbl">Capital net</span><span class="fisc-pos">${fmt(netPEA)}</span></div>
      </div>
      <div class="fisc-box">
        <div class="fisc-box-title">Compte-titres ordinaire (CTO)</div>
        <div class="fisc-line"><span class="fisc-lbl">Plus-value brute</span><span>${fmt(gain)}</span></div>
        <div class="fisc-line"><span class="fisc-lbl">Flat tax (${txPFU})</span><span class="fisc-neg">− ${fmt(flat)}</span></div>
        <div class="fisc-line fisc-line-total"><span class="fisc-lbl">Capital net</span><span>${fmt(netCTO)}</span></div>
      </div>
      <div class="fisc-avantage">Avantage fiscal du PEA sur le compte-titres : <strong>+ ${fmt(netPEA - netCTO)}</strong></div>
    </div>`;
}

/* ── Plafond widget ──────────────────────────────────────── */
function renderPlafond(d, plafond, couple, p) {
  const versNets = d.versNets || 0;
  const pct      = Math.min(100, versNets / plafond * 100);

  // Barre de progression
  const fill = document.getElementById('plafond-fill');
  fill.style.width = pct + '%';
  fill.className = 'plafond-fill' + (pct >= 100 ? ' full' : pct >= 80 ? ' warn' : '');
  fill.parentElement.setAttribute('aria-valuenow', Math.round(pct));
  fill.parentElement.setAttribute('aria-valuetext',
    `${fmt(versNets)} versés sur ${fmt(plafond)} de plafond`);

  document.getElementById('plafond-verse-lbl').textContent = fmt(versNets);
  document.getElementById('plafond-pct-lbl').textContent   =
    `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  document.getElementById('plafond-max-lbl').textContent   = fmt(plafond);

  // Badge statut
  const badge = document.getElementById('plafond-badge');
  if (d.plafondAn != null) {
    badge.textContent = d.plafondAn === 0 ? 'Atteint dès le départ' : `Atteint en année ${d.plafondAn}`;
    badge.className   = 'plafond-status-badge full-badge';
  } else if (pct >= 80) {
    badge.textContent = `${Math.round(pct)} % — bientôt atteint`;
    badge.className   = 'plafond-status-badge warn-badge';
  } else {
    badge.textContent = `${Math.round(pct)} % utilisé`;
    badge.className   = 'plafond-status-badge ok-badge';
  }

  // Message contextuel
  const info = document.getElementById('plafond-info');
  if (d.plafondAn != null) {
    const anTxt   = d.plafondAn === 0 ? 'dès l\'apport initial' : `en année ${d.plafondAn}`;
    const reste   = p.duree - d.plafondAn;
    const suite   = reste > 0
      ? ` Pendant les ${ans(reste)} qui suivent, le PEA ne grandit plus que par ses gains.` : '';
    const conseil = document.getElementById('cb-aude').checked
      ? 'Le surplus est versé dans votre enveloppe complémentaire.'
      : 'Activez « Au-delà du plafond » pour continuer à épargner dans une autre enveloppe.';
    info.innerHTML = `⚠ Plafond atteint ${anTxt}.${suite} ${conseil}`;
    info.className = 'plafond-info warn';
  } else {
    const restant = plafond - versNets;
    const coupleHint = !couple
      ? ' En couple, deux PEA portent ce plafond à 300 000 €.'
      : '';
    info.innerHTML = `Il vous reste <strong>${fmt(restant)}</strong> de capacité de versement sur la durée simulée.${coupleHint}`;
    info.className = 'plafond-info ok';
  }
}

/* ── Au-delà du plafond : tableau fiscal comparatif ─────── */
function renderAuDela(d) {
  const enabled = document.getElementById('cb-aude').checked;
  const params  = document.getElementById('aude-params');
  params.className = enabled ? 'aude-params-visible' : 'aude-params-hidden';

  const badge = document.getElementById('aude-badge');
  if (enabled && (d.capAuDelaFinal || 0) > 0) {
    badge.textContent = fmt(d.capAuDelaFinal);
    badge.classList.add('show');
  } else {
    badge.textContent = ''; badge.classList.remove('show');
  }

  const fiscalDiv = document.getElementById('aude-fiscal');
  if (!enabled) { fiscalDiv.innerHTML = ''; return; }
  if ((d.capAuDelaFinal || 0) <= 0) {
    fiscalDiv.innerHTML = '<p class="annees-hint">Le plafond du PEA n\'est pas atteint dans cette simulation : rien n\'est versé dans l\'enveloppe complémentaire.</p>';
    return;
  }
  if ((d.gainAuDela || 0) <= 0) { fiscalDiv.innerHTML = ''; return; }

  const fisc  = computeFiscal(d, { couple: isCouple() });
  const choix = document.getElementById('aude-enveloppe').value;

  /* Les trois enveloppes reçoivent le même surplus et le font fructifier
     pareil : seul l'impôt à la sortie les distingue. Une fiche par
     enveloppe (et non un tableau, illisible sur téléphone), la règle
     fiscale écrite en clair — elle change quand un plafond est dépassé. */
  const irAV = fmtTaux((TAUX_AV_8ANS - PS_AV) * 100), irAVHaut = fmtTaux((TAUX_AV_8ANS_AU_DELA - PS_AV) * 100);
  const envs = [
    { cle: 'cto', nom: 'Compte-titres', court: 'un compte-titres',
      regle: `Flat tax de ${fmtTaux(FLAT_TAX * 100)} sur la plus-value.`,
      impot: fisc.impotCTO, net: fisc.netCTO_ade },
    { cle: 'av', nom: 'Assurance-vie de plus de 8 ans', court: 'une assurance-vie',
      regle: `${fmtTaux(PS_AV * 100)} de prélèvements sociaux sur la plus-value, et l'impôt sur ce qui dépasse ${fmt(fisc.abattement)} d'abattement : `
        + (fisc.avAuDelaDuSeuil
          ? `${irAV} pour la part des ${fmt(fisc.seuilAV)} premiers euros versés, ${irAVHaut} au-delà.`
          : `${irAV}.`),
      impot: fisc.impotAV, net: fisc.netAV_ade },
    { cle: 'peapme', nom: 'PEA-PME', court: 'un PEA-PME',
      regle: fisc.pmeSature
        ? `${fmtTaux(PS_PEA * 100)} de prélèvements sociaux sur les ${fmt(fisc.plafondPME)} qu'il peut recevoir ; les ${fmt(fisc.verseHorsPME)} suivants partent sur un compte-titres (${fmtTaux(FLAT_TAX * 100)}).`
        : `${fmtTaux(PS_PEA * 100)} de prélèvements sociaux, comme le PEA — dans la limite de ${fmt(fisc.plafondPME)} de versements.`,
      impot: fisc.impotPEAPME, net: fisc.netPEAPME_ade },
  ];

  const refNet  = fisc.netCTO_ade;
  const best    = envs.reduce((a, b) => (b.net > a.net + 0.5 ? b : a));
  const choisie = envs.find(e => e.cle === choix) || envs[0];

  const fiches = envs.map(e => {
    const ecart = e.net - refNet;
    const puces = (e === choisie ? '<span class="chip-choix">votre choix</span>' : '')
      + (e === best && best.net > refNet + 0.5 ? '<span class="chip-mieux">le plus avantageux</span>' : '');
    return `
      <div class="fisc-box env-box${e === choisie ? ' choisie' : ''}${e === best ? ' mieux' : ''}">
        <div class="fisc-box-title">${e.nom}</div>
        <div class="env-chips${puces ? '' : ' vide'}">${puces}</div>
        <p class="env-regle">${e.regle}</p>
        <div class="fisc-line"><span class="fisc-lbl">Impôt à la sortie</span><span class="fisc-neg">− ${fmt(e.impot)}</span></div>
        <div class="fisc-line fisc-line-total"><span class="fisc-lbl">Capital net</span><span>${fmt(e.net)}</span></div>
        <div class="fisc-line"><span class="fisc-lbl">Face au compte-titres</span>
          <span class="${ecart > 0.5 ? 'fisc-pos' : ecart < -0.5 ? 'fisc-neg' : 'fisc-lbl'}">${e.cle === 'cto' ? 'référence' : signe(ecart) + fmtAbs(ecart)}</span></div>
      </div>`;
  }).join('');

  const totalNet = fisc.netPEA + choisie.net;
  const economie = totalNet - fisc.netCTO_all;
  const mieux    = best.net - choisie.net;

  fiscalDiv.innerHTML = `
    <p class="annees-hint env-intro">
      Au terme, le complément contient <strong>${fmt(fisc.capAuDela)}</strong>, dont
      <strong>${fmt(fisc.gainAuDela)}</strong> de plus-value. Ce qu'il en reste une fois l'impôt payé,
      selon l'enveloppe :
    </p>
    <div class="env-grid">${fiches}</div>
    <div class="fisc-table-footer">
      PEA + ${choisie.court}, impôts payés : <strong>${fmt(totalNet)}</strong>
      · soit ${signe(economie)} ${fmtAbs(economie)} par rapport à tout placer sur un compte-titres${mieux > 0.5
        ? `<br><span class="env-mieux-note">Avec ${best.court} à la place : ${fmt(mieux)} de plus.</span>` : ''}
    </div>`;
}

/* ── Phase de rente ──────────────────────────────────────── */
function renderRente(d, p) {
  const o      = getRenteOpts();
  const badge  = document.getElementById('rente-badge');
  const resDiv = document.getElementById('rente-results');
  document.getElementById('rente-params').className =
    o.enabled ? 'aude-params-visible' : 'aude-params-hidden';

  if (!o.enabled || d.final <= 0 || o.renteNette <= 0) {
    badge.textContent = ''; badge.classList.remove('show');
    resDiv.innerHTML = '';
    updateRenteChart(null);
    return;
  }

  const base = {
    capital:    d.final,
    versements: d.versNets,
    taux:       o.taux,
    frais:      p.frais,
    inflation:  p.inflation,
    indexer:    o.indexer,
    dureeMax:   50,
  };
  const r        = computeRente({ ...base, renteNette: o.renteNette });
  const renteMax = renteMaxPourDuree(base, 50);

  /* Durée de vie du capital */
  const epuise = r.moisEpuisement !== null;
  let dureeTxt, dureeSub;
  if (epuise) {
    const a    = Math.floor(r.moisEpuisement / 12);
    const mois = r.moisEpuisement % 12;
    dureeTxt = a > 0 ? `${ans(a)}${mois ? ` ${mois} mois` : ''}` : `${mois} mois`;
    dureeSub = 'avant épuisement du capital';
  } else {
    dureeTxt = '50 ans et plus';
    dureeSub = `capital restant au bout de 50 ans : ${fmt(r.capFinal)}`;
  }

  badge.textContent = epuise ? dureeTxt : '50 ans et +';
  badge.classList.add('show');

  const renteFinaleTxt = o.indexer && !epuise
    ? ` · rente revalorisée : ${fmt(r.renteFinale)}/mois au bout de 50 ans`
    : '';

  /* La couleur dit l'état (le capital tient, ou s'épuise) ; les autres
     chiffres restent à l'encre du texte. */
  resDiv.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi ${epuise ? 'gold' : 'green'}">
        <div class="kpi-label">Durée du capital</div>
        <div class="kpi-value">${dureeTxt}</div>
        <div class="kpi-sub">${dureeSub}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Rente soutenable 50 ans</div>
        <div class="kpi-value">${fmt(renteMax)}</div>
        <div class="kpi-sub">nets par mois sans épuiser le capital</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Total retiré (net)</div>
        <div class="kpi-value">${fmt(r.retraitNetTotal)}</div>
        <div class="kpi-sub">sur la période simulée${renteFinaleTxt}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Prélèvements sociaux</div>
        <div class="kpi-value">${fmt(r.psTotal)}</div>
        <div class="kpi-sub">${fmtTaux(PS_PEA * 100)} sur la part de plus-value</div>
      </div>
    </div>`;

  updateRenteChart(r);
}

/* ── Monte Carlo ─────────────────────────────────────────── */

/* Le tirage est reproductible (générateur semé) : à paramètres égaux,
   inutile de relancer des milliers de trajectoires à chaque rendu. */
let _mcMemo = { cle: '', res: null };

function renderMC(p, regulier, plafond) {
  const o      = getMCOpts();
  const badge  = document.getElementById('mc-badge');
  const resDiv = document.getElementById('mc-results');
  document.getElementById('mc-params').className =
    o.enabled ? 'aude-params-visible' : 'aude-params-hidden';

  if (!o.enabled || p.duree < 1) {
    badge.textContent = ''; badge.classList.remove('show');
    resDiv.innerHTML = '';
    updateMCChart(null);
    return;
  }

  const vol = clamp(o.vol || 0, 1, 40);
  const cle = JSON.stringify([p.mensuel, p.taux, p.duree, p.apport, p.frais, p.aug, plafond, vol, o.runs, o.objectif]);
  if (_mcMemo.cle !== cle) {
    _mcMemo = { cle, res: computeMonteCarlo(p, { vol, runs: o.runs, objectif: o.objectif, plafond }) };
  }
  const mc = _mcMemo.res;

  badge.textContent = `± ${fmtTaux(vol)}`;
  badge.classList.add('show');

  const pPerte = Math.round(mc.probPerte * 100);
  const objectifHtml = mc.probObjectif != null ? `
      <div class="kpi">
        <div class="kpi-label">Objectif de ${fmt(o.objectif)}</div>
        <div class="kpi-value">${Math.round(mc.probObjectif * 100)} %</div>
        <div class="kpi-sub">des trajectoires l'atteignent en ${ans(p.duree)}</div>
      </div>` : '';

  resDiv.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi s1">
        <div class="kpi-label">Médiane à terme</div>
        <div class="kpi-value">${fmt(mc.medianeFinale)}</div>
        <div class="kpi-sub">une trajectoire sur deux fait mieux</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Fourchette probable</div>
        <div class="kpi-value long">${fmt(mc.p10Final)} – ${fmt(mc.p90Final)}</div>
        <div class="kpi-sub">80 % des trajectoires entre ces bornes</div>
      </div>
      ${objectifHtml}
      <div class="kpi ${pPerte > 15 ? 'red' : pPerte > 0 ? 'gold' : 'green'}">
        <div class="kpi-label">Risque de moins-value</div>
        <div class="kpi-value">${pPerte} %</div>
        <div class="kpi-sub">de finir sous les ${fmt(mc.verséTotal)} versés</div>
      </div>
    </div>`;

  updateMCChart(mc, regulier.totL);
}

/* ── Backtest historique ─────────────────────────────────── */
let _btLigneTracee = false;

function renderBacktest(p, dRef, plafond) {
  const sel    = document.getElementById('bt-annee');
  const badge  = document.getElementById('bt-badge');
  const resDiv = document.getElementById('bt-results');
  if (!sel || !sel.options.length) return;

  const annee = +sel.value;
  const bt    = computeBacktest(p, annee, plafond);

  /* Départs célèbres : celui qui correspond à l'année choisie est marqué */
  document.querySelectorAll('.bt-preset').forEach(b => {
    const actif = +b.dataset.annee === annee;
    b.classList.toggle('active', actif);
    b.setAttribute('aria-pressed', String(actif));
  });

  if (!bt) {
    badge.textContent = ''; badge.classList.remove('show');
    resDiv.innerHTML = '';
    return;
  }

  badge.textContent = `${bt.anneeDebut} → ${bt.anneeFin}`;
  badge.classList.add('show');

  /* Comparaison au plan déterministe, au même horizon */
  const refFinal = dRef.totL[bt.duree - 1] != null ? dRef.totL[bt.duree - 1] : dRef.final;
  const ecart    = bt.final - refFinal;
  const pire     = bt.pireAnnee.taux;

  resDiv.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Capital obtenu</div>
        <div class="kpi-value">${fmt(bt.final)}</div>
        <div class="kpi-sub">${ans(bt.duree)} de marchés réels (${bt.anneeDebut}–${bt.anneeFin})</div>
      </div>
      <div class="kpi ${ecart >= 0 ? 'green' : 'red'}">
        <div class="kpi-label">Écart avec votre plan à ${fmtTaux(p.taux)}</div>
        <div class="kpi-value">${signe(ecart)}${fmtAbs(ecart)}</div>
        <div class="kpi-sub">au même horizon de ${ans(bt.duree)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Rendement annualisé</div>
        <div class="kpi-value">${bt.tri != null ? fmtPct(bt.tri) : '—'}</div>
        <div class="kpi-sub">de vos versements, frais déduits (${fmt(bt.versé)} versés)</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Pire année traversée</div>
        <div class="kpi-value">${pire > 0 ? '+' : ''}${fmtTaux(pire)}</div>
        <div class="kpi-sub">en ${bt.pireAnnee.annee}</div>
      </div>
    </div>
    ${bt.tronque ? `<p class="annees-hint bt-note">Les données historiques s'arrêtent en
      ${HISTO_MSCI_WORLD[HISTO_MSCI_WORLD.length - 1].annee} : backtest limité à
      ${ans(bt.duree)} sur les ${p.duree} du plan.</p>` : ''}
    <div class="bt-actions">
      <button class="preset-btn" type="button" data-action="bt-trace">${_btLigneTracee
        ? '📈 Voir sur « Évolution du capital »' : '📈 Tracer sur « Évolution du capital »'}</button>
      ${_btLigneTracee ? '<button class="preset-btn" type="button" data-action="bt-clear">✕ Retirer la courbe</button>' : ''}
    </div>`;

  /* Si la courbe est déjà tracée, la tenir à jour avec les nouveaux paramètres */
  if (_btLigneTracee) addComparisonLine(bt.totL, bt.yrs, `Backtest ${bt.anneeDebut}`);
}

/* ── Utilitaire XSS ──────────────────────────────────────── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Gestion des scénarios sauvegardés ───────────────────── */

function loadScenarios() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_SCENARIOS));
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function saveScenarios(arr) {
  try {
    localStorage.setItem(LS_SCENARIOS, JSON.stringify(arr));
    return true;
  } catch (_) {
    notifier('Enregistrement impossible : le stockage du navigateur est plein ou bloqué. Supprimez d\'anciens scénarios.', 'erreur');
    return false;
  }
}

function buildScenarioParams() {
  return {
    ...getParams(),
    vps:    JSON.parse(JSON.stringify(vps)),
    fisc:   document.getElementById('cb-fisc').checked,
    couple: document.getElementById('cb-couple').checked,
    aude: {
      enabled:     document.getElementById('cb-aude').checked,
      enveloppe:   document.getElementById('aude-enveloppe').value,
      tauxAuDela:  +document.getElementById('n-taux-aude').value,
      fraisAuDela: +document.getElementById('n-frais-aude').value,
    },
    phases: JSON.parse(JSON.stringify(phases)),
    overrides: JSON.parse(JSON.stringify(overrides)),
    rente: getRenteOpts(),
  };
}

function renderScenariosList() {
  const arr   = loadScenarios();
  const list  = document.getElementById('scenarios-list');
  const badge = document.getElementById('scenarios-badge');
  const hint  = document.getElementById('scenarios-limit-hint');
  if (!list) return;

  if (badge) {
    badge.textContent = arr.length ? String(arr.length) : '';
    badge.classList.toggle('show', arr.length > 0);
  }
  if (hint) {
    const reste = MAX_SCENARIOS - arr.length;
    hint.textContent = reste <= 0
      ? `Limite atteinte (${MAX_SCENARIOS} scénarios)`
      : reste <= 2
        ? `${reste} emplacement${reste > 1 ? 's' : ''} restant${reste > 1 ? 's' : ''}`
        : '';
  }

  if (!arr.length) {
    list.innerHTML = '<p class="scenarios-empty">Aucun scénario sauvegardé. Enregistrez vos réglages actuels pour les retrouver plus tard ou les comparer à une autre stratégie.</p>';
    return;
  }

  list.innerHTML = arr.map(sc => {
    const pm      = sc.parametres || {};
    const kpi     = sc.resultats_kpi || {};
    const compare = sc.id === _compareId;
    const dateStr = new Date(sc.date_modification).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return `
    <div class="scenario-save-card${compare ? ' compare' : ''}" data-id="${sc.id}">
      <div class="sc-card-header">
        <div class="sc-card-name">${escHtml(sc.nom)}</div>
        <div class="sc-card-date">Modifié le ${dateStr}</div>
      </div>
      <div class="sc-card-kpis">
        <span class="sc-kpi"><span class="sc-kpi-lbl">Versement</span>${fmt(+pm.mensuel || 0)}/mois</span>
        <span class="sc-kpi"><span class="sc-kpi-lbl">Rendement</span>${fmtTaux(+pm.taux || 0)}</span>
        <span class="sc-kpi"><span class="sc-kpi-lbl">Durée</span>${ans(+pm.duree || 0)}</span>
        <span class="sc-kpi"><span class="sc-kpi-lbl">Capital final</span>${fmt(+kpi.final || 0)}</span>
      </div>
      <div class="sc-card-actions">
        <button class="sc-btn" type="button" data-action="load">📂 Charger</button>
        <button class="sc-btn" type="button" data-action="rename">✏️ Renommer</button>
        ${compare
          ? '<button class="sc-btn sc-btn-compare" type="button" data-action="uncompare" aria-pressed="true">✕ Retirer la comparaison</button>'
          : '<button class="sc-btn sc-btn-compare" type="button" data-action="compare" aria-pressed="false">📋 Comparer</button>'}
        <button class="sc-btn sc-btn-del" type="button" data-action="del">🗑️ Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

/* Demande un nom dans une fenêtre modale. Résout le nom saisi, ou null si
   l'on annule. Un <form> : la touche Entrée valide. */
function demanderNom({ titre, libelle, valeur, ok }) {
  return new Promise(resolve => {
    let nom = null;
    const { fond, fermer } = ouvrirModale(`
      <form novalidate>
        <h2 class="modal-title" id="modale-titre">${titre}</h2>
        <label class="modal-lbl" for="modale-nom">${libelle}</label>
        <input class="modal-input" type="text" id="modale-nom" maxlength="50" autocomplete="off"
               placeholder="Nom…" value="${escHtml(valeur)}">
        <div class="modal-footer">
          <button type="button" class="modal-btn-cancel" data-fermer>Annuler</button>
          <button type="submit" class="modal-btn-primary">${ok}</button>
        </div>
      </form>`, { focus: '#modale-nom', surFermeture: () => resolve(nom) });

    const champ = fond.querySelector('#modale-nom');
    champ.select();
    champ.addEventListener('input', () => champ.classList.remove('modal-input-error'));
    fond.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const saisi = champ.value.trim();
      if (!saisi) { champ.classList.add('modal-input-error'); champ.focus(); return; }
      nom = saisi.slice(0, 50);
      fermer();
    });
  });
}

async function saveScenario() {
  if (loadScenarios().length >= MAX_SCENARIOS) {
    notifier(`Limite de ${MAX_SCENARIOS} scénarios atteinte : supprimez-en un pour en enregistrer un nouveau.`, 'erreur');
    return;
  }
  const now     = new Date();
  const propose = `Scénario du ${now.toLocaleDateString('fr-FR')} ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
  const nom = await demanderNom({
    titre: 'Sauvegarder ce scénario', libelle: 'Nom du scénario', valeur: propose, ok: 'Enregistrer',
  });
  if (nom == null) return;

  const arr = loadScenarios();
  if (arr.length >= MAX_SCENARIOS) return;   // rempli entre-temps depuis un autre onglet
  const d    = compute(getParams(), vps, { plafond: getPlafond(), ...getAuDelaOpts() }, phases, overrides);
  const date = new Date().toISOString();
  arr.push({
    id:                Date.now(),
    nom,
    date_creation:     date,
    date_modification: date,
    parametres:        buildScenarioParams(),
    resultats_kpi: {
      final:    d.final,
      verse:    d.versé,
      gain:     d.gain,
      reel:     d.reel,
      mult:     d.mult,
      fraisTot: d.fraisTot,
    },
  });
  if (!saveScenarios(arr)) return;
  renderScenariosList();
  setColl('coll-scenarios', true);
  notifier(`Scénario « ${nom} » enregistré`);
}

async function renameScenario(id) {
  const sc = loadScenarios().find(s => s.id === id);
  if (!sc) return;
  const nom = await demanderNom({
    titre: 'Renommer le scénario', libelle: 'Nouveau nom', valeur: sc.nom, ok: 'Renommer',
  });
  if (nom == null || nom === sc.nom) return;
  const arr = loadScenarios();
  const s   = arr.find(x => x.id === id);
  if (!s) return;
  s.nom = nom;
  s.date_modification = new Date().toISOString();
  if (!saveScenarios(arr)) return;
  renderScenariosList();
  /* La légende du graphique porte le nom du scénario comparé */
  if (_compareId === id) startCompare(id, { tableau: false });
}

async function deleteScenario(id) {
  const sc = loadScenarios().find(s => s.id === id);
  if (!sc) return;
  const oui = await confirmer({
    titre: `Supprimer « ${sc.nom} » ?`,
    message: 'Ce scénario sauvegardé sera définitivement effacé.',
    ok: 'Supprimer', danger: true,
  });
  if (!oui) return;
  if (_compareId === id) stopCompare();
  saveScenarios(loadScenarios().filter(s => s.id !== id));
  renderScenariosList();
  notifier('Scénario supprimé');
}

/* Ce qui est à l'écran existe-t-il ailleurs ? Oui si c'est le plan par
   défaut ou un scénario déjà sauvegardé : le remplacer ne fait rien perdre. */
function etatCourantSauvegarde() {
  const courant = JSON.stringify(buildScenarioParams());
  if (loadScenarios().some(s => JSON.stringify(s.parametres) === courant)) return true;
  const p = getParams();
  return Object.keys(DEFAULTS).every(k => p[k] === DEFAULTS[k])
    && !vps.length && !phases.length && !nbOverrideYears();
}

async function loadScenario(id) {
  const sc = loadScenarios().find(s => s.id === id);
  if (!sc || !sc.parametres) return;

  if (!etatCourantSauvegarde()) {
    const oui = await confirmer({
      titre: `Charger « ${sc.nom} » ?`,
      message: 'Vos réglages actuels ne sont pas sauvegardés : ils seront remplacés par ceux de ce scénario.',
      ok: 'Charger',
    });
    if (!oui) return;
  }

  const pm = sc.parametres;
  applyParams(pm);

  vps   = Array.isArray(pm.vps) ? JSON.parse(JSON.stringify(pm.vps)) : [];
  vpId  = vps.reduce((m, x) => Math.max(m, x.id || 0), 0);
  renderVP();

  phases         = Array.isArray(pm.phases) ? JSON.parse(JSON.stringify(pm.phases)) : [];
  phaseId        = phases.reduce((m, x) => Math.max(m, x.id || 0), 0);
  editingPhaseId = null;
  const explainEl = document.getElementById('scenario-explain');
  if (explainEl) explainEl.style.display = 'none';
  renderPhases();

  overrides = (pm.overrides && typeof pm.overrides === 'object' && !Array.isArray(pm.overrides))
    ? JSON.parse(JSON.stringify(pm.overrides)) : {};
  expandedYears.clear();

  if (pm.fisc   != null) document.getElementById('cb-fisc').checked   = !!pm.fisc;
  if (pm.couple != null) document.getElementById('cb-couple').checked = !!pm.couple;
  if (pm.aude) {
    document.getElementById('cb-aude').checked = !!pm.aude.enabled;
    if (pm.aude.enveloppe)     document.getElementById('aude-enveloppe').value  = pm.aude.enveloppe;
    if (pm.aude.tauxAuDela  != null) document.getElementById('n-taux-aude').value  = pm.aude.tauxAuDela;
    if (pm.aude.fraisAuDela != null) document.getElementById('n-frais-aude').value = pm.aude.fraisAuDela;
    document.getElementById('aude-params').className =
      pm.aude.enabled ? 'aude-params-visible' : 'aude-params-hidden';
  }
  if (pm.rente) applyRenteOpts(pm.rente);
  _peaReel = null;
  computeAndRender();
  notifier(`Scénario « ${sc.nom} » chargé`);
}

/* Superpose au graphique la courbe d'un scénario sauvegardé et, sauf
   demande contraire, ouvre le tableau des écarts. La courbe reste affichée
   une fois le tableau refermé, jusqu'à « Retirer la comparaison » : c'est
   sur le graphique qu'on voit où les deux trajectoires se séparent. */
function startCompare(id, { tableau = true } = {}) {
  const sc = loadScenarios().find(s => s.id === id);
  if (!sc || !sc.parametres) return;

  const pm   = sc.parametres;
  const opts = {
    plafond: pm.couple ? PLAFONDS.couple : PLAFONDS.pea,
    ...(pm.aude && pm.aude.enabled
      ? { enveloppe: pm.aude.enveloppe, tauxAuDela: pm.aude.tauxAuDela, fraisAuDela: pm.aude.fraisAuDela }
      : { enveloppe: null }),
  };
  const dB = compute(pm, Array.isArray(pm.vps) ? pm.vps : [], opts,
    Array.isArray(pm.phases) ? pm.phases : [],
    (pm.overrides && typeof pm.overrides === 'object') ? pm.overrides : {});
  if (!dB.totL.length) return;

  const p  = getParams();
  const dA = compute(p, vps, { plafond: getPlafond(), ...getAuDelaOpts() }, phases, overrides);

  /* Une seule courbe superposée à la fois : elle remplace celle du backtest */
  const btEtaitTrace = _btLigneTracee;
  _btLigneTracee = false;
  _compareId     = id;
  addComparisonLine(dB.totL, dB.yrs, sc.nom);
  renderScenariosList();
  /* Le bouton « Retirer la courbe » du backtest n'a plus lieu d'être */
  if (btEtaitTrace) renderBacktest(p, planRegulier(p, getPlafond()), getPlafond());
  if (!tableau) return;

  const nomB = escHtml(sc.nom);
  const lignes = [
    { lbl: 'Capital final',     a: dA.final,     b: dB.final },
    { lbl: 'Plus-value brute',  a: dA.gain,      b: dB.gain },
    { lbl: 'Valeur réelle',     a: dA.reel,      b: dB.reel },
    { lbl: 'Total versé',       a: dA.versé,     b: dB.versé,    neutre: true },
    { lbl: 'Multiplicateur',    a: dA.mult,      b: dB.mult,     f: v => `× ${fmtNb(v, 2)}`,
      ecartF: e => `${signe(e)}${fmtNb(Math.abs(e), 2)}` },
    { lbl: 'Frais ETF cumulés', a: dA.fraisTot,  b: dB.fraisTot, inverse: true },
    { lbl: 'Durée',             a: p.duree,      b: +pm.duree,   f: ans,                    sansEcart: true },
    { lbl: 'Versement mensuel', a: p.mensuel,    b: +pm.mensuel, f: v => `${fmt(v)}/mois`,  sansEcart: true },
    { lbl: 'Rendement moyen',   a: dA.tauxMoyen, b: dB.tauxMoyen, f: v => fmtPct(v),        sansEcart: true },
  ];

  const rows = lignes.map(l => {
    const f = l.f || fmt;
    const e = l.b - l.a;
    let ecartHtml = '—', cls = '';
    if (!l.sansEcart) {
      const pct = l.a !== 0 ? `<br><small>${signe(e)}${fmtPct(Math.abs(e / l.a) * 100)}</small>` : '';
      ecartHtml = (l.ecartF ? l.ecartF(e) : signe(e) + fmtAbs(e)) + pct;
      /* Vert quand le scénario comparé fait mieux ; les versements, eux, ne sont ni bons ni mauvais */
      if (!l.neutre && Math.abs(e) > 1e-9) cls = (l.inverse ? e < 0 : e > 0) ? 'ct-pos' : 'ct-neg';
    }
    return `<tr><td>${l.lbl}</td><td>${f(l.a)}</td><td>${f(l.b)}</td><td class="${cls}">${ecartHtml}</td></tr>`;
  }).join('');

  const durationNote = p.duree !== +pm.duree
    ? `<p class="compare-duration-note">⚠ Durées différentes : ${ans(p.duree)} pour vos réglages actuels, ${ans(+pm.duree)} pour ce scénario.</p>`
    : '';

  const { fond, fermer } = ouvrirModale(`
    <h2 class="modal-title" id="modale-titre">Vos réglages actuels face à « ${nomB} »</h2>
    ${durationNote}
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead><tr>
          <th>Indicateur</th><th>Actuel</th><th>${nomB}</th><th>Écart</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="modal-note">La courbe de ce scénario reste superposée au graphique « Évolution du capital » une fois cette fenêtre fermée.</p>
    <div class="modal-footer">
      <button type="button" class="modal-btn-cancel" data-action="retirer">Retirer la courbe</button>
      <button type="button" class="modal-btn-primary" data-fermer>Fermer</button>
    </div>`, { large: true, focus: '[data-fermer]' });

  fond.querySelector('[data-action="retirer"]').addEventListener('click', () => { stopCompare(); fermer(); });
}

function stopCompare() {
  if (_compareId == null) return;
  _compareId = null;
  removeComparisonLine();
  renderScenariosList();
}

/* ── Validation des phases (chevauchements) ──────────────── */
function validatePhases(duree) {
  const warns  = [];
  const sorted = [...phases].sort((a, b) => a.anneeDebut - b.anneeDebut);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (a.anneeFin >= b.anneeDebut) {
      warns.push(
        `Chevauchement : « ${escHtml(a.label || `Phase ${i + 1}`)} » `
        + `(jusqu’à an ${a.anneeFin}) et `
        + `« ${escHtml(b.label || `Phase ${i + 2}`)} » (dès an ${b.anneeDebut})`,
      );
    }
  }
  return warns;
}

/* ── Rendu des cartes de phases ──────────────────────────── */
function renderPhases() {
  const list  = document.getElementById('phases-list');
  const badge = document.getElementById('phases-badge');
  const duree = getParams().duree;

  if (!phases.length) {
    list.innerHTML = `<p class="phases-empty">Aucune phase définie — les paramètres globaux s’appliquent uniformément.</p>`;
    if (badge) { badge.textContent = ''; badge.classList.remove('show'); }
    document.getElementById('phases-validation').innerHTML = '';
    return;
  }

  if (badge) { badge.textContent = phases.length; badge.classList.add('show'); }

  list.innerHTML = phases.map((ph, i) => {
    const color  = PHASE_PALETTE[i % PHASE_PALETTE.length].bar;
    const isEdit = editingPhaseId === ph.id;
    const lbl    = escHtml(ph.label || `Phase ${i + 1}`);

    const viewPart = `
      <div class="phase-card-view">
        <span class="phase-num" aria-hidden="true">${i + 1}</span>
        <div class="phase-content">
          <div class="phase-label-text">${lbl}</div>
          <div class="phase-range">An ${ph.anneeDebut} → An ${ph.anneeFin}</div>
          <div class="phase-values-text">${fmt(ph.mensuel)}/mois · ${ph.taux > 0 ? '+' : ''}${fmtTaux(ph.taux)}/an</div>
        </div>
        <div class="phase-btns">
          <button class="phase-btn-edit" type="button" data-action="edit" aria-expanded="${isEdit}">Modifier</button>
          <button class="phase-btn-del" type="button" data-action="del" aria-label="Supprimer la phase ${lbl}" title="Supprimer">✕</button>
        </div>
      </div>`;

    const editPart = !isEdit ? '' : `
      <div class="phase-card-edit">
        <div class="phase-edit-grid">
          <label class="phase-edit-field phase-edit-field-wide">
            <span>Libellé</span>
            <input class="ph-lbl" type="text" maxlength="40" value="${escHtml(ph.label || '')}" placeholder="Nom de la phase…">
          </label>
          <label class="phase-edit-field">
            <span>Année de début</span>
            <input class="ph-start" type="number" min="1" max="${duree}" value="${ph.anneeDebut}" inputmode="numeric">
          </label>
          <label class="phase-edit-field">
            <span>Année de fin</span>
            <input class="ph-end" type="number" min="1" max="${duree}" value="${ph.anneeFin}" inputmode="numeric">
          </label>
          <label class="phase-edit-field">
            <span>€ / mois</span>
            <input class="ph-mensuel" type="number" min="0" step="50" value="${ph.mensuel}" inputmode="decimal">
          </label>
          <label class="phase-edit-field">
            <span>% / an</span>
            <input class="ph-taux" type="number" min="-50" max="50" step="0.5" value="${ph.taux}" inputmode="decimal">
          </label>
        </div>
        <div class="phase-edit-footer">
          <button class="ph-btn-save" type="button" data-action="save">Enregistrer</button>
          <button class="ph-btn-cancel" type="button" data-action="cancel">Annuler</button>
          <span class="phase-edit-error" role="alert"></span>
        </div>
      </div>`;

    return `<div class="phase-card" data-id="${ph.id}" style="--phase-color:${color}">${viewPart}${editPart}</div>`;
  }).join('');

  // Avertissements de chevauchement
  const warns  = validatePhases(duree);
  const valDiv = document.getElementById('phases-validation');
  valDiv.innerHTML = warns.map(w => `<div class="phases-warning">${w}</div>`).join('');
}

/* Pastille « d'où viennent les paramètres de cette année » : un réglage à
   la main, une phase de vie, ou les paramètres globaux. */
function chipSource(perso, phIdx) {
  if (perso) return '<span class="yt-phase-chip yt-perso">Perso</span>';
  if (phIdx >= 0) {
    const color = PHASE_PALETTE[phIdx % PHASE_PALETTE.length].bar;
    return `<span class="yt-phase-chip" style="background:${color}20;color:${color}">${escHtml(phases[phIdx].label || `Phase ${phIdx + 1}`)}</span>`;
  }
  return '<span class="yt-phase-chip yt-global">Global</span>';
}

/* ── Vue tableau année par année ─────────────────────────── */
function renderYearTable(p) {
  const wrap = document.getElementById('phases-year-table');
  const btn  = document.getElementById('btn-year-view');
  if (!wrap) return;

  /* Le tableau résume les phases : sans phase, ni bouton ni tableau */
  const visible = showYearView && phases.length > 0;
  if (btn) {
    btn.hidden = !phases.length;
    btn.classList.toggle('active', visible);
    btn.setAttribute('aria-expanded', String(visible));
  }
  if (!visible) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const rows = Array.from({ length: p.duree }, (_, i) => {
    const an    = i + 1;
    const base  = baseParamsForYear(p, an);
    const ov    = overrides[an] || null;
    const mens  = ov && ov.mensuel != null ? ov.mensuel : base.mensuel;
    const taux  = ov && ov.taux    != null ? ov.taux    : base.taux;
    const perso = !!ov && (ov.mensuel != null || ov.taux != null || !!ov.mois);
    return `<tr><td>An ${an}</td><td>${chipSource(perso, base.phIdx)}</td><td>${fmt(mens)}</td><td>${taux > 0 ? '+' : ''}${fmtTaux(taux)}</td></tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="year-table-wrap">
      <table class="year-table">
        <thead><tr><th>Année</th><th>Phase</th><th>Versement</th><th>Rendement</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── Personnalisation fine : année par année & mois par mois ── */
const MOIS_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

function nbOverrideYears() {
  return Object.keys(overrides).length;
}

/** Valeurs héritées (phase ou globaux) pour une année, hors overrides */
function baseParamsForYear(p, an) {
  const phIdx = phases.findIndex(ph => an >= ph.anneeDebut && an <= ph.anneeFin);
  const ph    = phIdx >= 0 ? phases[phIdx] : null;
  return {
    mensuel: ph ? ph.mensuel : Math.round(p.mensuel * Math.pow(1 + p.aug / 100, an - 1) * 100) / 100,
    taux:    ph ? ph.taux    : p.taux,
    phIdx,
  };
}

/** Supprime l'entrée d'une année si elle ne contient plus aucune personnalisation */
function cleanOverride(an) {
  const ov = overrides[an];
  if (!ov) return;
  if (ov.mois && !Object.keys(ov.mois).length) delete ov.mois;
  if (ov.mensuel == null && ov.taux == null && !ov.mois) delete overrides[an];
}

function setYearOverride(an, field, value) {
  if (!overrides[an]) overrides[an] = {};
  if (value == null) delete overrides[an][field];
  else overrides[an][field] = value;
  cleanOverride(an);
}

function setMonthOverride(an, mois, field, value) {
  if (!overrides[an])           overrides[an] = {};
  if (!overrides[an].mois)      overrides[an].mois = {};
  if (!overrides[an].mois[mois]) overrides[an].mois[mois] = {};
  if (value == null) {
    delete overrides[an].mois[mois][field];
    if (!Object.keys(overrides[an].mois[mois]).length) delete overrides[an].mois[mois];
  } else {
    overrides[an].mois[mois][field] = value;
  }
  cleanOverride(an);
}

function adjustOverridesForDuration(duree) {
  let changed = false;
  for (const k of Object.keys(overrides)) {
    if (+k > duree) { delete overrides[k]; expandedYears.delete(+k); changed = true; }
  }
  return changed;
}

/* Reconstruire la table détruit l'élément qui a le focus. On note lequel
   (année, rôle, mois) pour le lui rendre : sans cela, impossible de
   parcourir la grille au clavier, chaque saisie renverrait en haut de page. */
function cleFocusAnnees(wrap) {
  const el = document.activeElement;
  if (!el || !wrap.contains(el)) return null;
  const ligne = el.closest('[data-an]');
  if (!ligne) return null;
  return {
    an:      ligne.dataset.an,
    role:    ['an-mens', 'an-taux', 'm-vers', 'm-taux'].find(c => el.classList.contains(c)),
    mois:    el.dataset.mois,
    action:  el.dataset.action,
    modifie: el.tagName === 'INPUT' && el.value !== el.defaultValue,
  };
}

function rendreFocusAnnees(wrap, cle) {
  if (!cle) return;
  let el = null;
  if (cle.role) {
    el = wrap.querySelector(`[data-an="${cle.an}"] .${cle.role}${cle.mois ? `[data-mois="${cle.mois}"]` : ''}`);
  } else if (cle.action) {
    /* « Effacer » disparaît une fois la ligne remise à zéro : on retombe sur « déplier » */
    el = wrap.querySelector(`.an-row[data-an="${cle.an}"] [data-action="${cle.action}"]`)
      || wrap.querySelector(`.an-row[data-an="${cle.an}"] [data-action="expand"]`);
  }
  if (!el) return;
  el.focus({ preventScroll: true });
  if (cle.role) el.select();
}

/**
 * @param {Object}  p     - Paramètres globaux
 * @param {boolean} force - Reconstruire même si un champ de la table est en
 *                          cours de saisie (après validation de cette saisie)
 */
function renderAnnees(p, force = false) {
  const wrap     = document.getElementById('annees-table');
  const badge    = document.getElementById('annees-badge');
  const btnReset = document.getElementById('btn-annees-reset');
  if (!wrap) return;

  const nbOv = nbOverrideYears();
  if (badge) {
    badge.textContent = nbOv ? `${nbOv} année${nbOv > 1 ? 's' : ''} réglée${nbOv > 1 ? 's' : ''}` : '';
    badge.classList.toggle('show', nbOv > 0);
  }
  if (btnReset) btnReset.style.display = nbOv ? '' : 'none';

  // Une saisie pas encore validée ne doit pas être écrasée par un rendu venu
  // d'un autre contrôle (curseur relâché juste avant, par exemple) : la table
  // attend. Les boutons (déplier ▸, effacer ✕), eux, re-rendent tout de suite.
  const cle = cleFocusAnnees(wrap);
  if (!force && cle && cle.modifie) return;

  const prevScroll = wrap.querySelector('.an-table-wrap')?.scrollTop || 0;

  const rows = [];
  for (let an = 1; an <= p.duree; an++) {
    const base     = baseParamsForYear(p, an);
    const ov       = overrides[an] || {};
    const mensEff  = ov.mensuel != null ? ov.mensuel : base.mensuel;
    const tauxEff  = ov.taux    != null ? ov.taux    : base.taux;
    const nbMois   = ov.mois ? Object.keys(ov.mois).length : 0;
    const isCustom = ov.mensuel != null || ov.taux != null || nbMois > 0;
    const isOpen   = expandedYears.has(an);

    const moisBadge = nbMois
      ? ` <span class="an-mois-badge">${nbMois} mois réglé${nbMois > 1 ? 's' : ''}</span>` : '';

    rows.push(`
      <tr class="an-row ${isCustom ? 'an-custom' : ''}" data-an="${an}">
        <td class="an-cell-year">
          <button class="an-expand ${isOpen ? 'open' : ''}" type="button" data-action="expand" aria-expanded="${isOpen}"
                  aria-label="Régler chaque mois de l'année ${an}" title="Régler chaque mois">${isOpen ? '▾' : '▸'}</button>
          An ${an}
        </td>
        <td><input class="an-input an-mens ${ov.mensuel != null ? 'ovr' : ''}" type="number" min="0" step="10" value="${mensEff}"
                   inputmode="decimal" aria-label="Versement mensuel de l'année ${an}, en euros"></td>
        <td><input class="an-input an-taux ${ov.taux != null ? 'ovr' : ''}" type="number" min="-50" max="50" step="0.1" value="${tauxEff}"
                   inputmode="decimal" aria-label="Rendement de l'année ${an}, en pourcentage"></td>
        <td>${chipSource(isCustom, base.phIdx)}${moisBadge}</td>
        <td class="an-cell-clear">${isCustom ? `<button class="an-clear" type="button" data-action="clear" aria-label="Revenir aux valeurs héritées pour l'année ${an}" title="Revenir aux valeurs héritées">✕</button>` : ''}</td>
      </tr>`);

    if (isOpen) {
      const cells = MOIS_LABELS.map((lbl, mi) => {
        const m   = mi + 1;
        const ovM = (ov.mois && ov.mois[m]) || {};
        return `
          <div class="mois-cell">
            <div class="mois-lbl">${lbl}</div>
            <input class="an-input m-vers ${ovM.versement != null ? 'ovr' : ''}" data-mois="${m}" type="number" min="0" step="10" inputmode="decimal"
                   placeholder="${mensEff}" value="${ovM.versement != null ? ovM.versement : ''}"
                   title="Versement du mois (€)" aria-label="${lbl} de l'année ${an} : versement en euros">
            <input class="an-input m-taux ${ovM.taux != null ? 'ovr' : ''}" data-mois="${m}" type="number" min="-99" max="200" step="0.1" inputmode="decimal"
                   placeholder="${tauxEff}" value="${ovM.taux != null ? ovM.taux : ''}"
                   title="Rendement annualisé appliqué ce mois (%)" aria-label="${lbl} de l'année ${an} : rendement annualisé en pourcentage">
          </div>`;
      }).join('');
      rows.push(`
        <tr class="an-months-row" data-an="${an}">
          <td colspan="5">
            <div class="mois-head">Par mois — versement (€) en haut, rendement annualisé (%) en bas. Vide = hérite de l'année.</div>
            <div class="mois-grid">${cells}</div>
          </td>
        </tr>`);
    }
  }

  wrap.innerHTML = `
    <div class="year-table-wrap an-table-wrap">
      <table class="year-table an-table">
        <thead><tr><th>Année</th><th>Versement €/mois</th><th>Rendement %/an</th><th>Source</th><th><span class="sr-only">Effacer</span></th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;

  const newWrap = wrap.querySelector('.an-table-wrap');
  if (newWrap && prevScroll) newWrap.scrollTop = prevScroll;
  rendreFocusAnnees(wrap, cle);
}

/* ── Tableau année par année enrichi ─────────────────────── */

/* Rendement annualisé de chaque année : calculé une fois par simulation,
   pas à chaque tri ni à chaque lettre tapée dans le filtre. */
let _triMemo = { d: null, triL: [] };

function renderTable(d, phases, vps) {
  const tbody    = document.getElementById('tbody');
  const tfoot    = document.getElementById('tfoot');
  const showAude = (d.capAuDelaFinal || 0) > 0;
  const aude     = showAude ? '' : ' style="display:none"';
  if (_triMemo.d !== d) _triMemo = { d, triL: triParAnnee(d) };
  const triL = _triMemo.triL;

  const triCell = t => (t == null ? '—'
    : `<span class="${t < 0 ? 'td-tri-neg' : ''}">${fmtPct(t)}</span>`);

  // Construire les lignes de données
  const rows = d.yrs.map((an, i) => {
    const versAn  = i === 0 ? d.versL[0] : Math.max(0, d.versL[i] - d.versL[i - 1]);
    const phIdx   = d.phaseIdxL[i];
    const phase   = phIdx >= 0 ? phases[phIdx] : null;
    const phaseLabel = phase ? (phase.label || `Phase ${phIdx + 1}`) : null;
    const phaseColor = phase ? PHASE_PALETTE[phIdx % PHASE_PALETTE.length].bar : null;
    const hasVP   = vps.some(v => v.recurrent ? an >= (v.annee || 1) : an === v.annee);
    const isPlafondYear = d.plafondAn != null && d.plafondAn === an;

    return { an, versL: d.versL[i], versAn, gainL: d.gainL[i], totL: d.totL[i],
             reelL: d.reelL[i], fraisL: d.fraisL[i], capAuDelaL: d.capAuDelaL[i] || 0,
             /* Taux effectif de l'année (tient compte des réglages année/mois) */
             rendAn: d.tauxAnL[i], phaseLabel, phaseColor, tri: triL[i], hasVP, isPlafondYear };
  });

  // Appliquer le filtre
  const filterLow = _tableFilter.toLowerCase();
  const filtered  = filterLow
    ? rows.filter(r =>
        String(r.an).includes(filterLow) ||
        (r.phaseLabel && r.phaseLabel.toLowerCase().includes(filterLow))
      )
    : rows;

  // Appliquer le tri (stable via tie-breaker sur r.an)
  const colMap = {
    'an':      r => r.an,
    'vers':    r => r.versL,
    'vers-an': r => r.versAn,
    'gain':    r => r.gainL,
    'tot':     r => r.totL,
    'reel':    r => r.reelL,
    'frais':   r => r.fraisL,
    'rend-an': r => r.rendAn,
    'phase':   r => r.phaseLabel || '',
    'tri':     r => r.tri ?? -Infinity,
  };
  if (_tableSort.col && colMap[_tableSort.col]) {
    const fn = colMap[_tableSort.col];
    filtered.sort((a, b) => {
      const va = fn(a), vb = fn(b);
      let cmp  = typeof va === 'string' ? va.localeCompare(vb, 'fr') : va - vb;
      if (cmp === 0) cmp = a.an - b.an;
      return _tableSort.dir === 'asc' ? cmp : -cmp;
    });
  }

  // Rendre le tbody
  tbody.innerHTML = filtered.length ? filtered.map((r, sortedIdx) => {
    // Début de phase : premier item de cette phase dans la vue courante
    const isPhaseStart = r.phaseLabel !== null && (
      sortedIdx === 0 || filtered[sortedIdx - 1].phaseLabel !== r.phaseLabel
    );

    const phaseChip = r.phaseLabel
      ? `<span class="td-phase-chip" style="background:${r.phaseColor}20;color:${r.phaseColor}">${escHtml(r.phaseLabel)}</span>`
      : `<span class="td-phase-chip td-phase-global">—</span>`;

    const versAnStr = r.hasVP
      ? `${fmt(r.versAn)}<span class="td-vp-marker" title="Versement ponctuel cette année">💰</span>`
      : fmt(r.versAn);

    return `
      <tr${isPhaseStart ? ` class="debut-phase" style="--phase-color:${r.phaseColor}"` : ''}>
        <td class="${r.isPlafondYear ? 'td-year td-plafond-year' : 'td-year'}"${r.isPlafondYear ? ' title="Plafond du PEA atteint cette année"' : ''}>Année ${r.an}</td>
        <td>${fmt(r.versL)}</td>
        <td>${versAnStr}</td>
        <td class="td-gain">${fmt(r.gainL)}</td>
        <td class="td-total">${fmt(r.totL)}</td>
        <td class="td-reel">${fmt(r.reelL)}</td>
        <td class="td-frais">${fmt(r.fraisL)}</td>
        <td>${r.rendAn > 0 ? '+' : ''}${fmtPct(r.rendAn)}</td>
        <td>${phaseChip}</td>
        <td>${triCell(r.tri)}</td>
        <td${aude}>${r.capAuDelaL > 0 ? fmt(r.capAuDelaL) : '—'}</td>
      </tr>`;
  }).join('') : `<tr><td class="table-vide" colspan="11">Aucune année ne correspond à « ${escHtml(_tableFilter)} ».</td></tr>`;

  // Rendre le tfoot (totaux sur la simulation complète, indépendamment du filtre)
  if (tfoot) {
    const lastIdx   = d.yrs.length - 1;
    const finalReel = d.reelL[lastIdx] || 0;
    tfoot.innerHTML = `<tr>
      <td>Total</td>
      <td class="td-total">${fmt(d.versé)}</td>
      <td>—</td>
      <td class="td-gain">${fmt(d.gain)}</td>
      <td class="td-total">${fmt(d.final)}</td>
      <td class="td-reel">${fmt(finalReel)}</td>
      <td class="td-frais">${fmt(d.fraisTot)}</td>
      <td>—</td>
      <td>—</td>
      <td>${triCell(lastIdx >= 0 ? triL[lastIdx] : null)}</td>
      <td${aude}>—</td>
    </tr>`;
  }
}

/* ── Application d'un scénario pédagogique ───────────────── */
function applyScenario(key) {
  const sc = SCENARIOS[key];
  if (!sc) return;

  const p    = getParams();
  const built = sc.build(p.duree, p.mensuel, p.taux);
  phases        = built.map(ph => ({ ...ph, id: ++phaseId }));
  editingPhaseId = null;

  const explainEl = document.getElementById('scenario-explain');
  if (explainEl) {
    explainEl.innerHTML = `<strong>${escHtml(sc.nom)}</strong> — ${escHtml(sc.desc)}`;
    explainEl.style.display = '';
  }

  setColl('coll-phases', true);
  renderPhases();
  computeAndRender();
}

/* ── Ajustement des phases à la durée courante ───────────── */
function adjustPhasesForDuration(newDuree) {
  if (!phases.length) return false;
  // Snapshot : détecte suppression ET rognage de fin
  const snap = phases.map(ph => ph.id + ':' + ph.anneeFin).join(',');
  phases = phases
    .filter(ph => ph.anneeDebut <= newDuree)
    .map(ph => ({ ...ph, anneeFin: Math.min(ph.anneeFin, newDuree) }));
  const changed = phases.map(ph => ph.id + ':' + ph.anneeFin).join(',') !== snap;
  // Fermer le formulaire d'édition si la phase a disparu
  if (changed && editingPhaseId != null && !phases.find(ph => ph.id === editingPhaseId)) {
    editingPhaseId = null;
  }
  return changed;
}

/* ── Composition du capital final ────────────────────────────
   Une barre plutôt qu'un camembert : deux parts d'un même tout se comparent
   mieux sur une longueur que sur un angle, et la barre tient sous la courbe. */
function renderComposition(d) {
  const el = document.getElementById('composition');
  if (!el) return;
  if (!(d.versé > 0) && !(d.final > 0)) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;

  const VERSE = '#6e7681';   /* même gris que le repère « Total versé » de la courbe */
  /* Le pourcentage ne s'écrit dans la part que si elle est assez large pour lui */
  const seg = (pct, fond, encre = '#fff') => (pct <= 0 ? '' :
    `<span style="flex:${pct} 1 0;background:${fond};color:${encre}">${pct >= 9 ? `<i>${pct} %</i>` : ''}</span>`);

  if (d.final >= d.versé) {
    const pv = Math.round(d.versé / d.final * 100), pg = 100 - pv;
    el.innerHTML = `
      <div class="composition-titre"><span>De quoi est fait le capital final</span><span><b>${fmt(d.final)}</b></span></div>
      <div class="segbar" role="img" aria-label="Capital final : ${pv} % de versements, ${pg} % de plus-value">
        ${seg(pv, VERSE)}${seg(pg, 'var(--serie-1)')}
      </div>
      <div class="composition-legende">
        <span><i style="background:${VERSE}"></i>Vos versements <b>${fmt(d.versé)}</b></span>
        <span><i style="background:var(--serie-1)"></i>Plus-value — les intérêts composés <b>${fmt(d.gain)}</b></span>
      </div>`;
  } else {
    /* Marchés défavorables : il reste moins que ce qui a été versé */
    const pc = Math.round(d.final / d.versé * 100), pp = 100 - pc;
    el.innerHTML = `
      <div class="composition-titre"><span>Ce qu'il reste de vos versements</span><span><b>${fmt(d.versé)}</b> versés</span></div>
      <div class="segbar" role="img" aria-label="Sur vos versements : ${pc} % de capital restant, ${pp} % de moins-value">
        ${seg(pc, 'var(--serie-1)')}${seg(pp, 'var(--red)', '#0d1117')}
      </div>
      <div class="composition-legende">
        <span><i style="background:var(--serie-1)"></i>Capital final <b>${fmt(d.final)}</b></span>
        <span><i style="background:var(--red)"></i>Moins-value <b>− ${fmt(d.versé - d.final)}</b></span>
      </div>`;
  }
}

/* ── Calcul + rendu complet ──────────────────────────────── */
function computeAndRender() {
  const p       = getParams();
  const couple  = isCouple();
  const plafond = getPlafond();
  const auOpts  = getAuDelaOpts();
  const fiscOn  = document.getElementById('cb-fisc').checked;

  // Ajuster les phases si la durée a changé, re-rendre si des phases ont disparu
  if (adjustPhasesForDuration(p.duree)) renderPhases();
  adjustOverridesForDuration(p.duree);

  const opts = { plafond, ...auOpts };
  const d    = compute(p, vps, opts, phases, overrides);
  // Scénario de référence sans personnalisation — pour la courbe comparative et l'écart KPI
  const hasPerso = phases.length > 0 || nbOverrideYears() > 0;
  const dBase = hasPerso ? compute(p, vps, opts, [], {}) : null;
  const fisc  = computeFiscal(d, { couple });
  const complement = d.capAuDelaFinal || 0;

  /* Header */
  document.getElementById('header-sub').textContent =
    `Projection sur ${ans(p.duree)} avec intérêts composés mensuels`;

  /* KPI – Capital final (et, s'il y en a un, le total avec le complément hors PEA) */
  animateKpi('kpi-final', d.final, fmt);
  document.getElementById('kpi-final-sub').textContent = complement > 0
    ? `après ${ans(p.duree)} · ${fmt(d.final + complement)} avec le complément hors PEA`
    : `après ${ans(p.duree)} · ${fmtNb(d.mult, 2)} fois la mise`;

  /* KPI – Valeur réelle */
  const erosion = d.final > 0 ? Math.round((1 - d.reel / d.final) * 100) : 0;
  animateKpi('kpi-reel', d.reel, fmt);
  document.getElementById('kpi-reel-sub').textContent = erosion > 0
    ? `en euros d'aujourd'hui · −${erosion} % dus à l'inflation`
    : 'en euros d\'aujourd\'hui';

  /* KPI – Total versé */
  const mensF  = p.mensuel * Math.pow(1 + p.aug / 100, p.duree - 1);
  /* Ne sont annoncés que les versements ponctuels réellement comptés, et la
     hausse annuelle seulement si aucune phase de vie ne fixe les versements */
  const nbPonct = vps.filter(v => v.montant > 0 && (v.annee || 1) <= p.duree).length;
  let subVerse = `${p.duree * 12} mensualités`;
  if (p.apport > 0)                subVerse += ` + ${fmt(p.apport)} d'apport`;
  if (p.aug > 0 && !phases.length) subVerse += ` · de ${fmt(p.mensuel)} à ${fmt(mensF)}/mois`;
  if (nbPonct > 0)                 subVerse += ` + ${nbPonct} versement${nbPonct > 1 ? 's' : ''} ponctuel${nbPonct > 1 ? 's' : ''}`;
  /* Plafond atteint : les versements se sont arrêtés là, pas au bout des mensualités */
  if (d.plafondAn != null) {
    subVerse = d.plafondAn === 0 ? 'plafond atteint dès l\'apport' : `plafond atteint en année ${d.plafondAn}`;
    if (complement > 0) subVerse += ' · la suite va au complément';
  }
  animateKpi('kpi-verse', d.versé, fmt);
  document.getElementById('kpi-verse-sub').textContent = subVerse;

  /* KPI – Plus-value brute. Quand les marchés ont baissé, c'est une
     moins-value : elle s'affiche en négatif, pas comme un zéro. */
  const plusValue = d.final - d.versé;
  const pctMise = v => (d.versé > 0 ? `${signe(v)}${Math.round(Math.abs(v) / d.versé * 100)} % de la mise` : '—');
  animateKpi('kpi-brut', plusValue, fmt);
  document.getElementById('kpi-brut-sub').textContent = pctMise(plusValue);

  /* KPI – Plus-value nette : après les prélèvements sociaux du PEA, si la
     fiscalité est appliquée (une moins-value n'est pas imposée) */
  const gainNet = fiscOn && plusValue > 0 ? plusValue * (1 - PS_PEA) : plusValue;
  animateKpi('kpi-net', gainNet, fmt);
  ['kpi-brut', 'kpi-net'].forEach(id =>
    document.getElementById(id).closest('.kpi').classList.toggle('red', plusValue <= -0.5));
  document.getElementById('kpi-net-sub').textContent = fiscOn
    ? `après ${fmtTaux(PS_PEA * 100)} de prélèvements sociaux · ${pctMise(gainNet)}`
    : 'avant impôt — cochez « Fiscalité » plus bas';

  /* KPI – Frais ETF */
  const capBrut = d.final + d.fraisTot;
  animateKpi('kpi-frais', d.fraisTot, fmt);
  document.getElementById('kpi-frais-sub').textContent =
    `${fmtPct(capBrut > 0 ? d.fraisTot / capBrut * 100 : 0)} du capital brut de frais`;

  /* KPI – Multiplicateur */
  animateKpi('kpi-mult', d.mult, n => `× ${fmtNb(n, 2)}`);

  /* KPI – Économie vs CTO */
  animateKpi('kpi-economie', fisc.economiePEAvsCTO, fmt);
  document.getElementById('kpi-economie-sub').textContent = d.gain > 0
    ? `d'impôt en moins qu'un compte-titres · ${Math.round(fisc.economiePEAvsCTO / d.gain * 100)} % du gain`
    : 'pas de plus-value, pas d\'impôt';

  /* Badges delta */
  setDelta('delta-final',  d.final,    DEF.final);
  setDelta('delta-reel',   d.reel,     DEF.reel);
  setDelta('delta-verse',  d.versé,    DEF.versé);
  setDelta('delta-brut',   plusValue,  DEF.gain);
  setDelta('delta-net',    gainNet,    fiscOn ? DEF.gain * (1 - PS_PEA) : DEF.gain);
  setDelta('delta-frais',  d.fraisTot, DEF.fraisTot, true, true);
  setDelta('delta-mult',   d.mult,     DEF.mult, false);

  /* KPI — ce que changent les phases de vie et les réglages année/mois */
  document.getElementById('kpi-phases').hidden = !hasPerso;
  if (hasPerso) {
    const nbOv  = nbOverrideYears();
    const nbPh  = phases.length;
    const ecart = d.final - dBase.final;
    const tuile = document.getElementById('kpi-ecart-phases').closest('.kpi');
    /* La tuile compte ce qui est réellement en place : des phases de vie,
       ou — sans phase — les années réglées à la main (jamais « 0 phase »). */
    document.getElementById('kpi-nb-phases-lbl').textContent = nbPh ? 'Phases de vie' : 'Réglages fins';
    document.getElementById('kpi-nb-phases').textContent     = nbPh ? nbPh : ans(nbOv);
    document.getElementById('kpi-nb-phases-sub').textContent = !nbPh
      ? `réglé${nbOv > 1 ? 's' : ''} à la main, sur les ${p.duree} du plan`
      : nbOv ? `+ ${nbOv} année${nbOv > 1 ? 's' : ''} réglée${nbOv > 1 ? 's' : ''} à la main`
      : `phase${nbPh > 1 ? 's' : ''} de vie active${nbPh > 1 ? 's' : ''}`;
    document.getElementById('kpi-mens-moy').textContent = fmt(d.mensuelMoyen);
    document.getElementById('kpi-taux-moy').textContent = fmtPct(d.tauxMoyen);
    document.getElementById('kpi-ecart-phases').textContent = signe(ecart) + fmtAbs(ecart);
    document.getElementById('kpi-ecart-phases-sub').textContent =
      ecart >= 0 ? 'de plus qu\'avec des paramètres constants' : 'de moins qu\'avec des paramètres constants';
    tuile.classList.toggle('green', ecart >= 0.5);
    tuile.classList.toggle('red',   ecart <= -0.5);
  }

  /* Fiscalité PEA vs CTO */
  renderFisc(d.gain, d.final);

  /* Plafond widget */
  renderPlafond(d, plafond, couple, p);

  /* Au-delà du plafond */
  renderAuDela(d);

  /* Versements ponctuels : ceux qui tombent après la fin de la simulation */
  majVPHorsDuree(p.duree);

  /* Colonne tableau complément (header) */
  const thAude = document.getElementById('th-aude');
  if (thAude) thAude.style.display = complement > 0 ? '' : 'none';

  /* Graphiques */
  updateCharts(d, dBase, phases);
  renderComposition(d);

  /* Phase de rente */
  renderRente(d, p);

  /* Monte Carlo & backtest rejouent le plan régulier (sans phases, réglages
     fins ni versements ponctuels, plafond compris) : c'est lui leur référence. */
  const regulier = planRegulier(p, plafond);
  renderMC(p, regulier, plafond);
  renderBacktest(p, regulier, plafond);

  /* Phases — tableau année par année */
  renderYearTable(p);

  /* Personnalisation année/mois */
  renderAnnees(p);

  /* Tableau enrichi */
  _lastTableData = { d, phases: [...phases], vps: [...vps] };
  renderTable(d, phases, vps);

  /* Profils : lequel correspond encore aux réglages */
  majProfils(p);

  /* Sauvegarde automatique */
  saveParams();
}

const debouncedRender = debounce(computeAndRender, 150);

/* ── Sections dépliables ─────────────────────────────────── */
function setColl(id, ouvert) {
  const carte = document.getElementById(id);
  if (!carte) return;
  carte.classList.toggle('open', ouvert);
  const bouton = carte.querySelector('.coll-trigger');
  if (bouton) bouton.setAttribute('aria-expanded', String(ouvert));
  /* On retrouve la page comme on l'a laissée, sections comprises */
  try {
    localStorage.setItem(LS_SECTIONS, JSON.stringify(
      [...document.querySelectorAll('.coll-card.open')].map(c => c.id)));
  } catch (_) {}
}

function toggleColl(id) {
  setColl(id, !document.getElementById(id).classList.contains('open'));
}

function restaurerSections() {
  let ouvertes = null;
  try { ouvertes = JSON.parse(localStorage.getItem(LS_SECTIONS)); } catch (_) {}
  if (!Array.isArray(ouvertes)) return;   // première visite : l'état prévu par la page
  document.querySelectorAll('.coll-card').forEach(carte => {
    const ouvert = ouvertes.includes(carte.id);
    /* Sans animation : les sections ne se déplient pas sous les yeux au chargement */
    carte.classList.add('sans-anim');
    carte.classList.toggle('open', ouvert);
    carte.querySelector('.coll-trigger')?.setAttribute('aria-expanded', String(ouvert));
    requestAnimationFrame(() => requestAnimationFrame(() => carte.classList.remove('sans-anim')));
  });
}

/* ── Presets ─────────────────────────────────────────────── */
function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  applyParams({ ...DEFAULTS, ...p });
  computeAndRender();
}

/* Un profil reste marqué tant que les réglages lui correspondent, et cesse
   de l'être dès qu'on touche à un curseur : le bouton dit l'état réel. */
function majProfils(p) {
  document.querySelectorAll('.preset-btn[data-preset]').forEach(btn => {
    const cible = { ...DEFAULTS, ...PRESETS[btn.dataset.preset] };
    const actif = Object.keys(cible).every(k => p[k] === cible[k]);
    btn.classList.toggle('active', actif);
    btn.setAttribute('aria-pressed', String(actif));
  });
  const btnReel = document.getElementById('btn-pea-reel');
  if (btnReel) {
    const actif = !!_peaReel && p.apport === _peaReel.apport && p.mensuel === _peaReel.mensuel;
    btnReel.classList.toggle('active', actif);
    btnReel.setAttribute('aria-pressed', String(actif));
  }
}

/* ── Partir de mon PEA réel ──────────────────────────────────
   Lit les données du tracker (même origine → même localStorage) :
   apport initial = valeur actuelle du portefeuille,
   versement mensuel = moyenne des achats des 12 derniers mois. */
function applyPEAReel() {
  const note = document.getElementById('pea-reel-note');
  const show = html => { if (note) { note.innerHTML = html; note.style.display = ''; } };

  let data = null;
  try { data = JSON.parse(localStorage.getItem('pea_tracker_data')); } catch (_) {}
  const ops   = data && Array.isArray(data.operations) ? data.operations : [];
  const cours = (data && data.cours_actuels) || {};

  const achats = ops.filter(o => o.type === 'achat' && o.etf_isin);
  if (!achats.length) {
    show('<strong>Tracker vide</strong> — aucun achat enregistré. ' +
         'Saisissez vos opérations dans le <a href="../tracker/index.html">Tracker</a> ' +
         '(dans ce même navigateur), puis revenez ici.');
    return;
  }

  /* Valeur actuelle : quantités nettes × dernier cours connu (sinon coût résiduel) */
  const pos = {}; // isin -> { qte, cout }
  for (const op of ops) {
    if (!op.etf_isin || (op.type !== 'achat' && op.type !== 'vente')) continue;
    const p = pos[op.etf_isin] || (pos[op.etf_isin] = { qte: 0, cout: 0 });
    if (op.type === 'achat') {
      p.qte  += op.quantite || 0;
      p.cout += (op.montant_total || 0) - (op.frais || 0);
    } else {
      const ratio = p.qte > 0 ? (op.quantite || 0) / p.qte : 0;
      p.cout -= p.cout * ratio;
      p.qte  -= op.quantite || 0;
    }
  }
  let valeur = 0, sansCours = false;
  for (const [isin, p] of Object.entries(pos)) {
    if (p.qte <= 0.000001) continue;
    const c = cours[isin] && cours[isin].cours;
    if (c) { valeur += p.qte * c; } else { valeur += p.cout; sansCours = true; }
  }

  /* Rythme : moyenne mensuelle des achats sur 12 mois glissants
     (ou depuis le 1er achat si l'historique est plus court) */
  const seuil       = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const investi12m  = achats.filter(o => o.date >= seuil)
                            .reduce((s, o) => s + (o.montant_total || 0), 0);
  const premier     = achats.map(o => o.date).sort()[0];
  const moisHist    = Math.max(1, Math.min(12,
    Math.ceil((Date.now() - new Date(premier).getTime()) / (30.44 * 86400000))));
  const mensuel     = Math.round(investi12m / moisHist);

  applyParams({ apport: Math.round(valeur), mensuel });
  /* Les curseurs ont des bornes : on retient — et on annonce — ce qui a réellement été appliqué */
  const applique = getParams();
  _peaReel = { apport: applique.apport, mensuel: applique.mensuel };
  computeAndRender();

  const borne = applique.apport !== Math.round(valeur) || applique.mensuel !== mensuel
    ? ' Valeurs ramenées dans les bornes des curseurs.' : '';
  show(`<strong>Paramètres repris de votre PEA réel</strong> — apport initial : ${fmt(applique.apport)} ` +
       `(valeur actuelle du portefeuille${sansCours ? ' ; cours manquants remplacés par le coût d\'achat' : ''}), ` +
       `versement : ${fmt(applique.mensuel)}/mois (${moisHist > 1 ? `moyenne des ${moisHist} derniers mois` : 'achats du dernier mois'}).${borne} ` +
       `Durée, rendement et autres paramètres restent inchangés.`);
}

/* ── Bulles d'aide ───────────────────────────────────────── */
function fermerBulles() {
  document.querySelectorAll('.tt-box.visible').forEach(box => {
    box.classList.remove('visible');
    box.previousElementSibling.setAttribute('aria-expanded', 'false');
  });
}

function initTooltips() {
  document.querySelectorAll('.tt-btn').forEach((btn, i) => {
    const box = btn.nextElementSibling;
    /* Le texte de la bulle sert aussi de description au bouton (lecteurs d'écran) */
    box.id = `aide-${i + 1}`;
    box.setAttribute('role', 'tooltip');
    btn.setAttribute('aria-describedby', box.id);
    btn.setAttribute('aria-expanded', 'false');

    /* Près d'un bord d'écran (téléphone), la bulle centrée sur le bouton
       déborderait : on la décale juste assez pour qu'elle reste entière. */
    const caler = () => {
      const centre = btn.getBoundingClientRect().left + btn.offsetWidth / 2;
      const demi   = box.offsetWidth / 2, marge = 8;
      const gauche = clamp(centre - demi, marge, Math.max(marge, document.documentElement.clientWidth - 2 * demi - marge));
      box.style.setProperty('--tt-dx', `${Math.round(gauche - (centre - demi))}px`);
    };
    btn.addEventListener('pointerenter', caler);
    btn.addEventListener('focus', caler);

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const ouvert = box.classList.contains('visible');
      fermerBulles();
      if (!ouvert) { caler(); box.classList.add('visible'); btn.setAttribute('aria-expanded', 'true'); }
    });
  });
  document.addEventListener('click', fermerBulles);
}

/* ── Initialisation ──────────────────────────────────────── */
function init() {
  initCharts();
  restaurerSections();

  ['mensuel', 'taux', 'duree', 'apport', 'inflation', 'frais', 'aug'].forEach(wire);

  /* Sections dépliables */
  document.querySelectorAll('.coll-trigger[data-coll]').forEach(btn =>
    btn.addEventListener('click', () => toggleColl(btn.dataset.coll)));

  /* Fiscalité PEA */
  document.getElementById('cb-fisc').addEventListener('change', computeAndRender);

  /* Plafond : couple */
  document.getElementById('cb-couple').addEventListener('change', computeAndRender);

  /* Au-delà : activation + paramètres */
  document.getElementById('cb-aude').addEventListener('change', () => {
    const enabled = document.getElementById('cb-aude').checked;
    document.getElementById('aude-params').className =
      enabled ? 'aude-params-visible' : 'aude-params-hidden';
    computeAndRender();
  });
  document.getElementById('aude-enveloppe').addEventListener('change',  computeAndRender);
  document.getElementById('n-taux-aude').addEventListener('input',   debouncedRender);
  document.getElementById('n-frais-aude').addEventListener('input',  debouncedRender);
  document.getElementById('n-taux-aude').addEventListener('change',  computeAndRender);
  document.getElementById('n-frais-aude').addEventListener('change', computeAndRender);

  /* Phase de rente : activation + paramètres */
  document.getElementById('cb-rente').addEventListener('change', () => {
    document.getElementById('rente-params').className =
      document.getElementById('cb-rente').checked ? 'aude-params-visible' : 'aude-params-hidden';
    computeAndRender();
  });
  document.getElementById('cb-rente-index').addEventListener('change', computeAndRender);
  document.getElementById('n-rente').addEventListener('input',       debouncedRender);
  document.getElementById('n-taux-rente').addEventListener('input',  debouncedRender);
  document.getElementById('n-rente').addEventListener('change',      computeAndRender);
  document.getElementById('n-taux-rente').addEventListener('change', computeAndRender);

  /* Monte Carlo : activation + paramètres */
  document.getElementById('cb-mc').addEventListener('change', () => {
    document.getElementById('mc-params').className =
      document.getElementById('cb-mc').checked ? 'aude-params-visible' : 'aude-params-hidden';
    computeAndRender();
  });
  document.getElementById('n-runs-mc').addEventListener('change', computeAndRender);
  ['n-vol-mc', 'n-objectif-mc'].forEach(id => {
    document.getElementById(id).addEventListener('input',  debouncedRender);
    document.getElementById(id).addEventListener('change', computeAndRender);
  });

  /* Backtest : années disponibles + départs célèbres + tracé */
  const btSel = document.getElementById('bt-annee');
  btSel.innerHTML = HISTO_MSCI_WORLD.map(h =>
    `<option value="${h.annee}">${h.annee}</option>`).join('');
  btSel.value = '2000';
  btSel.addEventListener('change', computeAndRender);
  document.querySelectorAll('.bt-preset').forEach(b =>
    b.addEventListener('click', () => { btSel.value = b.dataset.annee; computeAndRender(); }));
  document.getElementById('bt-results').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'bt-trace') {
      /* Une seule courbe superposée à la fois : elle remplace celle d'un scénario comparé */
      if (_compareId != null) { _compareId = null; renderScenariosList(); }
      _btLigneTracee = true;
      computeAndRender();
      document.getElementById('carte-croissance')
        .scrollIntoView({ behavior: SANS_ANIMATION ? 'auto' : 'smooth', block: 'center' });
    } else if (btn.dataset.action === 'bt-clear') {
      _btLigneTracee = false;
      removeComparisonLine();
      computeAndRender();
    } else {
      return;
    }
    /* Les boutons viennent d'être redessinés : le clavier garde sa place */
    document.querySelector('#bt-results [data-action="bt-trace"]')?.focus({ preventScroll: true });
  });

  /* Versements ponctuels */
  document.getElementById('vp-list').addEventListener('change', e => {
    const row = e.target.closest('[data-id]'); if (!row) return;
    const v   = vps.find(x => x.id === +row.dataset.id); if (!v) return;
    const t   = e.target;
    if (t.classList.contains('vp-lbl')) { v.libelle = t.value; saveParams(); return; }
    if (t.classList.contains('vp-yr'))  { v.annee   = Math.max(1, Math.round(+t.value) || 1); t.value = v.annee; }
    if (t.classList.contains('vp-amt')) { v.montant = Math.max(0, +t.value || 0);            t.value = v.montant; }
    if (t.classList.contains('vp-rec')) {
      v.recurrent = t.checked;
      const lbl = row.querySelector('.lbl-yr');
      if (lbl) lbl.textContent = v.recurrent ? "Dès l'an" : 'Année';
    }
    computeAndRender();
  });
  document.getElementById('vp-list').addEventListener('click', e => {
    const btn = e.target.closest('.vp-btn-del'); if (!btn) return;
    const row = btn.closest('[data-id]'); if (!row) return;
    vps = vps.filter(x => x.id !== +row.dataset.id);
    renderVP(); computeAndRender();
    document.getElementById('btn-vp-add').focus();
  });
  document.getElementById('btn-vp-add').addEventListener('click', () => {
    vps.push({ id: ++vpId, annee: 1, montant: 1000, libelle: '', recurrent: false });
    setColl('coll-vp', true);
    renderVP(); computeAndRender();
    document.querySelector('#vp-list .vp-row:last-child .vp-yr')?.focus();
  });

  /* Presets */
  document.querySelectorAll('.preset-btn[data-preset]').forEach(btn =>
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));

  /* Partir de mon PEA réel (données du tracker) */
  document.getElementById('btn-pea-reel')?.addEventListener('click', applyPEAReel);

  /* Réinitialiser */
  document.getElementById('btn-reset').addEventListener('click', async () => {
    /* Phases, versements ponctuels et réglages fins sont longs à refaire :
       on demande avant de les effacer. Les curseurs seuls, non. */
    if (vps.length + phases.length + nbOverrideYears() > 0 && !await confirmer({
      titre: 'Tout réinitialiser ?',
      message: 'Les paramètres reviennent à leurs valeurs par défaut ; vos versements ponctuels, phases de vie et réglages année par année sont effacés. Vos scénarios sauvegardés sont conservés.',
      ok: 'Réinitialiser', danger: true,
    })) return;

    applyParams(DEFAULTS);
    document.getElementById('cb-fisc').checked   = false;
    document.getElementById('cb-couple').checked = false;
    document.getElementById('cb-aude').checked   = false;
    document.getElementById('aude-params').className = 'aude-params-hidden';
    document.getElementById('cb-rente').checked  = false;
    document.getElementById('rente-params').className = 'aude-params-hidden';
    document.getElementById('cb-mc').checked = false;
    document.getElementById('mc-params').className = 'aude-params-hidden';
    if (_btLigneTracee) { _btLigneTracee = false; removeComparisonLine(); }
    stopCompare();
    vps = []; renderVP();
    phases = []; editingPhaseId = null;
    overrides = {}; expandedYears.clear();
    _peaReel = null;
    const explainEl = document.getElementById('scenario-explain');
    if (explainEl) explainEl.style.display = 'none';
    const peaReelNote = document.getElementById('pea-reel-note');
    if (peaReelNote) peaReelNote.style.display = 'none';
    renderPhases();
    computeAndRender();
  });

  /* ── Phases de vie : délégation sur la liste ────────────── */
  const phasesList = document.getElementById('phases-list');
  const actionPhase = (card, action) => {
    const id = +card.dataset.id;

    if (action === 'edit') {
      editingPhaseId = (editingPhaseId === id) ? null : id;
      renderPhases();
      if (editingPhaseId === id) phasesList.querySelector(`.phase-card[data-id="${id}"] .ph-lbl`)?.focus();
      else phasesList.querySelector(`.phase-card[data-id="${id}"] [data-action="edit"]`)?.focus();

    } else if (action === 'cancel') {
      editingPhaseId = null;
      renderPhases();
      phasesList.querySelector(`.phase-card[data-id="${id}"] [data-action="edit"]`)?.focus();

    } else if (action === 'del') {
      phases = phases.filter(p => p.id !== id);
      if (editingPhaseId === id) editingPhaseId = null;
      renderPhases();
      computeAndRender();
      document.getElementById('btn-phase-add').focus();

    } else if (action === 'save') {
      const duree   = getParams().duree;
      const lbl     = card.querySelector('.ph-lbl')?.value.trim()    || '';
      const start   = Math.round(+card.querySelector('.ph-start')?.value);
      const end     = Math.round(+card.querySelector('.ph-end')?.value);
      const mensuel = +card.querySelector('.ph-mensuel')?.value;
      const taux    = +card.querySelector('.ph-taux')?.value;
      const errEl   = card.querySelector('.phase-edit-error');
      const erreur  = msg => { if (errEl) errEl.textContent = msg; };

      if (!start || !end || start > end) return erreur('L\'année de début doit précéder l\'année de fin');
      if (start < 1 || end > duree)      return erreur(`Les années vont de 1 à ${duree}`);
      if (!(mensuel >= 0))               return erreur('Le versement ne peut pas être négatif');
      if (!(taux >= -50 && taux <= 50))  return erreur('Le rendement doit rester entre −50 % et +50 %');

      const ph = phases.find(p => p.id === id);
      if (ph) {
        ph.label      = lbl;
        ph.anneeDebut = start;
        ph.anneeFin   = end;
        ph.mensuel    = mensuel;
        ph.taux       = taux;
      }
      editingPhaseId = null;
      renderPhases();
      computeAndRender();
      phasesList.querySelector(`.phase-card[data-id="${id}"] [data-action="edit"]`)?.focus();
    }
  };
  phasesList.addEventListener('click', e => {
    const card   = e.target.closest('.phase-card');
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (card && action) actionPhase(card, action);
  });
  /* Dans le formulaire d'une phase : Entrée enregistre, Échap annule */
  phasesList.addEventListener('keydown', e => {
    const card = e.target.closest('.phase-card');
    if (!card || e.target.tagName !== 'INPUT') return;
    if (e.key === 'Enter')  { e.preventDefault(); actionPhase(card, 'save'); }
    if (e.key === 'Escape') { e.preventDefault(); actionPhase(card, 'cancel'); }
  });

  /* ── Ajouter une phase ───────────────────────────────────── */
  document.getElementById('btn-phase-add').addEventListener('click', () => {
    const p     = getParams();
    const duree = p.duree;
    // Chercher la première année non encore couverte par une phase
    const used  = new Set(phases.flatMap(ph =>
      Array.from({ length: ph.anneeFin - ph.anneeDebut + 1 }, (_, j) => ph.anneeDebut + j),
    ));
    let start = 1;
    while (start <= duree && used.has(start)) start++;
    /* Toutes les années sont déjà couvertes : la nouvelle phase se place à la
       fin (elle chevauchera, l'avertissement le dira) plutôt qu'après la durée. */
    start = Math.min(start, duree);
    const end = Math.min(start + 4, duree);

    const newPh = { id: ++phaseId, label: '', anneeDebut: start, anneeFin: end, mensuel: p.mensuel, taux: p.taux };
    phases.push(newPh);
    editingPhaseId = newPh.id;  // ouvrir directement le formulaire d'édition
    setColl('coll-phases', true);
    renderPhases();
    computeAndRender();
    phasesList.querySelector(`.phase-card[data-id="${newPh.id}"] .ph-lbl`)?.focus();
  });

  /* ── Bascule tableau année par année ─────────────────────── */
  document.getElementById('btn-year-view').addEventListener('click', () => {
    showYearView = !showYearView;
    renderYearTable(getParams());
  });

  /* ── Personnalisation année/mois ─────────────────────────── */
  const anneesTable = document.getElementById('annees-table');
  if (anneesTable) {
    anneesTable.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]'); if (!btn) return;
      const row = btn.closest('[data-an]');          if (!row) return;
      const an  = +row.dataset.an;
      if (btn.dataset.action === 'expand') {
        if (expandedYears.has(an)) expandedYears.delete(an);
        else expandedYears.add(an);
        renderAnnees(getParams());
      } else if (btn.dataset.action === 'clear') {
        delete overrides[an];
        computeAndRender();
      }
    });

    anneesTable.addEventListener('change', e => {
      const row = e.target.closest('[data-an]'); if (!row) return;
      const an  = +row.dataset.an;
      const t   = e.target;
      const p    = getParams();
      const base = baseParamsForYear(p, an);
      const num  = t.value === '' ? null : +t.value;

      if (t.classList.contains('an-mens')) {
        setYearOverride(an, 'mensuel', num != null && num !== base.mensuel ? Math.max(0, num) : null);
      } else if (t.classList.contains('an-taux')) {
        setYearOverride(an, 'taux', num != null && num !== base.taux ? clamp(num, -50, 50) : null);
      } else if (t.classList.contains('m-vers')) {
        setMonthOverride(an, +t.dataset.mois, 'versement', num != null ? Math.max(0, num) : null);
      } else if (t.classList.contains('m-taux')) {
        setMonthOverride(an, +t.dataset.mois, 'taux', num != null ? clamp(num, -99, 200) : null);
      } else {
        return;
      }
      computeAndRender();
      /* La saisie est validée : la table peut se redessiner (pastilles, champs
         surlignés). On attend que le focus ait rejoint le champ suivant — après
         Tab, il est encore sur celui-ci — pour le lui rendre au bon endroit. */
      setTimeout(() => renderAnnees(getParams(), true), 0);
    });
  }

  const btnAnneesReset = document.getElementById('btn-annees-reset');
  if (btnAnneesReset) {
    btnAnneesReset.addEventListener('click', async () => {
      const oui = await confirmer({
        titre: 'Effacer les réglages année par année ?',
        message: 'Toutes les valeurs saisies à la main, année par année et mois par mois, reviennent aux paramètres hérités.',
        ok: 'Effacer', danger: true,
      });
      if (!oui) return;
      overrides = {};
      expandedYears.clear();
      computeAndRender();
    });
  }

  /* ── Dropdown scénarios ──────────────────────────────────── */
  const btnScenario  = document.getElementById('btn-scenario');
  const menuScenario = document.getElementById('scenario-menu');
  /* Le menu s'aligne sur la gauche de son bouton. Quand celui-ci est en bout
     de rangée, le menu sortirait de l'écran : il s'aligne alors sur la
     droite du bouton — et, sur un écran trop étroit pour cela aussi, se
     cale contre la marge. */
  const calerMenu = () => {
    menuScenario.style.left = '0px';
    const r = menuScenario.getBoundingClientRect(), marge = 8;
    if (r.right <= document.documentElement.clientWidth - marge) return;
    const versLaDroite = btnScenario.offsetWidth - r.width;   // négatif : le menu est plus large que le bouton
    menuScenario.style.left = `${Math.max(versLaDroite, marge - r.left)}px`;
  };
  const ouvrirMenu = ouvert => {
    menuScenario.classList.toggle('open', ouvert);
    btnScenario.setAttribute('aria-expanded', String(ouvert));
    if (ouvert) calerMenu();
  };
  btnScenario.addEventListener('click', e => {
    e.stopPropagation();
    const ouvrir = !menuScenario.classList.contains('open');
    ouvrirMenu(ouvrir);
    /* Ouvert au clavier (Entrée, Espace) : le focus entre dans le menu */
    if (ouvrir && e.detail === 0) menuScenario.querySelector('button')?.focus();
  });
  window.addEventListener('resize', () => { if (menuScenario.classList.contains('open')) calerMenu(); });
  /* Flèches haut/bas pour parcourir le menu, comme dans un menu natif */
  menuScenario.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menuScenario.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
    items[(i + items.length) % items.length].focus();
  });
  btnScenario.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    ouvrirMenu(true);
    menuScenario.querySelector('button')?.focus();
  });

  document.querySelectorAll('.scenario-item').forEach(item =>
    item.addEventListener('click', () => {
      applyScenario(item.dataset.key);
      ouvrirMenu(false);
    }),
  );

  document.getElementById('btn-scenario-reset').addEventListener('click', () => {
    phases = []; editingPhaseId = null;
    const explainEl = document.getElementById('scenario-explain');
    if (explainEl) explainEl.style.display = 'none';
    ouvrirMenu(false);
    renderPhases();
    computeAndRender();
  });

  // Fermer le menu si clic en dehors
  document.addEventListener('click', () => ouvrirMenu(false));

  /* Échap referme le menu des scénarios et les bulles d'aide */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (menuScenario.classList.contains('open')) { ouvrirMenu(false); btnScenario.focus(); }
    fermerBulles();
  });

  /* ── Tableau : tri par colonne (souris ou clavier) ───────────
     Un clic trie par ordre croissant, le suivant décroissant, le troisième
     revient à l'ordre des années. */
  const tblThead = document.querySelector('#table-annees thead');
  if (tblThead) {
    const colonnes = tblThead.querySelectorAll('th[data-col]');
    colonnes.forEach(th => { th.tabIndex = 0; th.setAttribute('aria-sort', 'none'); });

    const trier = th => {
      const col = th.dataset.col;
      if (_tableSort.col !== col)          _tableSort = { col, dir: 'asc' };
      else if (_tableSort.dir === 'asc')   _tableSort.dir = 'desc';
      else                                 _tableSort = { col: null, dir: 'asc' };
      colonnes.forEach(c => {
        const actif = c.dataset.col === _tableSort.col;
        c.setAttribute('aria-sort', !actif ? 'none' : _tableSort.dir === 'asc' ? 'ascending' : 'descending');
        const icon = c.querySelector('.th-sort-icon');
        if (icon) icon.textContent = !actif ? '' : _tableSort.dir === 'asc' ? ' ▲' : ' ▼';
      });
      if (_lastTableData) renderTable(_lastTableData.d, _lastTableData.phases, _lastTableData.vps);
    };
    tblThead.addEventListener('click', e => {
      const th = e.target.closest('th[data-col]');
      if (th) trier(th);
    });
    tblThead.addEventListener('keydown', e => {
      const th = e.target.closest('th[data-col]');
      if (!th || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      trier(th);
    });
  }

  /* ── Tableau : filtre ────────────────────────────────────── */
  const filterInput = document.getElementById('table-filter');
  if (filterInput) {
    filterInput.addEventListener('input', e => {
      _tableFilter = e.target.value.trim();
      if (_lastTableData) renderTable(_lastTableData.d, _lastTableData.phases, _lastTableData.vps);
    });
  }

  /* ── Scénarios sauvegardés ───────────────────────────────── */
  const btnSave = document.getElementById('btn-save-scenario');
  if (btnSave) btnSave.addEventListener('click', saveScenario);

  const scenariosList = document.getElementById('scenarios-list');
  if (scenariosList) {
    scenariosList.addEventListener('click', e => {
      const card   = e.target.closest('.scenario-save-card');
      if (!card) return;
      const id     = +card.dataset.id;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'load')      loadScenario(id);
      if (action === 'rename')    renameScenario(id);
      if (action === 'compare')   startCompare(id);
      if (action === 'uncompare') stopCompare();
      if (action === 'del')       deleteScenario(id);
    });
  }

  initTooltips();
  loadParams();
  updateCtrlValues();
  renderVP();
  renderPhases();
  renderScenariosList();
  computeAndRender();
}

document.addEventListener('DOMContentLoaded', init);
