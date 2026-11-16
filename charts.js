'use strict';

/* ─────────────────────────────────────────────────────────────
   charts.js — Initialisation et mise à jour des graphiques
   Dépendances : Chart.js (CDN), fmt() et PHASE_PALETTE depuis simulation.js

   Le simulateur est aussi publié seul : ce fichier ne dépend pas de
   ../common.js. Le thème et les teintes reprennent ceux de l'écosystème
   (peaThemeGraphiques, PEA_SERIES) pour que les courbes se lisent pareil
   d'une page à l'autre.
───────────────────────────────────────────────────────────── */

/* Séries : les quatre premières teintes de la palette commune, dans son
   ordre (validées sur la surface des cartes : contraste, séparation pour
   les daltoniens). Reprises dans styles.css (--serie-1…4). Les repères
   (versements, plan constant) ne sont pas des séries : ils sont en gris. */
const SERIES     = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const SERIE_1_RGB = '57,135,229';
const GRIS       = '#8b949e';
const SURFACE    = '#161b22';

const SANS_ANIMATION = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

let chartGrowth     = null;
let _comparisonData = null; // { totL, yrs, nom } | null

/* ── Thème commun ────────────────────────────────────────── */

/* Réticule vertical : on vise une année, pas un trait de 2 px. */
const reticule = {
  id: 'reticule',
  afterDatasetsDraw(chart) {
    const actifs = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
    if (!actifs.length) return;
    const x = actifs[0].element.x, zone = chart.chartArea, c = chart.ctx;
    c.save();
    c.beginPath();
    c.moveTo(x, zone.top);
    c.lineTo(x, zone.bottom);
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(139,148,158,.45)';
    c.stroke();
    c.restore();
  },
};

/* Hauteur de tracé constante. La légende est dessinée dans le canevas : sur
   un écran étroit elle passe sur quatre ou cinq lignes et mangeait la moitié
   de la hauteur prévue pour la courbe. Le cadre grandit donc d'autant de
   lignes de légende supplémentaires — data-hauteur, dans la page, est la
   hauteur voulue quand la légende tient sur une ligne. Changer la hauteur
   relance une mise en page, qui retombe sur la même valeur : pas de boucle
   (le nombre de lignes ne dépend que de la largeur). */
const hauteurTrace = {
  id: 'hauteurTrace',
  afterLayout(chart) {
    const cadre = chart.canvas.parentElement;
    const base  = cadre ? +cadre.dataset.hauteur : 0;
    const leg   = chart.legend;
    if (!base || !leg || !leg.lineWidths) return;
    const lignes = Math.max(1, leg.lineWidths.length);
    const voulue = Math.round(base + leg.height * (lignes - 1) / lignes);
    if (Math.abs(parseFloat(cadre.style.height) - voulue) > 1) cadre.style.height = `${voulue}px`;
  },
};

function themeGraphiques() {
  const d = Chart.defaults;
  d.color = GRIS;
  d.borderColor = 'rgba(48,54,61,.6)';            /* grille : filets pleins, discrets */
  d.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  d.font.size = 11.5;
  /* On modifie l'objet par défaut sans le remplacer : Chart.js lit ses clés
     pour configurer chaque animation (un objet partiel casse le rendu). */
  if (SANS_ANIMATION) d.animation = false;
  else { d.animation.duration = 320; d.animation.easing = 'easeOutCubic'; }
  d.elements.line.borderWidth = 2;
  d.elements.line.borderJoinStyle = 'round';
  d.elements.line.borderCapStyle = 'round';
  d.elements.line.tension = 0.3;
  d.elements.point.radius = 0;
  d.elements.point.hoverRadius = 5;
  d.elements.point.hoverBorderWidth = 2;
  d.elements.point.hoverBorderColor = SURFACE;    /* liseré de surface */
  Object.assign(d.plugins.tooltip, {
    backgroundColor: '#1c222b', borderColor: '#353d49', borderWidth: 1,
    titleColor: '#e6edf3', bodyColor: '#e6edf3', footerColor: GRIS,
    titleFont: { weight: '600', size: 12 }, bodyFont: { size: 12 },
    padding: 12, cornerRadius: 10, boxPadding: 6, caretSize: 5, usePointStyle: true,
  });
  Object.assign(d.plugins.legend.labels, {
    color: '#c2ccd6', usePointStyle: true, pointStyleWidth: 22, boxHeight: 7, padding: 16,
  });
  d.interaction.mode = 'index';      /* une infobulle par année, toutes séries */
  d.interaction.intersect = false;
  Chart.register(reticule, hauteurTrace);
}

