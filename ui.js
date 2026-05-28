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

/* ── Clés localStorage ───────────────────────────────────── */
const LS_PARAMS = 'pea_params';
const LS_VPS    = 'pea_vps';
const LS_FISC   = 'pea_fisc';
const LS_COUPLE = 'pea_couple';
const LS_AUDE   = 'pea_aude';
const LS_PHASES = 'pea_phases';

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
  const t0  = performance.now();
  (function tick(now) {
    const progress = Math.min((now - t0) / DUR, 1);
    const ease     = 1 - Math.pow(1 - progress, 3);
    el.textContent = fmtFn(fromVal + (toVal - fromVal) * ease);
    if (progress < 1) { _kpiRaf[id] = requestAnimationFrame(tick); }
    else { el.textContent = fmtFn(toVal); delete _kpiRaf[id]; }
  })(t0);
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
  } catch (_) {}
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
  el.textContent = isCur
    ? (d > 0 ? '+' : '−') + fmtAbs(d)
    : (d > 0 ? '+' : '')  + d.toFixed(2) + '×';
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
        <input class="vp-input vp-input-lbl vp-lbl" type="text" placeholder="Prime, bonus, héritage…" value="${v.libelle}" style="width:100%">
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

/* ── Utilitaire XSS ──────────────────────────────────────── */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    const mens  = ph ? ph.mensuel : Math.round(p.mensuel * Math.pow(1 + augR, an - 1));
    const taux  = ph ? ph.taux    : p.taux;
    const color = ph ? PHASE_PALETTE[phIdx % PHASE_PALETTE.length].bar : null;
    const chip  = ph
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

  const opts = { plafond, ...auOpts };
  const d    = compute(p, vps, opts, phases);
  // Scénario de référence sans phases — pour la courbe comparative et l'écart KPI
  const dBase = phases.length > 0 ? compute(p, vps, opts, []) : null;
  const fisc  = computeFiscal(d, { couple });

  /* Header */
  document.getElementById('header-sub').textContent =
    `Projection sur ${p.duree} an${p.duree > 1 ? 's' : ''} avec intérêts composés mensuels`;

  /* KPI – Capital final */
  animateKpi('kpi-final', d.final, fmt);
  document.getElementById('kpi-final-sub').textContent =
    `après ${p.duree} an${p.duree > 1 ? 's' : ''}`;

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
  document.getElementById('kpi-net-sub').textContent =
    fiscOn ? 'après PS 17.2 % (PEA)' : 'sans fiscalité appliquée';

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

  /* Colonne tableau complément */
  const thAude = document.getElementById('th-aude');
  if (thAude) thAude.style.display = (d.capAuDelaFinal || 0) > 0 ? '' : 'none';

  /* Graphiques */
  updateCharts(d, dBase, phases);

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

  /* Tableau */
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  d.yrs.forEach((an, i) => {
    const hasAude = (d.capAuDelaL[i] || 0) > 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-year">Année ${an}</td>
      <td>${fmt(d.versL[i])}</td>
      <td class="td-gain">${fmt(d.gainL[i])}</td>
      <td class="td-total">${fmt(d.totL[i])}</td>
      <td class="td-reel">${fmt(d.reelL[i])}</td>
      <td class="td-frais">${fmt(d.fraisL[i])}</td>
      <td class="td-total" style="display:${(d.capAuDelaFinal || 0) > 0 ? '' : 'none'}">${hasAude ? fmt(d.capAuDelaL[i]) : '—'}</td>`;
    tbody.appendChild(tr);
  });

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

  /* Réinitialiser */
  document.getElementById('btn-reset').addEventListener('click', () => {
    applyParams(DEFAULTS);
    document.getElementById('cb-fisc').checked   = false;
    document.getElementById('cb-couple').checked = false;
    document.getElementById('cb-aude').checked   = false;
    document.getElementById('aude-params').className = 'aude-params-hidden';
    vps = []; renderVP();
    phases = []; editingPhaseId = null;
    const explainEl = document.getElementById('scenario-explain');
    if (explainEl) explainEl.style.display = 'none';
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

  initTooltips();
  loadParams();
  renderVP();
  renderPhases();
  computeAndRender();
}

document.addEventListener('DOMContentLoaded', init);
