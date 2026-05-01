'use strict';

let currentData = null;       // last results payload
let activeTab = 'results';
let freqChart = null;
let bonusChart = null;
let dowChart = null;
let decadeChart = null;
let paypalInitialized = false;

// ── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 90);
  document.getElementById('end-date').value = fmtDate(today);
  document.getElementById('start-date').value = fmtDate(monthAgo);
  document.getElementById('game-select').addEventListener('change', updateTheme);
  updateTheme();
});

function fmtDate(d) { return d.toISOString().split('T')[0]; }

function updateTheme() {
  const game = document.getElementById('game-select').value;
  document.body.className = game === 'lotto-649' ? 'theme-649' : '';
}

function updateSuggestTheme() {
  const game = document.getElementById('suggest-game-select').value;
  document.body.className = game === 'lotto-649' ? 'theme-649' : '';
}

// ── Tabs ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');

  // Hide main controls on Suggestion tab; show otherwise
  document.getElementById('main-controls').classList.toggle('hidden', tab === 'predict');

  // Sync suggest game selector theme when entering Suggestion tab
  if (tab === 'predict') {
    updateSuggestTheme();
    // Init PayPal button lazily once the SDK has loaded
    if (!paypalInitialized) {
      if (typeof paypal !== 'undefined') {
        initPayPalButton();
      } else {
        // SDK may still be loading — wait up to 5 s
        const tries = 20;
        let n = 0;
        const check = setInterval(() => {
          if (typeof paypal !== 'undefined') { clearInterval(check); initPayPalButton(); }
          else if (++n >= tries) clearInterval(check);
        }, 250);
      }
    }
  }
}

// ── Quick range ───────────────────────────────────────────────────────────
function setRange(days) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  document.getElementById('start-date').value = fmtDate(start);
  document.getElementById('end-date').value = fmtDate(today);
}

// ── Central search dispatcher (Results + Dashboard only) ──────────────────
function runSearch() {
  if (activeTab === 'results') loadResults();
  else if (activeTab === 'dashboard') loadDashboard();
}

// ── PayPal donate button ──────────────────────────────────────────────────
async function captureAndReveal(orderID) {
  showLoading(true);
  try {
    const resp = await fetch('/api/capture-donation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderID }),
    });
    const result = await resp.json();
    if (result.success) {
      await loadPredict();
    } else {
      showSuggestError('Payment was not completed. Please try again.');
    }
  } catch {
    showSuggestError('Network error during payment. Please try again.');
  } finally {
    showLoading(false);
  }
}

function initPayPalButton() {
  paypalInitialized = true;

  const orderConfig = () => ({
    purchase_units: [{ amount: { value: '2.00', currency_code: 'CAD' } }]
  });
  const onErr = () => showSuggestError('Payment could not be completed. Please try again.');

  // PayPal button (vertical layout auto-includes card via enable-funding=card in SDK URL)
  paypal.Buttons({
    style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'donate', tagline: false },
    createOrder: (data, actions) => actions.order.create(orderConfig()),
    onApprove: (data) => captureAndReveal(data.orderID),
    onError: onErr,
  }).render('#paypal-button-container');
}