/** Aplat dégradé sous une courbe : la teinte de la série, de ~20 % à 0 %. */
function degrade(rgb, haut = 0.22) {
  return ctx => {
    const zone = ctx.chart.chartArea;
    if (!zone) return `rgba(${rgb},.1)`;       /* avant la première mise en page */
    const g = ctx.chart.ctx.createLinearGradient(0, zone.top, 0, zone.bottom);
    g.addColorStop(0, `rgba(${rgb},${haut})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    return g;
  };
}

/* Axe des montants : « 0 € », « 50 k€ », « 1,2 M€ » */
const axeEuros = v =>
  v >= 1e6 ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`
  : v >= 1e3 ? `${Math.round(v / 1e3)} k€`
  : `${Math.round(v)} €`;

/* Options communes aux courbes annuelles */
function optionsCourbe() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          /* La légende reprend la forme de la marque : trait plein ou tirets */
          generateLabels: chart => chart.data.datasets
            .map((ds, i) => ({
              text: ds.label, datasetIndex: i, fontColor: '#c2ccd6',
              hidden: !chart.isDatasetVisible(i),
              pointStyle: 'line',
              strokeStyle: ds.borderColor, fillStyle: ds.borderColor,
              lineWidth: 2, lineDash: ds.borderDash || [],
            }))
            /* Une série vide et masquée (complément, comparaison) n'encombre pas la légende */
            .filter(l => !(l.hidden && !(chart.data.datasets[l.datasetIndex].data || []).length)),
        },
      },
      tooltip: {
        callbacks: {
          /* La valeur d'abord, le nom de la série ensuite */
          label: ctx => (ctx.parsed.y == null ? null : ` ${fmt(ctx.parsed.y)}  ${ctx.dataset.label}`),
          labelPointStyle: () => ({ pointStyle: 'line', rotation: 0 }),
          labelColor: ctx => ({ borderColor: ctx.dataset.borderColor, backgroundColor: ctx.dataset.borderColor, borderWidth: 2 }),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: '#353d49' },
        ticks: { maxTicksLimit: 10, maxRotation: 0, autoSkipPadding: 10 },
      },
      y: {
        beginAtZero: true,
        grid: { drawTicks: false },
        border: { display: false },
        ticks: { padding: 8, maxTicksLimit: 6, callback: axeEuros },
      },
    },
  };
}

/* ── Comparaison de scénarios ─────────────────────────────── */
function addComparisonLine(totL, yrs, nom) {
  _comparisonData = { totL, yrs, nom };
  if (!chartGrowth) return;
  const ds = chartGrowth.data.datasets;
  ds[5].label  = `Comparaison : ${nom}`;
  ds[5].data   = totL;
  ds[5].hidden = false;
  chartGrowth.update();
}

function removeComparisonLine() {
  _comparisonData = null;
  if (!chartGrowth) return;
  const ds = chartGrowth.data.datasets;
  ds[5].data   = [];
  ds[5].hidden = true;
  chartGrowth.update();
}

