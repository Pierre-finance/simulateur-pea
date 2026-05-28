'use strict';

/* ─────────────────────────────────────────────────────────────
   charts.js — Initialisation et mise à jour des graphiques
   Dépendances : Chart.js (CDN), fmt() depuis simulation.js
───────────────────────────────────────────────────────────── */

const TT = {
  backgroundColor: '#161b22',
  borderColor:     '#21262d',
  borderWidth: 1,
  padding: 12,
};

let _curFinal = 0;
let chartGrowth = null;
let chartDonut  = null;

function initCharts() {
  Chart.defaults.color       = '#8b949e';
  Chart.defaults.font.family = '-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
  Chart.defaults.font.size   = 12;

  /* ── Graphique 1 : courbes de croissance ── */
  chartGrowth = new Chart(document.getElementById('chartGrowth'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Capital nominal PEA',
          data: [], borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,.07)',
          fill: true, tension: .35, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
        },
        {
          label: "Valeur réelle (pouvoir d'achat)",
          data: [], borderColor: '#2ea8c4', backgroundColor: 'transparent',
          fill: false, tension: .35, borderWidth: 1.5, borderDash: [6, 4],
          pointRadius: 0, pointHoverRadius: 4,
        },
        {
          label: 'Total versé (PEA)',
          data: [], borderColor: '#58a6ff', backgroundColor: 'transparent',
          fill: false, tension: 0, borderWidth: 1.5, borderDash: [3, 3],
          pointRadius: 0, pointHoverRadius: 4,
        },
        {
          label: 'Capital complémentaire (au-delà du PEA)',
          data: [], borderColor: '#d29922', backgroundColor: 'rgba(210,153,34,.06)',
          fill: true, tension: .35, borderWidth: 1.5, borderDash: [4, 3],
          pointRadius: 0, pointHoverRadius: 4,
          hidden: true,
        },
        {
          label: 'Scénario constant (sans phases)',
          data: [], borderColor: 'rgba(139,148,158,.5)', backgroundColor: 'transparent',
          fill: false, tension: .35, borderWidth: 1.5, borderDash: [2, 5],
          pointRadius: 0, pointHoverRadius: 3,
          hidden: true,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 22, padding: 14, usePointStyle: true, pointStyleWidth: 18 },
        },
        tooltip: {
          ...TT,
          callbacks: {
            label: ctx => {
              if (ctx.parsed.y == null) return null;
              return ` ${ctx.dataset.label} : ${fmt(ctx.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(33,38,45,.8)' }, ticks: { maxTicksLimit: 10 } },
        y: {
          grid: { color: 'rgba(33,38,45,.8)' },
          ticks: {
            callback: v =>
              v >= 1e6 ? `${(v / 1e6).toFixed(1)}M €` :
              v >= 1e3 ? `${(v / 1e3).toFixed(0)}k €` : `${v} €`,
          },
        },
      },
    },
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

          // Libellé de phase si la zone est assez large
          if (xR - xL > 35) {
            const label = ph.label || `Phase ${i + 1}`;
            ctx.fillStyle = color.bar;
            ctx.font = 'bold 9px -apple-system,sans-serif';
            ctx.textAlign = 'center';
            ctx.globalAlpha = 0.85;
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
        ctx.strokeStyle = 'rgba(210,153,34,.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xPos, chartArea.top);
        ctx.lineTo(xPos, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(210,153,34,.9)';
        ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          ch._plafondIdx === 0 ? 'Plafond (départ)' : `Plafond an ${ch._plafondIdx + 1}`,
          xPos, chartArea.top + 13,
        );
        ctx.restore();
      },
    }],
  });
  /* ── Graphique 2 : donut ── */
  chartDonut = new Chart(document.getElementById('chartDoughnut'), {
    type: 'doughnut',
    data: {
      labels: ['Capital versé', 'Plus-value'],
      datasets: [{
        data: [0, 0],
        backgroundColor: ['rgba(88,166,255,.85)', 'rgba(210,153,34,.85)'],
        borderColor:     ['rgba(88,166,255,1)',    'rgba(210,153,34,1)'],
        borderWidth: 2, hoverOffset: 10,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 }, cutout: '72%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
        tooltip: {
          ...TT,
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
              return ` ${ctx.label} : ${fmt(ctx.parsed)} (${pct} %)`;
            },
          },
        },
      },
    },
    plugins: [{
      id: 'center-text',
      afterDraw(ch) {
        const { ctx, chartArea: { width, height, top } } = ch;
        ctx.save();
        const cx = width / 2, cy = top + height / 2;
        const fs = Math.max(12, Math.min(18, width * .085));
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e6edf3';
        ctx.font = `bold ${fs}px -apple-system,sans-serif`;
        ctx.fillText(fmt(_curFinal), cx, cy - 3);
        ctx.fillStyle = '#8b949e';
        ctx.font = `${Math.max(9, fs * .65)}px -apple-system,sans-serif`;
        ctx.fillText('capital PEA', cx, cy + fs * .9);
        ctx.restore();
      },
    }],
  });
}

/**
 * Met à jour les deux graphiques avec les nouvelles données de simulation.
 * @param {Object}      data     - Résultat de compute() avec phases actives
 * @param {Object|null} dataBase - Résultat de compute() sans phases (courbe de comparaison)
 * @param {Array}       phases   - Phases de vie (pour les zones de fond colorées)
 */
function updateCharts(data, dataBase = null, phases = []) {
  _curFinal = data.final;

  chartGrowth.data.labels           = data.yrs.map(y => `An ${y}`);
  chartGrowth.data.datasets[0].data = data.totL;
  chartGrowth.data.datasets[1].data = data.reelL;
  chartGrowth.data.datasets[2].data = data.versL;

  // 4e courbe : enveloppe complémentaire
  const auDelaData = (data.capAuDelaL || []).map(v => v > 0 ? v : null);
  chartGrowth.data.datasets[3].data   = auDelaData;
  chartGrowth.data.datasets[3].hidden = !auDelaData.some(v => v != null);

  // 5e courbe : scénario constant (pointillé gris), visible seulement si phases définies
  const hasPhases = phases.length > 0 && dataBase != null;
  chartGrowth.data.datasets[4].data   = hasPhases ? dataBase.totL : [];
  chartGrowth.data.datasets[4].hidden = !hasPhases;

  // Ligne plafond
  chartGrowth._plafondIdx =
    data.plafondAn != null ? (data.plafondAn === 0 ? 0 : data.plafondAn - 1) : null;

  // Zones de phase (transmises au plugin phase-zones via propriété du chart)
  chartGrowth._phases = phases;

  chartGrowth.update();

  chartDonut.data.datasets[0].data = [data.versé, data.gain];
  chartDonut.update();
}
