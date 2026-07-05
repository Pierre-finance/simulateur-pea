'use strict';

/* ─────────────────────────────────────────────────────────────
   ui.js — Gestion de l'interface : sliders, événements, rendu
   Dépendances : simulation.js, charts.js
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
const MAX_SCENARIOS = 20;

/* ── Tableau enrichi ─────────────────────────────────────── */
let _tableSort     = { col: null, dir: 'asc' };
let _tableFilter   = '';
let _lastTableData = null;

/* ── Scénarios sauvegardés ───────────────────────────────── */
let _compareScenarioData = null; // { nom, totL, yrs, d } | null

/* ── Animation des KPI ───────────────────────────────────── */
const _kpiPrev = {};
const _kpiRaf  = {};

function animateKpi(id, toVal, fmtFn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (_kpiRaf[id]) cancelAnimationFrame(_kpiRaf[id]);
  const fromVal = _kpiPrev[id] !== undefined ? _kpiPrev[id] : toVal;
  _kpiPrev[id]  = toVal;
  if (Math.abs(toVal - fromVal) < 0.5) { el.textContent = fmtFn(toVal); return; }
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

/* ── Slider ──────────────────────────────────────────────── */
function fillSlider(sl) {
  const pct = ((+sl.value - +sl.min) / (+sl.max - +sl.min)) * 100;
  sl.style.background = `linear-gradient(to right, var(--accent) ${pct}%, #21262d ${pct}%)`;
}

function wire(sId, nId) {
  const sl = document.getElementById(sId);
  const nu = document.getElementById(nId);
  fillSlider(sl);
  sl.addEventListener('input', () => {
    nu.value = sl.value; fillSlider(sl);
    updateCtrlValues(); debouncedRender();
  });
  nu.addEventListener('input', () => {
    const v = clamp(+nu.value || 0, +sl.min, +sl.max);
    sl.value = v; fillSlider(sl);
    updateCtrlValues(); debouncedRender();
  });
  nu.addEventListener('change', () => {
    const v = clamp(+nu.value || 0, +sl.min, +sl.max);
    nu.value = v; sl.value = v; fillSlider(sl);
    updateCtrlValues(); debouncedRender();
  });
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ── Lecture des paramètres ──────────────────────────────── */
function getParams() {
  return {
    mensuel:   +document.getElementById('n-mensuel').value,
    taux:      +document.getElementById('n-taux').value,
    duree:     +document.getElementById('n-duree').value,
    apport:    +document.getElementById('n-apport').value,
    inflation: +document.getElementById('n-inflation').value,
    frais:     +document.getElementById('n-frais').value,
    aug:       +document.getElementById('n-aug').value,
  };
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

/* ── Mise à jour immédiate des ctrl-values ───────────────── */
function updateCtrlValues() {
  const p = getParams();
  document.getElementById('cv-mensuel').textContent   = p.mensuel + ' €';
  document.getElementById('cv-taux').textContent      = p.taux + ' %';
  document.getElementById('cv-duree').textContent     = p.duree + ' an' + (p.duree > 1 ? 's' : '');
  document.getElementById('cv-apport').textContent    = fmt(p.apport);
  document.getElementById('cv-inflation').textContent = p.inflation + ' %';
  document.getElementById('cv-frais').textContent     = p.frais + ' %';
  document.getElementById('cv-aug').textContent       = p.aug + ' %';

  // Rendement net : frais déduits, puis inflation déduite (approche multiplicative)
  const netHint = document.getElementById('taux-net-hint');
  if (netHint) {
    const netFrais = (1 + p.taux / 100) * (1 - p.frais / 100) - 1;
    const netReel  = (1 + netFrais) / (1 + p.inflation / 100) - 1;
    netHint.innerHTML =
      `net de frais : <strong>${(netFrais * 100).toFixed(2)} %</strong>` +
      ` · net d'inflation : <strong>${(netReel * 100).toFixed(2)} %</strong>`;
  }
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
  } catch (_) {}
}

/* ── Badge delta ─────────────────────────────────────────── */
function setDelta(id, cur, ref, isCur = true, invert = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const d = cur - ref;
  if (Math.abs(d) < (isCur ? 0.5 : 0.001)) {
    el.textContent = ''; el.className = 'kpi-delta'; return;
  }
  if (isCur) {
    const sign   = d > 0 ? '+' : '−';
    const pct    = ref !== 0 ? Math.round(Math.abs(d / ref) * 100) : null;
    const pctStr = pct != null ? ` (${d > 0 ? '+' : '−'}${pct} %)` : '';
    el.textContent = sign + fmtAbs(d) + pctStr;
  } else {
    el.textContent = (d > 0 ? '+' : '') + d.toFixed(2) + '×';
  }
  const good = invert ? d < 0 : d > 0;
  el.className = 'kpi-delta ' + (good ? 'pos' : 'neg');
}

/* ── Versements ponctuels ────────────────────────────────── */
function renderVP() {
  const duree = +document.getElementById('n-duree').value || 20;
  const list  = document.getElementById('vp-list');
  const badge = document.getElementById('vp-count');
  if (!vps.length) {
    list.innerHTML = `<p class="vp-empty">Aucun versement ponctuel. Ajoutez une prime, un bonus ou un héritage prévu.</p>`;
    badge.textContent = ''; badge.classList.remove('show');
    return;
  }
  list.innerHTML = vps.map(v => `
    <div class="vp-row" data-id="${v.id}">
      <div class="vp-field">
        <label class="lbl-yr">${v.recurrent ? "Dès l'an" : 'Année'}</label>
        <input class="vp-input vp-input-yr vp-yr" type="number" min="1" max="${duree}" value="${Math.min(v.annee, duree)}">
      </div>
      <div class="vp-field">
        <label>Montant (€)</label>
        <input class="vp-input vp-input-amt vp-amt" type="number" min="0" step="100" value="${v.montant}">
      </div>
      <div class="vp-field" style="flex:1;min-width:110px">
        <label>Libellé</label>
        <input class="vp-input vp-input-lbl vp-lbl" type="text" placeholder="Prime, bonus, héritage…" value="${escHtml(v.libelle)}" style="width:100%">
      </div>
      <div class="vp-check-col">
        <label>Récurrent</label>
        <input class="cb-custom vp-rec" type="checkbox" ${v.recurrent ? 'checked' : ''}>
      </div>
      <button class="vp-btn-del" title="Supprimer">✕</button>
    </div>`).join('');
  badge.textContent = vps.length;
  badge.classList.add('show');
}

/* ── Fiscalité PEA vs CTO ────────────────────────────────── */
function renderFisc(gain, final) {
  const div   = document.getElementById('fisc-details');
  const badge = document.getElementById('fisc-badge');
  const on    = document.getElementById('cb-fisc').checked;
  badge.textContent = on ? 'PEA' : '';
  badge.classList.toggle('show', on);
  if (!on || gain <= 0) { div.innerHTML = ''; return; }
  const psPS   = gain * 0.172,  netPEA = final - psPS;
  const flat   = gain * 0.30,   netCTO = final - flat;
  const avt    = netPEA - netCTO;
  div.innerHTML = `
    <div class="fisc-comparison">
      <div class="fisc-box">
        <div class="fisc-box-title"><span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block"></span> PEA — sortie après 5 ans</div>
        <div class="fisc-line"><span class="fisc-lbl">Plus-value brute</span><span>${fmt(gain)}</span></div>
        <div class="fisc-line"><span class="fisc-lbl">Prélèvements sociaux 17.2 %</span><span class="fisc-neg">− ${fmt(psPS)}</span></div>
        <div class="fisc-line fisc-line-total"><span class="fisc-lbl">Capital net</span><span class="fisc-pos">${fmt(netPEA)}</span></div>
      </div>
      <div class="fisc-box">
        <div class="fisc-box-title"><span style="width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block"></span> CTO — Flat tax 30 % (PFU)</div>
        <div class="fisc-line"><span class="fisc-lbl">Plus-value brute</span><span>${fmt(gain)}</span></div>
        <div class="fisc-line"><span class="fisc-lbl">Impôt PFU 30 %</span><span class="fisc-neg">− ${fmt(flat)}</span></div>
        <div class="fisc-line fisc-line-total"><span class="fisc-lbl">Capital net</span><span>${fmt(netCTO)}</span></div>
      </div>
      <div class="fisc-avantage">Avantage fiscal PEA vs CTO : <strong>+ ${fmt(avt)}</strong></div>
    </div>`;
}

/* ── Plafond widget ──────────────────────────────────────── */
function renderPlafond(d, plafond, couple) {
  const versNets = d.versNets || 0;
  const pct      = Math.min(100, versNets / plafond * 100);

  // Barre de progression
  const fill = document.getElementById('plafond-fill');
  fill.style.width = pct + '%';
  fill.className = 'plafond-fill' + (pct >= 100 ? ' full' : pct >= 80 ? ' warn' : '');

  document.getElementById('plafond-verse-lbl').textContent = fmt(versNets);
  document.getElementById('plafond-pct-lbl').textContent   = pct.toFixed(1) + ' %';
  document.getElementById('plafond-max-lbl').textContent   = fmt(plafond);

  // Badge statut
  const badge = document.getElementById('plafond-badge');
  if (d.plafondAn != null) {
    badge.textContent = d.plafondAn === 0 ? 'Plafond atteint (départ)' : `Atteint an ${d.plafondAn}`;
    badge.className   = 'plafond-status-badge warn-badge';
  } else if (pct >= 80) {
    badge.textContent = `${pct.toFixed(0)} % — bientôt atteint`;
    badge.className   = 'plafond-status-badge warn-badge';
  } else {
    badge.textContent = `${pct.toFixed(0)} % utilisé`;
    badge.className   = 'plafond-status-badge ok-badge';
  }

  // Message contextuel
  const info = document.getElementById('plafond-info');
  if (d.plafondAn != null) {
    const anTxt = d.plafondAn === 0 ? 'dès l\'apport initial' : `en année ${d.plafondAn}`;
    const conseil = document.getElementById('cb-aude').checked
      ? 'Le surplus est automatiquement redirigé vers votre enveloppe complémentaire.'
      : 'Pensez à activer la section « Au-delà du plafond » pour continuer à capitaliser.';
    info.innerHTML = `⚠ Plafond atteint ${anTxt}. ${conseil}`;
    info.className = 'plafond-info warn';
  } else {
    const restant = plafond - versNets;
    const coupleHint = !couple
      ? ' · En couple, vous pouvez doubler ce plafond à 300 000 €.'
      : '';
    info.innerHTML = `Il vous reste <strong>${fmt(restant)}</strong> de capacité de versement PEA sur la durée simulée.${coupleHint}`;
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
  if (!enabled || (d.capAuDelaFinal || 0) <= 0 || (d.gainAuDela || 0) <= 0) {
    fiscalDiv.innerHTML = '';
    return;
  }

  const couple = isCouple();
  const fisc   = computeFiscal(d, { couple });

  // Tableau comparatif : 3 enveloppes pour le complément
  const envs = [
    { name: 'CTO — Flat tax 30 %',                           color: '#8b949e', impot: fisc.impotCTO,    net: fisc.netCTO_ade    },
    { name: `AV >8 ans (abat. ${fmt(fisc.abattement)})`,     color: '#a371f7', impot: fisc.impotAV,     net: fisc.netAV_ade     },
    { name: 'PEA-PME — PS 17.2 %',                           color: '#3fb950', impot: fisc.impotPEAPME, net: fisc.netPEAPME_ade },
  ];

  const refNet  = fisc.netCTO_ade;
  const bestNet = Math.max(...envs.map(e => e.net));

  const rows = envs.map(e => {
    const ecart  = e.net - refNet;
    const isBest = e.net === bestNet;
    return `
      <tr class="${isBest ? 'ft-best' : ''}">
        <td><span class="ft-env"><span class="ft-dot" style="background:${e.color}"></span>${e.name}</span></td>
        <td>${fmt(fisc.capAuDela)}</td>
        <td>${fmt(fisc.gainAuDela)}</td>
        <td class="ft-neg">− ${fmt(e.impot)}</td>
        <td class="ft-pos">${fmt(e.net)}</td>
        <td class="${ecart === 0 ? '' : ecart > 0 ? 'ft-ecart-pos' : 'ft-ecart-neg'}">
          ${ecart === 0 ? 'réf.' : (ecart > 0 ? '+' : '') + fmt(ecart)}
        </td>
      </tr>`;
  }).join('');

  const best = envs.reduce((a, b) => a.net > b.net ? a : b);
  const totalNetBest = fisc.netPEA + best.net;
  const economieTotale = totalNetBest - fisc.netCTO_all;

  fiscalDiv.innerHTML = `
    <div class="fisc-table-wrap">
      <table class="fisc-table">
        <thead>
          <tr>
            <th>Enveloppe complémentaire</th>
            <th>Capital brut</th>
            <th>Plus-value</th>
            <th>Impôt</th>
            <th>Net</th>
            <th>vs CTO</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="fisc-table-footer">
      Meilleure option : ${best.name} · Net PEA + complément : ${fmt(totalNetBest)} · Économie totale vs tout en CTO : + ${fmt(economieTotale)}
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
  let dureeTxt, dureeSub, epuise = r.moisEpuisement !== null;
  if (epuise) {
    const ans  = Math.floor(r.moisEpuisement / 12);
    const mois = r.moisEpuisement % 12;
    dureeTxt = ans > 0 ? `${ans} an${ans > 1 ? 's' : ''}${mois ? ` ${mois} mois` : ''}` : `${mois} mois`;
    dureeSub = 'avant épuisement du capital';
  } else {
    dureeTxt = '50 ans et +';
    dureeSub = `capital restant : ${fmt(r.capFinal)}`;
  }

  badge.textContent = epuise ? dureeTxt : '∞';
  badge.classList.add('show');

  const renteFinaleTxt = o.indexer && !epuise
    ? ` · rente indexée : ${fmt(r.renteFinale)}/mois en an 50`
    : '';

  resDiv.innerHTML = `
    <div class="kpi-grid" style="margin-top:1.1rem">
      <div class="kpi ${epuise ? 'gold' : 'green'}">
        <div class="kpi-label">Durée du capital</div>
        <div class="kpi-value">${dureeTxt}</div>
        <div class="kpi-sub">${dureeSub}</div>
      </div>
      <div class="kpi green">
        <div class="kpi-label">Rente soutenable 50 ans</div>
        <div class="kpi-value">${fmt(renteMax)}</div>
        <div class="kpi-sub">nets / mois sans épuiser le capital</div>
      </div>
      <div class="kpi blue">
        <div class="kpi-label">Total retiré (net)</div>
        <div class="kpi-value">${fmt(r.retraitNetTotal)}</div>
        <div class="kpi-sub">sur la période simulée${renteFinaleTxt}</div>
      </div>
      <div class="kpi purple">
        <div class="kpi-label">Prélèvements sociaux</div>
        <div class="kpi-value">${fmt(r.psTotal)}</div>
        <div class="kpi-sub">17.2 % sur la part de plus-value</div>
      </div>
    </div>`;

  updateRenteChart(r);
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
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('Stockage local plein — supprimez des scénarios anciens pour libérer de l\'espace.');
    }
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
    hint.textContent = arr.length >= MAX_SCENARIOS
      ? `Limite atteinte (${MAX_SCENARIOS} max)`
      : arr.length >= 18
        ? `${MAX_SCENARIOS - arr.length} emplacements restants`
        : '';
  }

  if (!arr.length) {
    list.innerHTML = '<p class="scenarios-empty">Aucun scénario sauvegardé. Cliquez sur « 💾 Sauvegarder » pour commencer à comparer différentes stratégies.</p>';
    return;
  }

  list.innerHTML = arr.map(sc => {
    const dateStr = new Date(sc.date_modification).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return `
    <div class="scenario-save-card" data-id="${sc.id}">
      <div class="sc-card-header">
        <div class="sc-card-name">${escHtml(sc.nom)}</div>
        <div class="sc-card-date">Modifié le ${dateStr}</div>
      </div>
      <div class="sc-card-kpis">
        <span class="sc-kpi"><span class="sc-kpi-lbl">Versement</span>${sc.parametres.mensuel} €/mois</span>
        <span class="sc-kpi"><span class="sc-kpi-lbl">Durée</span>${sc.parametres.duree} ans</span>
        <span class="sc-kpi"><span class="sc-kpi-lbl">Capital final</span>${fmt(sc.resultats_kpi.final)}</span>
      </div>
      <div class="sc-card-actions">
        <button class="sc-btn" data-action="load">📂 Charger</button>
        <button class="sc-btn" data-action="rename">✏️ Renommer</button>
        <button class="sc-btn sc-btn-compare" data-action="compare">📋 Comparer</button>
        <button class="sc-btn sc-btn-del" data-action="del">🗑️ Supprimer</button>
      </div>
    </div>`;
  }).join('');
}

function openSaveModal() {
  const arr = loadScenarios();
  if (arr.length >= MAX_SCENARIOS) {
    alert(`Limite de ${MAX_SCENARIOS} scénarios atteinte. Supprimez-en un pour continuer.`);
    return;
  }
  const now  = new Date();
  const name = `Scénario du ${now.toLocaleDateString('fr-FR')} ${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'modal-save-scenario';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">💾 Sauvegarder le scénario</div>
      <label class="modal-lbl" for="modal-scenario-name">Nom du scénario</label>
      <input class="modal-input" type="text" id="modal-scenario-name" maxlength="50" placeholder="Nom…" value="${escHtml(name)}">
      <div class="modal-footer">
        <button class="modal-btn-primary" id="modal-save-confirm">Enregistrer</button>
        <button class="modal-btn-cancel"  id="modal-save-cancel">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const input = modal.querySelector('#modal-scenario-name');
  setTimeout(() => { input.focus(); input.select(); }, 50);

  modal.querySelector('#modal-save-confirm').addEventListener('click', () => {
    const nom = input.value.trim();
    if (!nom) { input.classList.add('modal-input-error'); return; }
    const arr2 = loadScenarios();
    if (arr2.length >= MAX_SCENARIOS) { alert(`Limite de ${MAX_SCENARIOS} scénarios atteinte.`); return; }
    const p2  = getParams();
    const d2  = compute(p2, vps, { plafond: getPlafond(), ...getAuDelaOpts() }, phases, overrides);
    const now2 = new Date().toISOString();
    arr2.push({
      id:                Date.now(),
      nom:               nom.slice(0, 50),
      date_creation:     now2,
      date_modification: now2,
      parametres:        buildScenarioParams(),
      resultats_kpi: {
        final:    d2.final,
        verse:    d2.versé,
        gain:     d2.gain,
        reel:     d2.reel,
        mult:     d2.mult,
        fraisTot: d2.fraisTot,
      },
    });
    saveScenarios(arr2);
    document.body.removeChild(modal);
    renderScenariosList();
    document.getElementById('coll-scenarios').classList.add('open');
  });

  const closeModal = () => { if (document.body.contains(modal)) document.body.removeChild(modal); };
  modal.querySelector('#modal-save-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function openRenameModal(id) {
  const sc = loadScenarios().find(s => s.id === id);
  if (!sc) return;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">✏️ Renommer le scénario</div>
      <label class="modal-lbl" for="modal-rename-input">Nouveau nom</label>
      <input class="modal-input" type="text" id="modal-rename-input" maxlength="50" value="${escHtml(sc.nom)}">
      <div class="modal-footer">
        <button class="modal-btn-primary" id="modal-rename-confirm">Renommer</button>
        <button class="modal-btn-cancel"  id="modal-rename-cancel">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const input = modal.querySelector('#modal-rename-input');
  setTimeout(() => { input.focus(); input.select(); }, 50);

  modal.querySelector('#modal-rename-confirm').addEventListener('click', () => {
    const nom = input.value.trim();
    if (!nom) { input.classList.add('modal-input-error'); return; }
    const arr2 = loadScenarios();
    const s    = arr2.find(x => x.id === id);
    if (s) { s.nom = nom.slice(0, 50); s.date_modification = new Date().toISOString(); }
    saveScenarios(arr2);
    document.body.removeChild(modal);
    renderScenariosList();
  });

  const closeModal = () => { if (document.body.contains(modal)) document.body.removeChild(modal); };
  modal.querySelector('#modal-rename-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function deleteScenario(id) {
  if (!confirm('Supprimer ce scénario définitivement ?')) return;
  saveScenarios(loadScenarios().filter(s => s.id !== id));
  renderScenariosList();
}

function loadScenario(id) {
  const sc = loadScenarios().find(s => s.id === id);
  if (!sc) return;

  const currentParams = JSON.stringify(getParams());
  const savedParams   = localStorage.getItem(LS_PARAMS);
  if (savedParams && currentParams !== savedParams) {
    if (!confirm('Charger ce scénario remplacera vos paramètres actuels. Continuer ?')) return;
  }

  const pm = sc.parametres;
  applyParams(pm);

  vps   = Array.isArray(pm.vps) ? JSON.parse(JSON.stringify(pm.vps)) : [];
  vpId  = vps.reduce((m, x) => Math.max(m, x.id || 0), 0);
  renderVP();

  phases         = Array.isArray(pm.phases) ? JSON.parse(JSON.stringify(pm.phases)) : [];
  phaseId        = phases.reduce((m, x) => Math.max(m, x.id || 0), 0);
  editingPhaseId = null;
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
  computeAndRender();
}

function startCompare(id) {
  const sc = loadScenarios().find(s => s.id === id);
  if (!sc) return;

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

  _compareScenarioData = { nom: sc.nom, totL: dB.totL, yrs: dB.yrs, d: dB };
  addComparisonLine(dB.totL, dB.yrs, sc.nom);

  const nomB = escHtml(sc.nom);
  const kpiRows = [
    { lbl: 'Capital final',     a: dA.final,     b: dB.final,     isCurr: true  },
    { lbl: 'Plus-value brute',  a: dA.gain,      b: dB.gain,      isCurr: true  },
    { lbl: 'Valeur réelle',     a: dA.reel,      b: dB.reel,      isCurr: true  },
    { lbl: 'Multiplicateur',    a: dA.mult,      b: dB.mult,      isCurr: false, fmtFn: v => `× ${v.toFixed(2)}` },
    { lbl: 'Frais ETF cumulés', a: dA.fraisTot,  b: dB.fraisTot,  isCurr: true, inv: true },
    { lbl: 'Durée',             a: p.duree,      b: pm.duree,     isCurr: false, fmtFn: v => `${v} ans`,      noEcart: true },
    { lbl: 'Versement mensuel', a: p.mensuel,    b: pm.mensuel,   isCurr: false, fmtFn: v => `${v} €/mois`,   noEcart: true },
    { lbl: 'Rendement moyen',   a: dA.tauxMoyen, b: dB.tauxMoyen, isCurr: false, fmtFn: v => `${v.toFixed(1)} %`, noEcart: true },
  ];

  const rows = kpiRows.map(row => {
    const fmtVal = row.fmtFn || (v => fmt(v));
    const ecart  = row.b - row.a;
    const ecartStr = row.noEcart ? '—' : (row.isCurr
      ? `${ecart >= 0 ? '+' : ''}${fmt(ecart)}`
      : `${ecart >= 0 ? '+' : ''}${ecart.toFixed(2)}`);
    const pctRaw = (!row.noEcart && row.a !== 0)
      ? (ecart / Math.abs(row.a) * 100).toFixed(1) : null;
    const ecartCombined = row.noEcart ? '—'
      : ecartStr + (pctRaw != null ? `<br><small>${pctRaw} %</small>` : '');
    const cls = row.noEcart ? '' : (row.inv
      ? (ecart > 0 ? 'ct-neg' : ecart < 0 ? 'ct-pos' : '')
      : (ecart > 0 ? 'ct-pos' : ecart < 0 ? 'ct-neg' : ''));
    return `<tr><td>${row.lbl}</td><td>${fmtVal(row.a)}</td><td>${fmtVal(row.b)}</td>
      <td class="${cls}">${ecartCombined}</td></tr>`;
  }).join('');

  const durationNote = p.duree !== pm.duree
    ? `<p class="compare-duration-note">⚠ Durées différentes : actuel ${p.duree} ans / comparé ${pm.duree} ans.</p>`
    : '';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'modal-compare';
  modal.innerHTML = `
    <div class="modal-box modal-box-wide">
      <div class="modal-title">📊 Scénario actuel vs <em>${nomB}</em></div>
      ${durationNote}
      <div class="compare-table-wrap">
        <table class="compare-table">
          <thead><tr>
            <th>Indicateur</th><th>Actuel</th><th>${nomB}</th><th>Écart</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button class="modal-btn-cancel" id="modal-compare-close">✕ Fermer la comparaison</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('#modal-compare-close').addEventListener('click', stopCompare);
  modal.addEventListener('click', e => { if (e.target === modal) stopCompare(); });
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') stopCompare(); });
}

function stopCompare() {
  _compareScenarioData = null;
  removeComparisonLine();
  const modal = document.getElementById('modal-compare');
  if (modal) document.body.removeChild(modal);
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
  const duree = +document.getElementById('n-duree').value || 20;

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
    const sign   = ph.taux >= 0 ? '+' : '';

    const viewPart = `
      <div class="phase-card-view">
        <span class="phase-num">${i + 1}</span>
        <div class="phase-content">
          <div class="phase-label-text">${lbl}</div>
          <div class="phase-range">An ${ph.anneeDebut} → An ${ph.anneeFin}</div>
          <div class="phase-values-text">${ph.mensuel} €/mois · ${sign}${ph.taux} %/an</div>
        </div>
        <div class="phase-btns">
          <button class="phase-btn-edit" data-action="${isEdit ? 'cancel' : 'edit'}">${isEdit ? 'Annuler' : 'Éditer'}</button>
          <button class="phase-btn-del"  data-action="del">✕</button>
        </div>
      </div>`;

    const editPart = !isEdit ? '' : `
      <div class="phase-card-edit">
        <div class="phase-edit-grid">
          <div class="phase-edit-field phase-edit-field-wide">
            <label>Libellé</label>
            <input class="ph-lbl" type="text" value="${escHtml(ph.label || '')}" placeholder="Nom de la phase…">
          </div>
          <div class="phase-edit-field">
            <label>Année début</label>
            <input class="ph-start" type="number" min="1" max="${duree}" value="${ph.anneeDebut}">
          </div>
          <div class="phase-edit-field">
            <label>Année fin</label>
            <input class="ph-end" type="number" min="1" max="${duree}" value="${ph.anneeFin}">
          </div>
          <div class="phase-edit-field">
            <label>€ / mois</label>
            <input class="ph-mensuel" type="number" min="0" step="50" value="${ph.mensuel}">
          </div>
          <div class="phase-edit-field">
            <label>% / an</label>
            <input class="ph-taux" type="number" min="-50" max="50" step="0.5" value="${ph.taux}">
          </div>
        </div>
        <div class="phase-edit-footer">
          <button class="ph-btn-save" data-action="save">Enregistrer</button>
          <button class="ph-btn-cancel" data-action="cancel">Annuler</button>
          <span class="phase-edit-error"></span>
        </div>
      </div>`;

    return `<div class="phase-card" data-id="${ph.id}" style="--phase-color:${color}">${viewPart}${editPart}</div>`;
  }).join('');

  // Avertissements de chevauchement
  const warns  = validatePhases(duree);
  const valDiv = document.getElementById('phases-validation');
  valDiv.innerHTML = warns.map(w => `<div class="phases-warning">${w}</div>`).join('');
}

/* ── Vue tableau année par année ─────────────────────────── */
function renderYearTable(p) {
  const wrap = document.getElementById('phases-year-table');
  const btn  = document.getElementById('btn-year-view');
  if (!wrap) return;

  if (!showYearView || !phases.length) {
    wrap.style.display = 'none';
    if (btn) btn.classList.remove('active');
    return;
  }
  if (btn) btn.classList.add('active');
  wrap.style.display = '';

  const augR = p.aug / 100;
  const rows = Array.from({ length: p.duree }, (_, i) => {
    const an    = i + 1;
    const phIdx = phases.findIndex(ph => an >= ph.anneeDebut && an <= ph.anneeFin);
    const ph    = phIdx >= 0 ? phases[phIdx] : null;
    const ov    = overrides[an] || null;
    let mens  = ph ? ph.mensuel : Math.round(p.mensuel * Math.pow(1 + augR, an - 1));
    let taux  = ph ? ph.taux    : p.taux;
    if (ov && ov.mensuel != null) mens = ov.mensuel;
    if (ov && ov.taux    != null) taux = ov.taux;
    const isCustom = ov && (ov.mensuel != null || ov.taux != null || ov.mois);
    const color = ph ? PHASE_PALETTE[phIdx % PHASE_PALETTE.length].bar : null;
    const chip  = isCustom
      ? `<span class="yt-phase-chip" style="background:rgba(46,168,196,.14);color:var(--teal)">Perso</span>`
      : ph
        ? `<span class="yt-phase-chip" style="background:${color}20;color:${color}">${escHtml(ph.label || `Phase ${phIdx + 1}`)}</span>`
        : `<span class="yt-phase-chip" style="background:#8b949e20;color:#8b949e">Global</span>`;
    return `<tr><td>An ${an}</td><td>${chip}</td><td>${mens} €</td><td>${taux >= 0 ? '+' : ''}${taux} %</td></tr>`;
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

function renderAnnees(p) {
  const wrap     = document.getElementById('annees-table');
  const badge    = document.getElementById('annees-badge');
  const btnReset = document.getElementById('btn-annees-reset');
  if (!wrap) return;

  const nbOv = nbOverrideYears();
  if (badge) {
    badge.textContent = nbOv ? `${nbOv} an${nbOv > 1 ? 's' : ''} perso` : '';
    badge.classList.toggle('show', nbOv > 0);
  }
  if (btnReset) btnReset.style.display = nbOv ? '' : 'none';

  // Ne pas reconstruire la table pendant une saisie (re-render venu d'un autre
  // contrôle) — mais seulement si c'est un champ de saisie qui a le focus :
  // les boutons (déplier ▸, effacer ✕) doivent re-rendre immédiatement.
  if (wrap.contains(document.activeElement) &&
      document.activeElement.tagName === 'INPUT') return;

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

    let chip;
    if (isCustom) {
      chip = `<span class="yt-phase-chip" style="background:rgba(46,168,196,.14);color:var(--teal)">Perso</span>`;
    } else if (base.phIdx >= 0) {
      const color = PHASE_PALETTE[base.phIdx % PHASE_PALETTE.length].bar;
      chip = `<span class="yt-phase-chip" style="background:${color}20;color:${color}">${escHtml(phases[base.phIdx].label || `Phase ${base.phIdx + 1}`)}</span>`;
    } else {
      chip = `<span class="yt-phase-chip" style="background:#8b949e20;color:#8b949e">Global</span>`;
    }
    const moisBadge = nbMois
      ? ` <span class="an-mois-badge">${nbMois} mois perso</span>` : '';

    rows.push(`
      <tr class="an-row ${isCustom ? 'an-custom' : ''}" data-an="${an}">
        <td class="an-cell-year">
          <button class="an-expand ${isOpen ? 'open' : ''}" data-action="expand" title="Régler chaque mois">${isOpen ? '▾' : '▸'}</button>
          An ${an}
        </td>
        <td><input class="an-input an-mens ${ov.mensuel != null ? 'ovr' : ''}" type="number" min="0" step="10" value="${mensEff}"></td>
        <td><input class="an-input an-taux ${ov.taux != null ? 'ovr' : ''}" type="number" min="-50" max="50" step="0.1" value="${tauxEff}"></td>
        <td>${chip}${moisBadge}</td>
        <td class="an-cell-clear">${isCustom ? `<button class="an-clear" data-action="clear" title="Revenir aux valeurs héritées">✕</button>` : ''}</td>
      </tr>`);

    if (isOpen) {
      const cells = MOIS_LABELS.map((lbl, mi) => {
        const m   = mi + 1;
        const ovM = (ov.mois && ov.mois[m]) || {};
        return `
          <div class="mois-cell">
            <div class="mois-lbl">${lbl}</div>
            <input class="an-input m-vers ${ovM.versement != null ? 'ovr' : ''}" data-mois="${m}" type="number" min="0" step="10"
                   placeholder="${mensEff}" value="${ovM.versement != null ? ovM.versement : ''}" title="Versement du mois (€)">
            <input class="an-input m-taux ${ovM.taux != null ? 'ovr' : ''}" data-mois="${m}" type="number" min="-99" max="200" step="0.1"
                   placeholder="${tauxEff}" value="${ovM.taux != null ? ovM.taux : ''}" title="Rendement annualisé appliqué ce mois (%)">
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
        <thead><tr><th>Année</th><th>Versement €/mois</th><th>Rendement %/an</th><th>Source</th><th></th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;

  const newWrap = wrap.querySelector('.an-table-wrap');
  if (newWrap && prevScroll) newWrap.scrollTop = prevScroll;
}

/* ── Tableau année par année enrichi ─────────────────────── */
function renderTable(d, phases, vps) {
  const tbody    = document.getElementById('tbody');
  const tfoot    = document.getElementById('tfoot');
  const p        = getParams();
  const showAude = (d.capAuDelaFinal || 0) > 0;

  // Construire les lignes de données
  const rows = d.yrs.map((an, i) => {
    const versAn  = i === 0 ? d.versL[0] : Math.max(0, d.versL[i] - d.versL[i - 1]);
    const phIdx   = d.phaseIdxL[i];
    const phase   = phIdx >= 0 ? phases[phIdx] : null;
    const phaseLabel = phase ? (phase.label || `Phase ${phIdx + 1}`) : null;
    const phaseColor = phase ? PHASE_PALETTE[phIdx % PHASE_PALETTE.length].bar : null;
    // Taux effectif de l'année (tient compte des overrides année/mois)
    const rendAn  = d.tauxAnL ? d.tauxAnL[i] : (phase ? phase.taux : p.taux);
    const cagr    = (i > 0 && d.totL[0] > 0)
      ? (Math.pow(d.totL[i] / d.totL[0], 1 / an) - 1) * 100
      : null;
    const hasVP   = vps.some(v => v.recurrent ? an >= (v.annee || 1) : an === v.annee);
    const isPlafondYear = d.plafondAn != null && d.plafondAn === an;

    return { an, i, versL: d.versL[i], versAn, gainL: d.gainL[i], totL: d.totL[i],
             reelL: d.reelL[i], fraisL: d.fraisL[i], capAuDelaL: d.capAuDelaL[i] || 0,
             rendAn, phaseLabel, phaseColor, phIdx, cagr, hasVP, isPlafondYear };
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
    'cagr':    r => r.cagr ?? -Infinity,
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
  tbody.innerHTML = '';
  filtered.forEach((r, sortedIdx) => {
    // Début de phase : premier item de cette phase dans la vue courante
    const isPhaseStart = r.phaseLabel !== null && (
      sortedIdx === 0 || filtered[sortedIdx - 1].phaseLabel !== r.phaseLabel
    );

    const phaseChip = r.phaseLabel
      ? `<span class="td-phase-chip" style="background:${r.phaseColor}20;color:${r.phaseColor}">${escHtml(r.phaseLabel)}</span>`
      : `<span class="td-phase-chip td-phase-global">—</span>`;

    const cagrCell = r.cagr != null
      ? `<span class="${r.cagr >= 0 ? 'td-cagr-pos' : 'td-cagr-neg'}">${r.cagr.toFixed(1)} %</span>`
      : '—';

    const yearCls  = r.isPlafondYear ? 'td-year td-plafond-year' : 'td-year';
    const versAnStr = r.hasVP
      ? `${fmt(r.versAn)}<span class="td-vp-marker" title="Versement ponctuel ce mois">💰</span>`
      : fmt(r.versAn);
    const rendSign = r.rendAn >= 0 ? '+' : '';

    const tr = document.createElement('tr');
    if (isPhaseStart && r.phaseColor) tr.style.borderLeft = `3px solid ${r.phaseColor}`;
    tr.innerHTML = `
      <td class="${yearCls}">Année ${r.an}</td>
      <td>${fmt(r.versL)}</td>
      <td>${versAnStr}</td>
      <td class="td-gain">${fmt(r.gainL)}</td>
      <td class="td-total">${fmt(r.totL)}</td>
      <td class="td-reel">${fmt(r.reelL)}</td>
      <td class="td-frais">${fmt(r.fraisL)}</td>
      <td>${rendSign}${r.rendAn.toFixed(1)} %</td>
      <td>${phaseChip}</td>
      <td>${cagrCell}</td>
      <td style="display:${showAude ? '' : 'none'}">${r.capAuDelaL > 0 ? fmt(r.capAuDelaL) : '—'}</td>`;
    tbody.appendChild(tr);
  });

  // Rendre le tfoot (totaux sur la simulation complète, indépendamment du filtre)
  if (tfoot) {
    const lastIdx    = d.yrs.length - 1;
    const finalReel  = d.reelL[lastIdx] || 0;
    const cagrGlobal = (lastIdx > 0 && d.totL[0] > 0)
      ? (Math.pow(d.final / d.totL[0], 1 / d.yrs[lastIdx]) - 1) * 100
      : null;
    const cagrGlobalStr = cagrGlobal != null
      ? `<span class="${cagrGlobal >= 0 ? 'td-cagr-pos' : 'td-cagr-neg'}">${cagrGlobal.toFixed(1)} %</span>`
      : '—';
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
      <td>${cagrGlobalStr}</td>
      <td style="display:${showAude ? '' : 'none'}">—</td>
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

  document.getElementById('coll-phases').classList.add('open');
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

  /* Header */
  document.getElementById('header-sub').textContent =
    `Projection sur ${p.duree} an${p.duree > 1 ? 's' : ''} avec intérêts composés mensuels`;

  /* KPI – Capital final */
  animateKpi('kpi-final', d.final, fmt);
  document.getElementById('kpi-final-sub').textContent =
    `après ${p.duree} an${p.duree > 1 ? 's' : ''} · ×${d.mult.toFixed(2)} la mise`;

  /* KPI – Valeur réelle */
  const erosion = d.final > 0 ? ((1 - d.reel / d.final) * 100).toFixed(0) : 0;
  animateKpi('kpi-reel', d.reel, fmt);
  document.getElementById('kpi-reel-sub').textContent = `− ${erosion} % d'érosion inflation`;

  /* KPI – Total versé */
  const mensF  = p.mensuel * Math.pow(1 + p.aug / 100, p.duree - 1);
  let subVerse = `${p.duree * 12} mois`;
  if (p.apport > 0)   subVerse += ` + ${fmt(p.apport)} initial`;
  if (p.aug > 0)      subVerse += ` · ${p.mensuel}→${Math.round(mensF)} €/mois`;
  if (vps.length > 0) subVerse += ` + ${vps.length} vers. ponctuel${vps.length > 1 ? 's' : ''}`;
  animateKpi('kpi-verse', d.versé, fmt);
  document.getElementById('kpi-verse-sub').textContent = subVerse;

  /* KPI – Plus-value brute */
  const gainPct = d.versé > 0 ? ((d.gain / d.versé) * 100).toFixed(0) : 0;
  animateKpi('kpi-brut', d.gain, fmt);
  document.getElementById('kpi-brut-sub').textContent = `+ ${gainPct} % de la mise`;

  /* KPI – Plus-value nette */
  const gainNet = fiscOn ? d.gain * 0.828 : d.gain;
  animateKpi('kpi-net', gainNet, fmt);
  const gainNetPct = d.versé > 0 ? Math.round(gainNet / d.versé * 100) : 0;
  document.getElementById('kpi-net-sub').textContent =
    (fiscOn ? 'après PS 17.2 % (PEA)' : 'plus-value brute') +
    ` · +${gainNetPct} % du versé`;

  /* KPI – Frais ETF */
  const fraisPct = (d.final + d.fraisTot) > 0
    ? (d.fraisTot / (d.final + d.fraisTot) * 100).toFixed(1) : 0;
  animateKpi('kpi-frais', d.fraisTot, fmt);
  document.getElementById('kpi-frais-sub').textContent = `${fraisPct} % du capital brut`;

  /* KPI – Multiplicateur */
  animateKpi('kpi-mult', d.mult, n => `× ${n.toFixed(2)}`);

  /* KPI – Versements PEA / Plafond */
  animateKpi('kpi-verse-pea', d.versNets, fmt);
  document.getElementById('kpi-verse-pea-sub').textContent = `/ ${fmt(plafond)}`;
  const pctPEA  = Math.min(100, d.versNets / plafond * 100);
  const kpiFill = document.getElementById('kpi-progress-fill');
  kpiFill.style.width = pctPEA + '%';
  kpiFill.className = 'kpi-progress-fill' + (pctPEA >= 100 ? ' full' : pctPEA >= 80 ? ' warn' : '');

  /* KPI – Plafond atteint */
  const pAnEl  = document.getElementById('kpi-plafond-an');
  const pAnSub = document.getElementById('kpi-plafond-an-sub');
  if (d.plafondAn === 0) {
    pAnEl.textContent  = 'Départ';
    pAnSub.textContent = 'dès l\'apport initial';
  } else if (d.plafondAn != null) {
    pAnEl.textContent  = `An ${d.plafondAn}`;
    const restAns = p.duree - d.plafondAn;
    pAnSub.textContent = `${restAns} an${restAns > 1 ? 's' : ''} de plus-value pure`;
  } else {
    pAnEl.textContent  = 'Non atteint';
    pAnSub.textContent = `${fmt(plafond - d.versNets)} de capacité restante`;
  }

  /* KPI – Capital total (PEA + complément) */
  const totalAll = d.final + (d.capAuDelaFinal || 0);
  animateKpi('kpi-total-all', totalAll, fmt);
  document.getElementById('kpi-total-all-sub').textContent =
    (d.capAuDelaFinal || 0) > 0 ? 'PEA + complément' : 'PEA uniquement';
  setDelta('delta-total-all', totalAll, DEF.final);

  /* KPI – Économie vs CTO */
  animateKpi('kpi-economie', fisc.economiePEAvsCTO, fmt);
  const economiePct = d.gain > 0 ? Math.round(Math.abs(fisc.economiePEAvsCTO) / d.gain * 100) : 0;
  const economieSubEl = document.getElementById('kpi-economie-sub');
  if (economieSubEl) economieSubEl.textContent = fisc.economiePEAvsCTO >= 0
    ? `avantage fiscal PEA · +${economiePct} % du gain`
    : `désavantage fiscal · ${economiePct} % du gain`;

  /* Badges delta */
  setDelta('delta-final',  d.final,    DEF.final);
  setDelta('delta-reel',   d.reel,     DEF.reel);
  setDelta('delta-verse',  d.versé,    DEF.versé);
  setDelta('delta-brut',   d.gain,     DEF.gain);
  setDelta('delta-net',    gainNet,    fiscOn ? DEF.gain * 0.828 : DEF.gain);
  setDelta('delta-frais',  d.fraisTot, DEF.fraisTot, true, true);
  setDelta('delta-mult',   d.mult,     DEF.mult, false);

  /* Fiscalité PEA vs CTO */
  renderFisc(d.gain, d.final);

  /* Plafond widget */
  renderPlafond(d, plafond, couple);

  /* Au-delà du plafond */
  renderAuDela(d);

  /* Mise à jour du max des années VP */
  document.querySelectorAll('.vp-yr').forEach(el => { el.max = p.duree; });

  /* Colonne tableau complément (header) */
  const thAude = document.getElementById('th-aude');
  if (thAude) thAude.style.display = (d.capAuDelaFinal || 0) > 0 ? '' : 'none';

  /* Graphiques */
  updateCharts(d, dBase, phases);

  /* Phase de rente */
  renderRente(d, p);

  /* KPI — phases de vie */
  const nbPhSub    = document.getElementById('kpi-nb-phases-sub');
  const nbPhEl     = document.getElementById('kpi-nb-phases');
  const mensMoyEl  = document.getElementById('kpi-mens-moy');
  const tauxMoyEl  = document.getElementById('kpi-taux-moy');
  const ecartEl    = document.getElementById('kpi-ecart-phases');
  const ecartSubEl = document.getElementById('kpi-ecart-phases-sub');

  if (nbPhEl) {
    nbPhEl.textContent = phases.length > 0 ? phases.length : '—';
    if (nbPhSub) nbPhSub.textContent = phases.length > 0
      ? `${phases.length} phase${phases.length > 1 ? 's' : ''} active${phases.length > 1 ? 's' : ''}`
      : 'scénario constant';
  }
  if (mensMoyEl) mensMoyEl.textContent = phases.length > 0 ? Math.round(d.mensuelMoyen) + ' €' : '—';
  if (tauxMoyEl) tauxMoyEl.textContent = phases.length > 0 ? d.tauxMoyen.toFixed(1) + ' %' : '—';
  if (ecartEl) {
    if (dBase) {
      const ecart = d.final - dBase.final;
      ecartEl.textContent = (ecart >= 0 ? '+' : '') + fmt(ecart);
      ecartEl.style.color = ecart >= 0 ? 'var(--green)' : 'var(--red)';
      if (ecartSubEl) ecartSubEl.textContent = ecart >= 0 ? 'gain vs scénario constant' : 'perte vs scénario constant';
    } else {
      ecartEl.textContent = '—';
      ecartEl.style.color = '';
      if (ecartSubEl) ecartSubEl.textContent = 'sans personnalisation';
    }
  }

  /* Phases — tableau année par année */
  renderYearTable(p);

  /* Personnalisation année/mois */
  renderAnnees(p);

  /* Tableau enrichi */
  _lastTableData = { d, phases: [...phases], vps: [...vps] };
  renderTable(d, phases, vps);

  /* Sauvegarde automatique */
  saveParams();
}

const debouncedRender = debounce(computeAndRender, 150);

/* ── Collapsible ─────────────────────────────────────────── */
function toggleColl(id) {
  document.getElementById(id).classList.toggle('open');
}

/* ── Presets ─────────────────────────────────────────────── */
function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  applyParams({ ...DEFAULTS, ...p });
  computeAndRender();
  document.querySelectorAll('.preset-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.preset === name));
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
    show('<strong>Tracker vide</strong> — aucune opération d\'achat trouvée. ' +
         'Saisis tes opérations dans le <a href="../tracker/index.html">Tracker</a> ' +
         '(même navigateur, page servie par l\'API), puis reviens ici.');
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
  document.querySelectorAll('.preset-btn').forEach(b =>
    b.classList.toggle('active', b.id === 'btn-pea-reel'));
  computeAndRender();

  show(`<strong>Paramètres repris de ton PEA réel</strong> — apport initial : ${fmt(Math.round(valeur))} ` +
       `(valeur actuelle du portefeuille${sansCours ? ' ; cours manquants remplacés par le coût d\'achat' : ''}), ` +
       `versement : ${mensuel} €/mois (moyenne des ${moisHist} dernier${moisHist > 1 ? 's' : ''} mois). ` +
       `Durée, rendement et les autres paramètres restent les tiens.`);
}

/* ── Tooltips ────────────────────────────────────────────── */
function initTooltips() {
  document.querySelectorAll('.tt-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const box    = btn.nextElementSibling;
      const isOpen = box.classList.contains('visible');
      document.querySelectorAll('.tt-box.visible').forEach(el => el.classList.remove('visible'));
      if (!isOpen) box.classList.add('visible');
    });
  });
  document.addEventListener('click', () =>
    document.querySelectorAll('.tt-box.visible').forEach(el => el.classList.remove('visible')));
}

/* ── Initialisation ──────────────────────────────────────── */
function init() {
  initCharts();

  wire('s-mensuel',   'n-mensuel');
  wire('s-taux',      'n-taux');
  wire('s-duree',     'n-duree');
  wire('s-apport',    'n-apport');
  wire('s-inflation', 'n-inflation');
  wire('s-frais',     'n-frais');
  wire('s-aug',       'n-aug');

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

  /* Versements ponctuels */
  document.getElementById('vp-list').addEventListener('change', e => {
    const row = e.target.closest('[data-id]'); if (!row) return;
    const v   = vps.find(x => x.id === +row.dataset.id); if (!v) return;
    if (e.target.classList.contains('vp-yr'))  { v.annee    = +e.target.value; computeAndRender(); }
    if (e.target.classList.contains('vp-amt')) { v.montant  = +e.target.value; computeAndRender(); }
    if (e.target.classList.contains('vp-lbl')) { v.libelle  = e.target.value; }
    if (e.target.classList.contains('vp-rec')) {
      v.recurrent = e.target.checked;
      const lbl = row.querySelector('.lbl-yr');
      if (lbl) lbl.textContent = v.recurrent ? "Dès l'an" : 'Année';
      computeAndRender();
    }
  });
  document.getElementById('vp-list').addEventListener('click', e => {
    const btn = e.target.closest('.vp-btn-del'); if (!btn) return;
    const row = btn.closest('[data-id]'); if (!row) return;
    vps = vps.filter(x => x.id !== +row.dataset.id);
    renderVP(); computeAndRender();
  });
  document.getElementById('btn-vp-add').addEventListener('click', () => {
    vps.push({ id: ++vpId, annee: 1, montant: 1000, libelle: '', recurrent: false });
    document.getElementById('coll-vp').classList.add('open');
    renderVP(); computeAndRender();
  });

  /* Presets */
  document.querySelectorAll('.preset-btn').forEach(btn =>
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));

  /* Partir de mon PEA réel (données du tracker) */
  document.getElementById('btn-pea-reel')?.addEventListener('click', applyPEAReel);

  /* Réinitialiser */
  document.getElementById('btn-reset').addEventListener('click', () => {
    applyParams(DEFAULTS);
    document.getElementById('cb-fisc').checked   = false;
    document.getElementById('cb-couple').checked = false;
    document.getElementById('cb-aude').checked   = false;
    document.getElementById('aude-params').className = 'aude-params-hidden';
    document.getElementById('cb-rente').checked  = false;
    document.getElementById('rente-params').className = 'aude-params-hidden';
    vps = []; renderVP();
    phases = []; editingPhaseId = null;
    overrides = {}; expandedYears.clear();
    const explainEl = document.getElementById('scenario-explain');
    if (explainEl) explainEl.style.display = 'none';
    const peaReelNote = document.getElementById('pea-reel-note');
    if (peaReelNote) peaReelNote.style.display = 'none';
    renderPhases();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    computeAndRender();
  });

  /* ── Phases de vie : délégation sur la liste ────────────── */
  document.getElementById('phases-list').addEventListener('click', e => {
    const card   = e.target.closest('.phase-card');
    if (!card) return;
    const id     = +card.dataset.id;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'edit') {
      editingPhaseId = (editingPhaseId === id) ? null : id;
      renderPhases();

    } else if (action === 'cancel') {
      editingPhaseId = null;
      renderPhases();

    } else if (action === 'del') {
      phases = phases.filter(p => p.id !== id);
      if (editingPhaseId === id) editingPhaseId = null;
      renderPhases();
      computeAndRender();

    } else if (action === 'save') {
      const lbl     = card.querySelector('.ph-lbl')?.value.trim()    || '';
      const start   = +card.querySelector('.ph-start')?.value;
      const end     = +card.querySelector('.ph-end')?.value;
      const mensuel = +card.querySelector('.ph-mensuel')?.value;
      const taux    = +card.querySelector('.ph-taux')?.value;
      const errEl   = card.querySelector('.phase-edit-error');

      if (!start || !end || start > end) {
        if (errEl) errEl.textContent = 'Année début doit être ≤ année fin';
        return;
      }
      if (mensuel < 0) {
        if (errEl) errEl.textContent = 'Le versement ne peut pas être négatif';
        return;
      }

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
    }
  });

  /* ── Ajouter une phase ───────────────────────────────────── */
  document.getElementById('btn-phase-add').addEventListener('click', () => {
    const duree = +document.getElementById('n-duree').value || 20;
    const p     = getParams();
    // Chercher la première année non encore couverte par une phase
    const used  = new Set(phases.flatMap(ph =>
      Array.from({ length: ph.anneeFin - ph.anneeDebut + 1 }, (_, j) => ph.anneeDebut + j),
    ));
    let start = 1;
    while (start <= duree && used.has(start)) start++;
    const end = Math.min(start + 4, duree);

    const newPh = { id: ++phaseId, label: '', anneeDebut: start, anneeFin: end, mensuel: p.mensuel, taux: p.taux };
    phases.push(newPh);
    editingPhaseId = newPh.id;  // ouvrir directement le formulaire d'édition
    document.getElementById('coll-phases').classList.add('open');
    renderPhases();
    computeAndRender();
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
        renderAnnees(getParams());
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
      t.blur(); // libérer le focus pour autoriser la reconstruction de la table
      computeAndRender();
    });
  }

  const btnAnneesReset = document.getElementById('btn-annees-reset');
  if (btnAnneesReset) {
    btnAnneesReset.addEventListener('click', () => {
      if (!confirm('Supprimer toutes les personnalisations année/mois ?')) return;
      overrides = {};
      expandedYears.clear();
      renderAnnees(getParams());
      computeAndRender();
    });
  }

  /* ── Dropdown scénarios ──────────────────────────────────── */
  document.getElementById('btn-scenario').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('scenario-menu').classList.toggle('open');
  });

  document.querySelectorAll('.scenario-item').forEach(item =>
    item.addEventListener('click', () => {
      applyScenario(item.dataset.key);
      document.getElementById('scenario-menu').classList.remove('open');
    }),
  );

  document.getElementById('btn-scenario-reset').addEventListener('click', () => {
    phases = []; editingPhaseId = null;
    const explainEl = document.getElementById('scenario-explain');
    if (explainEl) explainEl.style.display = 'none';
    document.getElementById('scenario-menu').classList.remove('open');
    renderPhases();
    computeAndRender();
  });

  // Fermer le menu si clic en dehors
  document.addEventListener('click', () =>
    document.getElementById('scenario-menu').classList.remove('open'),
  );

  /* ── Tableau : tri par colonne ───────────────────────────── */
  const tblThead = document.querySelector('table thead');
  if (tblThead) {
    tblThead.addEventListener('click', e => {
      const th = e.target.closest('th[data-col]');
      if (!th) return;
      const col = th.dataset.col;
      _tableSort.dir = (_tableSort.col === col && _tableSort.dir === 'asc') ? 'desc' : 'asc';
      _tableSort.col = col;
      document.querySelectorAll('thead .th-sort-icon').forEach(ic => { ic.textContent = ''; });
      const icon = th.querySelector('.th-sort-icon');
      if (icon) icon.textContent = _tableSort.dir === 'asc' ? ' ▲' : ' ▼';
      if (_lastTableData) renderTable(_lastTableData.d, _lastTableData.phases, _lastTableData.vps);
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
  if (btnSave) btnSave.addEventListener('click', openSaveModal);

  const scenariosList = document.getElementById('scenarios-list');
  if (scenariosList) {
    scenariosList.addEventListener('click', e => {
      const card   = e.target.closest('.scenario-save-card');
      if (!card) return;
      const id     = +card.dataset.id;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'load')    loadScenario(id);
      if (action === 'rename')  openRenameModal(id);
      if (action === 'compare') startCompare(id);
      if (action === 'del')     deleteScenario(id);
    });
  }

  initTooltips();
  loadParams();
  renderVP();
  renderPhases();
  renderScenariosList();
  computeAndRender();
}

document.addEventListener('DOMContentLoaded', init);