function initCharts() {
  /* Chart.js vient d'un CDN : hors connexion et sans copie en cache, la page
     doit rester utilisable — chiffres, tableau et réglages n'en dépendent
     pas. On le dit à la place de chaque graphique. */
  if (typeof Chart === 'undefined') {
    document.querySelectorAll('.chart-wrap').forEach(zone => {
      zone.innerHTML = '<p class="chart-indispo">Graphique indisponible : la bibliothèque Chart.js n\'a pas pu être chargée (hors connexion ?).<br>Les chiffres et le tableau restent exacts.</p>';
    });
    return;
  }
  themeGraphiques();

  /* ── Courbes de croissance ── */
  chartGrowth = new Chart(document.getElementById('chartGrowth'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Capital nominal PEA',
          data: [], borderColor: SERIES[0], backgroundColor: degrade(SERIE_1_RGB),
          pointBackgroundColor: SERIES[0], fill: true, order: 2,
        },
        {
          label: "Valeur réelle (pouvoir d'achat)",
          data: [], borderColor: SERIES[1], pointBackgroundColor: SERIES[1],
          fill: false, borderWidth: 1.5, borderDash: [6, 4], order: 3,
        },
        {
          label: 'Total versé (PEA)',
          data: [], borderColor: GRIS, pointBackgroundColor: GRIS,
          fill: false, tension: 0, borderWidth: 1.5, borderDash: [3, 3], order: 4,
        },
        {
          label: 'Capital complémentaire (au-delà du PEA)',
          data: [], borderColor: SERIES[2], pointBackgroundColor: SERIES[2],
          fill: false, borderWidth: 1.5, order: 5,
          hidden: true,
        },
        {
          label: 'Plan constant (sans phases)',
          data: [], borderColor: 'rgba(139,148,158,.6)', pointBackgroundColor: GRIS,
          fill: false, borderWidth: 1.5, borderDash: [2, 5], order: 6,
          hidden: true,
        },
        {
          label: 'Comparaison',
          data: [], borderColor: SERIES[3], pointBackgroundColor: SERIES[3],
          fill: false, borderDash: [8, 4], order: 1,
          hidden: true,
        },
      ],
    },
    options: optionsCourbe(),
    plugins: [
    {
      id: 'phase-zones',
      /* Zones de fond colorées pour chaque phase, dessinées avant les datasets */
      beforeDatasetsDraw(ch) {
        if (!ch._phases || !ch._phases.length || !ch.data.labels.length) return;
        const { ctx, chartArea, scales } = ch;
        const n = ch.data.labels.length;
        const step = n > 1 ? chartArea.width / (n - 1) : chartArea.width;

        ch._phases.forEach((ph, i) => {
          const color  = PHASE_PALETTE[i % PHASE_PALETTE.length];
          const iStart = Math.max(0, ph.anneeDebut - 1);
          const iEnd   = Math.min(n - 1, ph.anneeFin - 1);
          if (iStart > n - 1) return;

          const x0 = scales.x.getPixelForValue(iStart) - step / 2;
          const x1 = scales.x.getPixelForValue(iEnd)   + step / 2;
          const xL = Math.max(x0, chartArea.left);
          const xR = Math.min(x1, chartArea.right);
          if (xL >= xR) return;

          ctx.save();
          ctx.fillStyle = color.bg;
          ctx.fillRect(xL, chartArea.top, xR - xL, chartArea.bottom - chartArea.top);

          // Libellé de phase, seulement s'il tient dans sa zone : deux phases
          // d'un an côte à côte se chevaucheraient (le détail reste lisible
          // dans les cartes de phases et dans le tableau).
          const label = ph.label || `Phase ${i + 1}`;
          ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif';
          if (ctx.measureText(label).width + 8 <= xR - xL) {
            ctx.fillStyle = color.bar;
            ctx.textAlign = 'center';
            ctx.globalAlpha = 0.9;
            ctx.fillText(label, (xL + xR) / 2, chartArea.top + 14);
            ctx.globalAlpha = 1;
          }
          ctx.restore();
        });
      },
    },
    {
      id: 'plafond-line',
      /* Ligne verticale pointillée dorée à l'année d'atteinte du plafond */
      afterDraw(ch) {
        if (ch._plafondIdx == null) return;
        const { ctx, chartArea, scales } = ch;
        const xPos = scales.x.getPixelForValue(ch._plafondIdx);
        if (xPos < chartArea.left || xPos > chartArea.right) return;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(210,153,34,.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xPos, chartArea.top);
        ctx.lineTo(xPos, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(210,153,34,.95)';
        ctx.font = '600 10.5px system-ui, -apple-system, "Segoe UI", sans-serif';
        /* L'étiquette reste dans le graphique, même tout au bord */
        const texte = ch._plafondIdx === 0 ? 'Plafond (départ)' : `Plafond an ${ch._plafondIdx + 1}`;
        const demi = ctx.measureText(texte).width / 2;
        ctx.textAlign = 'center';
        /* Sous la rangée des libellés de phases, quand il y en a */
        const y = chartArea.top + (ch._phases && ch._phases.length ? 29 : 13);
        ctx.fillText(texte, Math.min(Math.max(xPos, chartArea.left + demi + 2), chartArea.right - demi - 2), y);
        ctx.restore();
      },
    }],
  });
}

/* ── Phase de rente (décumulation) ───────────────────────── */

let chartRente = null;

/**
 * Met à jour (et crée au premier appel) la courbe de décumulation :
 * capital PEA restant vs retraits nets cumulés, année par année.
 * Création paresseuse : le canvas vit dans une section repliée par défaut.
 * @param {Object|null} res - Résultat de computeRente(), ou null pour vider
 */
function updateRenteChart(res) {
  const el = document.getElementById('chartRente');
  if (!el) return;
  if (!res) {
    if (chartRente) {
      chartRente.data.labels = [];
      chartRente.data.datasets.forEach(ds => { ds.data = []; });
      chartRente.update();
    }
    return;
  }

  if (!chartRente) {
    chartRente = new Chart(el, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Capital PEA restant',
            data: [], borderColor: SERIES[0], backgroundColor: degrade(SERIE_1_RGB),
            pointBackgroundColor: SERIES[0], fill: true,
          },
          {
            label: 'Retraits nets cumulés',
            data: [], borderColor: SERIES[1], pointBackgroundColor: SERIES[1],
            fill: false, tension: 0, borderWidth: 1.5, borderDash: [4, 3],
          },
        ],
      },
      options: optionsCourbe(),
    });
  }

  const cumRetraits = [];
  res.retraitL.reduce((s, v, i) => (cumRetraits[i] = s + v, s + v), 0);

  chartRente.data.labels           = res.capL.map((_, i) => `An +${i + 1}`);
  chartRente.data.datasets[0].data = res.capL;
  chartRente.data.datasets[1].data = cumRetraits;
  chartRente.update();
}