// ══════════════════════════════════════════════════════════════════════════
// RESULTS TAB
// ══════════════════════════════════════════════════════════════════════════
async function loadResults() {
  const game = document.getElementById('game-select').value;
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  if (!start || !end) { showError('Please select a start and end date.'); return; }
  if (start > end) { showError('Start date must be before end date.'); return; }

  showLoading(true);
  hideAll();
  try {
    const resp = await fetch('/api/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_type: game, start_date: start, end_date: end }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    currentData = { game_type: game, start_date: start, end_date: end };
    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function renderResults(data) {
  const { game, game_type, draws, count } = data;
  const isMax = game_type === 'lotto-max';

  document.getElementById('results-title').textContent = `${game} Results`;
  document.getElementById('results-count').textContent = `${count} draw${count !== 1 ? 's' : ''}`;

  const headers = isMax
    ? ['Date', 'Day', 'Time', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'Bonus', 'EXTRA', 'Jackpot']
    : ['Date', 'Day', 'Time', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'Bonus', 'EXTRA', 'Raffle #', 'Jackpot'];
  document.getElementById('table-head').innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

  const tbody = document.getElementById('table-body');
  if (count === 0) {
    tbody.innerHTML = '';
    document.getElementById('empty-state').classList.remove('hidden');
    return;
  }

  tbody.innerHTML = draws.map(draw => {
    const nums = draw.main_numbers;
    const expected = isMax ? 7 : 6;
    const numCells = Array.from({ length: expected }, (_, i) =>
      `<td>${nums[i] !== undefined ? `<span class="ball ball-main">${nums[i]}</span>` : '—'}</td>`
    ).join('');
    const bonus = draw.bonus ? `<span class="ball ball-bonus">${draw.bonus}</span>` : '—';
    const extra = draw.extra ? `<span class="extra-num">${draw.extra}</span>` : '—';
    const jackpot = draw.jackpot ? `$${Number(draw.jackpot).toLocaleString('en-CA', { maximumFractionDigits: 0 })}` : '—';
    const tail = isMax
      ? `<td>${bonus}</td><td>${extra}</td><td class="jackpot-cell">${jackpot}</td>`
      : `<td>${bonus}</td><td>${extra}</td><td>${draw.raffle ? `<span class="raffle-cell">${draw.raffle}</span>` : '—'}</td><td class="jackpot-cell">${jackpot}</td>`;
    return `<tr><td>${draw.date}</td><td>${draw.day}</td><td>${draw.time}</td>${numCells}${tail}</tr>`;
  }).join('');

  document.getElementById('results-section').classList.remove('hidden');
}

// ── Download ──────────────────────────────────────────────────────────────
async function downloadExcel() {
  if (!currentData) return;
  const btn = document.getElementById('download-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Generating...';
  try {
    const resp = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentData),
    });
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'Download failed'); }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = resp.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    a.download = match ? match[1] : 'lottery_results.xlsx';
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">⬇️</span> Download .xlsx';
  }
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ══════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  const game = document.getElementById('game-select').value;
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  if (!start || !end) { showError('Please select a start and end date.'); return; }
  if (start > end) { showError('Start date must be before end date.'); return; }

  showLoading(true);
  hideDash();
  try {
    const resp = await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_type: game, start_date: start, end_date: end }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    currentData = { game_type: game, start_date: start, end_date: end };
    renderDashboard(data);
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function renderDashboard(data) {
  if (data.total_draws === 0) {
    document.getElementById('dash-empty').classList.remove('hidden');
    return;
  }

  const isMax = data.game_type === 'lotto-max';
  const maxNum = isMax ? 50 : 49;
  const isPrimary = isMax;
  const primaryColor = isMax ? '#1a6b2a' : '#1a3a8f';
  const primaryLight = isMax ? 'rgba(26,107,42,.15)' : 'rgba(26,58,143,.15)';

  // ── KPI cards ──
  document.getElementById('kpi-draws').textContent = data.total_draws;
  document.getElementById('kpi-hottest').textContent = data.hot[0]?.number ?? '—';
  document.getElementById('kpi-coldest').textContent = data.cold[0]?.number ?? '—';
  document.getElementById('kpi-overdue').textContent = data.overdue[0]?.number ?? '—';
  document.getElementById('kpi-row').classList.remove('hidden');

  // ── Frequency bar chart ──
  const freqLabels = Array.from({ length: maxNum }, (_, i) => String(i + 1));
  const freqValues = freqLabels.map(n => data.main_freq[n] || 0);
  const maxFreq = Math.max(...freqValues);

  // Color bars: hot→green, cold→blue gradient
  const barColors = freqValues.map(v => {
    const ratio = maxFreq > 0 ? v / maxFreq : 0;
    if (isMax) return `rgba(${Math.round(255 - ratio * 180)}, ${Math.round(100 + ratio * 100)}, ${Math.round(42 + ratio * 20)}, 0.85)`;
    return `rgba(${Math.round(100 - ratio * 60)}, ${Math.round(110 + ratio * 90)}, ${Math.round(143 + ratio * 100)}, 0.85)`;
  });

  document.getElementById('freq-subtitle').textContent =
    `${data.total_draws} draws · ${data.start_date} – ${data.end_date}`;

  destroyChart('freqChart', freqChart);
  freqChart = new Chart(document.getElementById('freq-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: freqLabels,
      datasets: [{
        label: 'Times drawn',
        data: freqValues,
        backgroundColor: barColors,
        borderColor: barColors.map(c => c.replace('0.85', '1')),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => `Number ${ctx[0].label}`,
            label: ctx => {
              const pct = data.total_draws > 0 ? ((ctx.raw / data.total_draws) * 100).toFixed(1) : 0;
              return ` Drawn ${ctx.raw} time${ctx.raw !== 1 ? 's' : ''} (${pct}% of draws)`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.05)' }, ticks: { precision: 0 } },
      },
    },
  });
  document.getElementById('freq-section').classList.remove('hidden');

  // ── Heatmap grid ──
  buildHeatmap(data, maxNum, isMax);
  document.getElementById('grid-section').classList.remove('hidden');

  // ── Hot / Cold / Overdue lists ──
  buildHcoList('hot-list', data.hot, 'hot-num', 'hot-fill', item =>
    `${item.count} draws (${item.pct}%)`, item => item.count / (data.hot[0]?.count || 1) * 100);
  buildHcoList('cold-list', data.cold, 'cold-num', 'cold-fill', item =>
    `${item.count} draws (${item.pct}%)`, item => item.count / (data.hot[0]?.count || 1) * 100);
  buildHcoList('overdue-list', data.overdue, 'overdue-num', 'overdue-fill',
    item => `${item.draws_ago} draw${item.draws_ago !== 1 ? 's' : ''} ago`,
    item => item.draws_ago / (data.overdue[0]?.draws_ago || 1) * 100);
  document.getElementById('hco-row').classList.remove('hidden');

  // ── Bonus chart ──
  const bonusSorted = Object.entries(data.bonus_freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
  destroyChart('bonusChart', bonusChart);
  bonusChart = new Chart(document.getElementById('bonus-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: bonusSorted.map(x => x[0]),
      datasets: [{
        label: 'As bonus',
        data: bonusSorted.map(x => x[1]),
        backgroundColor: 'rgba(243,156,18,.8)',
        borderColor: 'rgba(230,126,34,1)',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });

  // ── Day of week chart ──
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dowLabels = dayOrder.filter(d => data.dow_counts[d] !== undefined);
  const dowVals = dowLabels.map(d => data.dow_counts[d] || 0);
  destroyChart('dowChart', dowChart);
  dowChart = new Chart(document.getElementById('dow-chart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: dowLabels.map(d => d.slice(0, 3)),
      datasets: [{
        data: dowVals,
        backgroundColor: ['#4caf50','#2196f3','#ff9800','#9c27b0','#e91e63','#00bcd4','#ff5722'],
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} draws` } },
      },
    },
  });

  // ── Decades chart ──
  const decadeLabels = Object.keys(data.decades);
  const decadeVals = Object.values(data.decades);
  destroyChart('decadeChart', decadeChart);
  decadeChart = new Chart(document.getElementById('decade-chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: decadeLabels,
      datasets: [
        {
          label: 'Actual',
          data: decadeVals,
          backgroundColor: `${primaryColor}cc`,
          borderColor: primaryColor,
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Expected',
          data: decadeLabels.map(() => data.expected_per_decade),
          type: 'line',
          borderColor: '#e53935',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${Math.round(ctx.raw)}` } },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });

  document.getElementById('bottom-row').classList.remove('hidden');
}

function buildHeatmap(data, maxNum, isMax) {
  const grid = document.getElementById('number-grid');
  grid.innerHTML = '';
  const freqValues = Object.values(data.main_freq);
  const maxFreq = Math.max(...freqValues);
  const minFreq = Math.min(...freqValues);
  const range = maxFreq - minFreq || 1;

  for (let n = 1; n <= maxNum; n++) {
    const key = String(n);
    const freq = data.main_freq[key] || 0;
    const ratio = (freq - minFreq) / range;
    const isBonus = data.bonus_freq[key] > 0;
    const cell = document.createElement('div');
    cell.className = 'grid-cell' + (isBonus ? ' has-bonus' : '');
    cell.textContent = n;
    cell.title = `#${n}: drawn ${freq} time${freq !== 1 ? 's' : ''}${isBonus ? ` · bonus ${data.bonus_freq[key]}×` : ''}`;

    if (isMax) {
      const r = Math.round(20 + (1 - ratio) * 180);
      const g = Math.round(60 + ratio * 130);
      const b = Math.round(40 + (1 - ratio) * 60);
      cell.style.background = `rgb(${r},${g},${b})`;
    } else {
      const r = Math.round(26 + (1 - ratio) * 150);
      const g = Math.round(58 + ratio * 100);
      const b = Math.round(143 + ratio * 100);
      cell.style.background = `rgb(${r},${g},${b})`;
    }
    grid.appendChild(cell);
  }
}

function buildHcoList(containerId, items, numClass, fillClass, labelFn, widthFn) {
  const el = document.getElementById(containerId);
  el.innerHTML = items.map(item => `
    <div class="hco-item">
      <div class="hco-num ${numClass}">${item.number}</div>
      <div class="hco-bar-wrap">
        <div class="hco-bar-label">
          <span>${labelFn(item)}</span>
        </div>
        <div class="hco-bar-track">
          <div class="hco-bar-fill ${fillClass}" style="width:${Math.min(100, widthFn(item))}%"></div>
        </div>
      </div>
    </div>`).join('');
}

function destroyChart(name, ref) {
  if (ref) { ref.destroy(); }
}

// ══════════════════════════════════════════════════════════════════════════
// SUGGESTION TAB
// ══════════════════════════════════════════════════════════════════════════
async function loadPredict() {
  const game = document.getElementById('suggest-game-select').value;

  showLoading(true);
  hidePredict();
  try {
    const resp = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_type: game }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Unknown error');
    renderPredict(data);
  } catch (err) {
    showSuggestError(err.message);
  } finally {
    showLoading(false);
  }
}

function renderPredict(data) {
  const setEmojis = ['🥇', '🥈', '🥉'];
  const setStrategies = [
    'Top hottest numbers not in last 2 draws',
    'Second tier hottest numbers',
    'Third tier hottest numbers',
  ];

  // ── Info bar ──
  document.getElementById('suggest-info-bar').classList.remove('hidden');

  // ── Prediction cards ──
  const cardsEl = document.getElementById('predict-cards');
  cardsEl.innerHTML = data.sets.map((set, i) => {
    const balls = set.numbers.map(n =>
      `<span class="pred-ball">${n}</span>`
    ).join('');
    const bonusBall = set.bonus
      ? `<span class="pred-ball pred-ball-bonus" title="Suggested bonus">${set.bonus}</span>`
      : '';
    return `
      <div class="pred-card pred-card-${i + 1}">
        <div class="pred-card-header">
          <span class="pred-emoji">${setEmojis[i]}</span>
          <div>
            <div class="pred-label">${set.label}</div>
            <div class="pred-strategy">${setStrategies[i]}</div>
          </div>
        </div>
        <div class="pred-balls-wrap">
          <div class="pred-balls">${balls}</div>
          ${set.bonus ? `
          <div class="pred-bonus-row">
            <span class="pred-bonus-label">Bonus</span>
            ${bonusBall}
          </div>` : ''}
        </div>
        <div class="pred-meta">
          ${set.numbers.length} main numbers
          ${set.bonus ? '+ 1 bonus suggestion' : ''}
        </div>
      </div>`;
  }).join('');
  cardsEl.classList.remove('hidden');

  // ── Last 2 draws / excluded ──
  const exclDraws = document.getElementById('predict-excluded-draws');
  exclDraws.innerHTML = data.last2_draws.map((draw, i) => {
    const nums = draw.main_numbers.map(n => {
      const hit = data.excluded_main.includes(n);
      return `<span class="excl-ball ${hit ? 'excl-ball-hit' : ''}" title="${hit ? 'Excluded' : ''}">${n}</span>`;
    }).join('');
    const bonus = draw.bonus
      ? `<span class="excl-sep">+</span><span class="excl-ball ${data.excluded_bonus.includes(draw.bonus) ? 'excl-bonus excl-ball-hit' : 'excl-bonus'}">${draw.bonus}</span>`
      : '';
    return `
      <div class="excl-draw">
        <div class="excl-draw-meta">Draw ${i + 1} — <strong>${draw.date}</strong> (${draw.day})</div>
        <div class="excl-balls-row">${nums}${bonus}</div>
      </div>`;
  }).join('');
  document.getElementById('predict-excluded-section').classList.remove('hidden');

  // ── Frequency reference bars ──
  document.getElementById('predict-freq-sub').textContent =
    `${data.total_draws} draws · ${data.start_date} → ${data.end_date}`;

  const allDetails = data.sets.flatMap(s => s.details || []);
  const seen = new Set();
  const dedupedDetails = allDetails.filter(d => {
    if (seen.has(d.number)) return false;
    seen.add(d.number); return true;
  });
  dedupedDetails.sort((a, b) => b.count - a.count || parseInt(a.number) - parseInt(b.number));

  const maxCount = dedupedDetails[0]?.count || 1;
  const freqBars = document.getElementById('predict-freq-bars');
  freqBars.innerHTML = dedupedDetails.map(item => {
    const widthPct = (item.count / maxCount * 100).toFixed(1);
    const isExcl = data.excluded_main.includes(item.number);
    const tags = data.sets.map((s, i) => {
      const letter = String.fromCharCode(65 + i);
      return s.numbers.includes(item.number)
        ? `<span class="freq-tag tag-${letter.toLowerCase()}">${letter}</span>` : '';
    }).join('');
    return `
      <div class="freq-row ${isExcl ? 'freq-row-excl' : ''}">
        <span class="freq-num">${item.number}</span>
        <div class="freq-track">
          <div class="freq-fill ${isExcl ? 'fill-excl' : ''}" style="width:${widthPct}%"></div>
        </div>
        <span class="freq-count">${item.count}×</span>
        <span class="freq-pct">${item.pct}%</span>
        <span class="freq-tags">${tags}</span>
      </div>`;
  }).join('');
  document.getElementById('predict-freq-section').classList.remove('hidden');
  document.getElementById('predict-disclaimer').classList.remove('hidden');
}

// ── UI helpers ────────────────────────────────────────────────────────────
function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show);
  // search-btn only exists on results/dashboard tabs
  const btn = document.getElementById('search-btn');
  if (btn) btn.disabled = show;
}

function hideAll() {
  ['results-section', 'error-box', 'empty-state'].forEach(id =>
    document.getElementById(id).classList.add('hidden'));
}

function hideDash() {
  ['kpi-row', 'freq-section', 'grid-section', 'hco-row', 'bottom-row', 'dash-empty', 'error-box']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
}

function hidePredict() {
  ['suggest-info-bar', 'predict-cards', 'predict-excluded-section',
   'predict-freq-section', 'predict-disclaimer', 'error-box']
    .forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('error-box').classList.remove('hidden');
}

function showSuggestError(msg) {
  // Show error inline within the suggest tab (error-box is above the tab content)
  showError(msg);
}