/* ── Éventail Monte Carlo ────────────────────────────────── */

let chartMC = null;

/**
 * Met à jour (et crée au premier appel) l'éventail Monte Carlo :
 * bande p10→p90 et médiane dans une même teinte, plan déterministe et
 * versements en repères.
 * @param {Object|null} res  - Résultat de computeMonteCarlo(), ou null pour vider
 * @param {Array}       totL - Courbe déterministe (compute().totL) en référence
 */
function updateMCChart(res, totL = []) {
  const el = document.getElementById('chartMC');
  if (!el) return;
  if (!res) {
    if (chartMC) {
      chartMC.data.labels = [];
      chartMC.data.datasets.forEach(ds => { ds.data = []; });
      chartMC.update();
    }
    return;
  }

  if (!chartMC) {
    const bord = `rgba(${SERIE_1_RGB},.55)`;
    chartMC = new Chart(el, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Optimiste (90 %)',
            data: [], borderColor: bord, pointBackgroundColor: SERIES[0],
            fill: false, borderWidth: 1,
          },
          {
            /* L'aplat entre cette courbe et la précédente : 80 % des trajectoires */
            label: 'Pessimiste (10 %)',
            data: [], borderColor: bord, backgroundColor: `rgba(${SERIE_1_RGB},.13)`,
            pointBackgroundColor: SERIES[0], fill: '-1', borderWidth: 1,
          },
          {
            label: 'Médiane (50 %)',
            data: [], borderColor: SERIES[0], pointBackgroundColor: SERIES[0],
            fill: false, borderWidth: 2.5,
          },
          {
            label: 'Plan à rendement fixe',
            data: [], borderColor: SERIES[1], pointBackgroundColor: SERIES[1],
            fill: false, borderWidth: 1.5, borderDash: [5, 4],
          },
          {
            label: 'Total versé',
            data: [], borderColor: GRIS, pointBackgroundColor: GRIS,
            fill: false, tension: 0, borderWidth: 1.5, borderDash: [2, 4],
          },
        ],
      },
      options: optionsCourbe(),
    });
  }

  chartMC.data.labels           = res.yrs.map(y => `An ${y}`);
  chartMC.data.datasets[0].data = res.p90;
  chartMC.data.datasets[1].data = res.p10;
  chartMC.data.datasets[2].data = res.p50;
  chartMC.data.datasets[3].data = totL.slice(0, res.yrs.length);
  chartMC.data.datasets[4].data = res.verséL;
  chartMC.update();
}

/**
 * Met à jour la courbe de croissance avec les nouvelles données de simulation.
 * @param {Object}      data     - Résultat de compute() avec phases actives
 * @param {Object|null} dataBase - Résultat de compute() sans phases (courbe de comparaison)
 * @param {Array}       phases   - Phases de vie (pour les zones de fond colorées)
 */
function updateCharts(data, dataBase = null, phases = []) {
  if (!chartGrowth) return;   // Chart.js indisponible : voir initCharts()
  chartGrowth.data.labels           = data.yrs.map(y => `An ${y}`);
  chartGrowth.data.datasets[0].data = data.totL;
  chartGrowth.data.datasets[1].data = data.reelL;
  chartGrowth.data.datasets[2].data = data.versL;

  // 4e courbe : enveloppe complémentaire
  const auDela = (data.capAuDelaL || []).map(v => (v > 0 ? v : null));
  const avecAuDela = auDela.some(v => v != null);
  chartGrowth.data.datasets[3].data   = avecAuDela ? auDela : [];
  chartGrowth.data.datasets[3].hidden = !avecAuDela;

  // 5e courbe : plan constant (pointillé gris), visible seulement s'il y a une personnalisation
  const hasBase = dataBase != null;
  chartGrowth.data.datasets[4].data   = hasBase ? dataBase.totL : [];
  chartGrowth.data.datasets[4].hidden = !hasBase;

  // Ligne plafond
  chartGrowth._plafondIdx =
    data.plafondAn != null ? (data.plafondAn === 0 ? 0 : data.plafondAn - 1) : null;

  // Zones de phase (transmises au plugin phase-zones via propriété du chart)
  chartGrowth._phases = phases;

  // Maintenir la ligne de comparaison si une comparaison est active (avant update)
  if (_comparisonData) {
    chartGrowth.data.datasets[5].data   = _comparisonData.totL;
    chartGrowth.data.datasets[5].hidden = false;
  }

  chartGrowth.update();
}
