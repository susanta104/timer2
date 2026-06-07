/* ============================================================
   MBBS STUDY COMMAND CENTER — js/charts.js
   All Chart.js chart instances for the app.

   Charts managed:
   ─ chart-week-preview    Dashboard mini bar chart (7 days)
   ─ chart-hours-bar       Analytics hours bar (week/month/year/all)
   ─ chart-subject-pie     Analytics subject distribution pie
   ─ chart-sessions-line   Analytics sessions-per-day line
   ─ chart-subject-donut   Timer section subject donut + legend
   ─ heatmap-container     Analytics activity heatmap (DOM-built, no Chart.js)

   Exposes: window.ChartsModule
   Depends: window.DB, window.StatsModule, Chart (CDN)
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   CHART INSTANCE REGISTRY
   Keeps one instance per canvas so we can destroy-and-recreate
   cleanly on every re-render rather than mutating data arrays.
──────────────────────────────────────────────────────────── */
const _instances = {};

/**
 * Destroy an existing Chart.js instance on a canvas if it exists.
 * @param {string} canvasId
 */
function _destroyChart(canvasId) {
  if (_instances[canvasId]) {
    _instances[canvasId].destroy();
    delete _instances[canvasId];
  }
}

/* ────────────────────────────────────────────────────────────
   THEME HELPERS
   Read CSS custom properties so charts always match the theme.
──────────────────────────────────────────────────────────── */
function _css(prop) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(prop)
    .trim();
}

function _colors() {
  return {
    accent:       _css('--accent')          || '#00d4ff',
    accentDim:    _css('--accent-dim')      || '#0099bb',
    accentGlow:   _css('--accent-glow')     || 'rgba(0,212,255,0.18)',
    amber:        _css('--amber')           || '#ffaa00',
    success:      _css('--success')         || '#00e676',
    textPrimary:  _css('--text-primary')    || '#e8edf8',
    textSecondary:_css('--text-secondary')  || '#8a9bbf',
    textMuted:    _css('--text-muted')      || '#4a5a7a',
    bgElevated:   _css('--bg-elevated')     || '#131929',
    bgOverlay:    _css('--bg-overlay')      || '#1a2138',
    borderSubtle: _css('--border-subtle')   || '#1e2d4a',
    subjectColors: [
      _css('--c1') || '#00d4ff',
      _css('--c2') || '#a78bfa',
      _css('--c3') || '#34d399',
      _css('--c4') || '#fb923c',
      _css('--c5') || '#f472b6',
      _css('--c6') || '#facc15',
      _css('--c7') || '#60a5fa',
      _css('--c8') || '#f87171',
    ],
  };
}

/* ────────────────────────────────────────────────────────────
   SHARED CHART DEFAULTS
──────────────────────────────────────────────────────────── */

/**
 * Build Chart.js global defaults each time we create a chart,
 * so they pick up the current theme (dark / light).
 */
function _applyGlobalDefaults() {
  const c = _colors();

  Chart.defaults.color            = c.textSecondary;
  Chart.defaults.borderColor      = c.borderSubtle;
  Chart.defaults.font.family      = "'Barlow', sans-serif";
  Chart.defaults.font.size        = 12;
  Chart.defaults.plugins.legend.labels.color = c.textSecondary;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.padding  = 16;
}

/**
 * Shared tooltip style applied to every chart.
 */
function _tooltipConfig() {
  const c = _colors();
  return {
    backgroundColor:  c.bgOverlay,
    borderColor:      c.borderSubtle,
    borderWidth:      1,
    titleColor:       c.textPrimary,
    bodyColor:        c.textSecondary,
    padding:          10,
    cornerRadius:     6,
    titleFont:        { family: "'Barlow Condensed', sans-serif", size: 13, weight: '600' },
    bodyFont:         { family: "'Share Tech Mono', monospace", size: 12 },
  };
}

/**
 * Shared grid line style.
 */
function _gridConfig() {
  return {
    color:     _colors().borderSubtle,
    drawBorder: false,
  };
}

/* ────────────────────────────────────────────────────────────
   HELPER: minutes → "Xh Ym" label
──────────────────────────────────────────────────────────── */
function _fmtMins(m) {
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

/* ────────────────────────────────────────────────────────────
   1. DASHBOARD WEEKLY PREVIEW BAR CHART
──────────────────────────────────────────────────────────── */

/**
 * Render a compact 7-day bar chart on the dashboard.
 * @param {string} canvasId
 */
async function renderWeekPreview(canvasId) {
  if (typeof Chart === 'undefined') return;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  _destroyChart(canvasId);
  _applyGlobalDefaults();

  const series = await StatsModule.getDailySeriesForWeek(7);
  const c      = _colors();

  const todayIdx = 6; // last item is today
  const bgColors = series.map((_, i) =>
    i === todayIdx ? c.accent : `${c.accent}55`
  );
  const borderColors = series.map((_, i) =>
    i === todayIdx ? c.accent : `${c.accent}88`
  );

  _instances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels:   series.map(d => d.label),
      datasets: [{
        data:            series.map(d => parseFloat((d.minutes / 60).toFixed(2))),
        backgroundColor: bgColors,
        borderColor:     borderColors,
        borderWidth:     1,
        borderRadius:    4,
        borderSkipped:   false,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: {
          ...{ callbacks: {
            label: ctx => ` ${_fmtMins(series[ctx.dataIndex].minutes)}`,
          }},
          ...Object.fromEntries(
            Object.entries(_tooltipConfig()).map(([k, v]) => [k, v])
          ),
        },
      },
      scales: {
        x: {
          grid:   { display: false },
          ticks:  { color: c.textMuted, font: { size: 11 } },
          border: { display: false },
        },
        y: {
          grid:     _gridConfig(),
          ticks: {
            color:    c.textMuted,
            font:     { size: 11, family: "'Share Tech Mono', monospace" },
            callback: v => `${v}h`,
          },
          border:    { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ────────────────────────────────────────────────────────────
   2. ANALYTICS HOURS BAR CHART
──────────────────────────────────────────────────────────── */

/**
 * Render the main analytics bar chart for the selected period.
 * @param {'week'|'month'|'year'|'all'} period
 */
async function renderHoursBar(period = 'week') {
  const canvasId = 'chart-hours-bar';
  if (typeof Chart === 'undefined') return;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  _destroyChart(canvasId);
  _applyGlobalDefaults();

  let series = [];

  switch (period) {
    case 'week':
      series = await StatsModule.getDailySeriesForWeek(7);
      break;
    case 'month':
      series = await StatsModule.getDailySeriesForWeek(30);
      break;
    case 'year':
      series = await StatsModule.getMonthlySeriesForYear(12);
      break;
    case 'all':
      series = await StatsModule.getYearlySeries();
      break;
  }

  const c         = _colors();
  const labels    = series.map(d => d.label);
  const hoursData = series.map(d => parseFloat((d.minutes / 60).toFixed(2)));

  // Gradient fill
  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 240);
  grad.addColorStop(0,   c.accent);
  grad.addColorStop(0.6, `${c.accent}88`);
  grad.addColorStop(1,   `${c.accent}22`);

  _instances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label:           'Study Hours',
        data:            hoursData,
        backgroundColor: grad,
        borderColor:     c.accent,
        borderWidth:     1,
        borderRadius:    5,
        borderSkipped:   false,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: {
          backgroundColor:  _tooltipConfig().backgroundColor,
          borderColor:      _tooltipConfig().borderColor,
          borderWidth:      _tooltipConfig().borderWidth,
          titleColor:       _tooltipConfig().titleColor,
          bodyColor:        _tooltipConfig().bodyColor,
          padding:          _tooltipConfig().padding,
          cornerRadius:     _tooltipConfig().cornerRadius,
          callbacks: {
            label: ctx => ` ${_fmtMins(series[ctx.dataIndex].minutes)}`,
          },
        },
      },
      scales: {
        x: {
          grid:   { display: false },
          ticks:  { color: c.textMuted, maxRotation: 45 },
          border: { display: false },
        },
        y: {
          grid:      _gridConfig(),
          ticks: {
            color:    c.textMuted,
            callback: v => `${v}h`,
            font:     { family: "'Share Tech Mono', monospace" },
          },
          border:    { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ────────────────────────────────────────────────────────────
   3. ANALYTICS SUBJECT DISTRIBUTION PIE
──────────────────────────────────────────────────────────── */

/**
 * Render the subject distribution pie chart.
 * @param {'week'|'month'|'year'|'all'} period
 */
async function renderSubjectPie(period = 'all') {
  const canvasId = 'chart-subject-pie';
  if (typeof Chart === 'undefined') return;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  _destroyChart(canvasId);
  _applyGlobalDefaults();

  const breakdown = await StatsModule.getSubjectBreakdown(period);
  const c         = _colors();

  if (!breakdown.length) {
    _renderEmptyChart(canvas, 'No data yet');
    return;
  }

  const labels  = breakdown.map(s => s.subjectName);
  const data    = breakdown.map(s => parseFloat((s.minutes / 60).toFixed(2)));
  const colors  = breakdown.map((s, i) =>
    s.subjectColor || c.subjectColors[i % c.subjectColors.length]
  );

  _instances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(col => `${col}cc`),
        borderColor:     colors,
        borderWidth:     2,
        hoverOffset:     8,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      cutout:              '62%',
      plugins: {
        legend: {
          display:  true,
          position: 'bottom',
          labels: {
            color:    c.textSecondary,
            padding:  12,
            boxWidth: 10,
            font:     { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: _tooltipConfig().backgroundColor,
          borderColor:     _tooltipConfig().borderColor,
          borderWidth:     _tooltipConfig().borderWidth,
          titleColor:      _tooltipConfig().titleColor,
          bodyColor:       _tooltipConfig().bodyColor,
          padding:         _tooltipConfig().padding,
          cornerRadius:    _tooltipConfig().cornerRadius,
          callbacks: {
            label: ctx => {
              const mins  = breakdown[ctx.dataIndex].minutes;
              const total = breakdown.reduce((a, s) => a + s.minutes, 0);
              const pct   = total > 0 ? Math.round((mins / total) * 100) : 0;
              return ` ${_fmtMins(mins)} · ${pct}%`;
            },
          },
        },
      },
    },
  });
}

/* ────────────────────────────────────────────────────────────
   4. ANALYTICS SESSIONS-PER-DAY LINE CHART
──────────────────────────────────────────────────────────── */

/**
 * Render the sessions-per-day line chart.
 * @param {'week'|'month'|'year'|'all'} period
 */
async function renderSessionsLine(period = 'week') {
  const canvasId = 'chart-sessions-line';
  if (typeof Chart === 'undefined') return;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  _destroyChart(canvasId);
  _applyGlobalDefaults();

  const days   = period === 'month' ? 30 : period === 'year' ? 365 : 7;
  const series = await StatsModule.getDailySessionCountSeries(
    period === 'year' ? 52 : days   // weekly buckets for year view
  );

  const c = _colors();

  // Build area gradient
  const ctx  = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 240);
  grad.addColorStop(0,   `${c.amber}55`);
  grad.addColorStop(1,   `${c.amber}00`);

  _instances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels:   series.map(d => d.label),
      datasets: [{
        label:           'Sessions',
        data:            series.map(d => d.count),
        borderColor:     c.amber,
        backgroundColor: grad,
        borderWidth:     2,
        pointRadius:     3,
        pointHoverRadius:5,
        pointBackgroundColor: c.amber,
        fill:            true,
        tension:         0.35,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: {
          backgroundColor: _tooltipConfig().backgroundColor,
          borderColor:     _tooltipConfig().borderColor,
          borderWidth:     _tooltipConfig().borderWidth,
          titleColor:      _tooltipConfig().titleColor,
          bodyColor:       _tooltipConfig().bodyColor,
          padding:         _tooltipConfig().padding,
          cornerRadius:    _tooltipConfig().cornerRadius,
          callbacks: {
            label: ctx => ` ${ctx.parsed.y} session${ctx.parsed.y !== 1 ? 's' : ''}`,
          },
        },
      },
      scales: {
        x: {
          grid:   { display: false },
          ticks:  { color: c.textMuted, maxRotation: 45 },
          border: { display: false },
        },
        y: {
          grid:      _gridConfig(),
          ticks: {
            color:     c.textMuted,
            stepSize:  1,
            font:      { family: "'Share Tech Mono', monospace" },
          },
          border:    { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ────────────────────────────────────────────────────────────
   5. TIMER SECTION SUBJECT DONUT
──────────────────────────────────────────────────────────── */

/**
 * Render the small subject donut + text legend on the timer page.
 * @param {string} canvasId   'chart-subject-donut'
 * @param {string} legendId   'subject-legend'
 */
async function renderSubjectDonut(canvasId, legendId) {
  if (typeof Chart === 'undefined') return;

  const canvas    = document.getElementById(canvasId);
  const legendEl  = document.getElementById(legendId);
  if (!canvas) return;

  _destroyChart(canvasId);
  _applyGlobalDefaults();

  // Use today's sessions for the timer context
  const breakdown = await StatsModule.getSubjectBreakdown('today');
  const c         = _colors();

  if (!breakdown.length) {
    _renderEmptyChart(canvas, 'No sessions today');
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  const labels = breakdown.map(s => s.subjectName);
  const data   = breakdown.map(s => s.minutes);
  const colors = breakdown.map((s, i) =>
    s.subjectColor || c.subjectColors[i % c.subjectColors.length]
  );

  _instances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(col => `${col}bb`),
        borderColor:     colors,
        borderWidth:     2,
        hoverOffset:     6,
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      cutout:              '68%',
      plugins: {
        legend:  { display: false },
        tooltip: {
          backgroundColor: _tooltipConfig().backgroundColor,
          borderColor:     _tooltipConfig().borderColor,
          borderWidth:     _tooltipConfig().borderWidth,
          titleColor:      _tooltipConfig().titleColor,
          bodyColor:       _tooltipConfig().bodyColor,
          padding:         _tooltipConfig().padding,
          cornerRadius:    _tooltipConfig().cornerRadius,
          callbacks: {
            label: ctx => ` ${_fmtMins(breakdown[ctx.dataIndex].minutes)}`,
          },
        },
      },
    },
  });

  // Build custom legend
  if (legendEl) {
    legendEl.innerHTML = breakdown.map((s, i) => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${colors[i]}"></span>
        <span>${_esc(s.subjectName)}</span>
        <span style="margin-left:auto;font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted)">
          ${_fmtMins(s.minutes)}
        </span>
      </div>
    `).join('');
  }
}

/* ────────────────────────────────────────────────────────────
   6. ACTIVITY HEATMAP  (DOM-built, not Chart.js)
──────────────────────────────────────────────────────────── */

/**
 * Build and render the 12-week activity heatmap.
 * @param {string} containerId  'heatmap-container'
 */
async function renderHeatmap(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const cells = await StatsModule.getHeatmapData(12); // 84 days
  const c     = _colors();

  container.innerHTML = '';

  // Group into columns of 7 (one column per week, Sun–Sat)
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  // Day-of-week labels column
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const labelCol  = document.createElement('div');
  labelCol.className = 'heatmap-week';
  labelCol.style.marginRight = '4px';
  dayLabels.forEach(lbl => {
    const span = document.createElement('div');
    span.style.cssText = `
      height: 14px;
      font-size: 0.6rem;
      color: var(--text-muted);
      font-family: var(--font-mono);
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    span.textContent = lbl;
    labelCol.appendChild(span);
  });
  container.appendChild(labelCol);

  weeks.forEach(week => {
    const col = document.createElement('div');
    col.className = 'heatmap-week';

    week.forEach(cell => {
      const div = document.createElement('div');
      div.className = `heatmap-cell heatmap-cell--l${cell.level}`;

      // Tooltip via title attribute
      const dateStr = cell.date.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      div.title = cell.minutes > 0
        ? `${dateStr}: ${_fmtMins(cell.minutes)}`
        : `${dateStr}: No study`;

      col.appendChild(div);
    });

    container.appendChild(col);
  });
}

/* ────────────────────────────────────────────────────────────
   MASTER ANALYTICS RENDER
──────────────────────────────────────────────────────────── */

/**
 * Render all three analytics charts for a given period.
 * Called by app.js whenever the Analytics section is entered
 * or the period tab changes.
 *
 * @param {'week'|'month'|'year'|'all'} period
 */
async function render(period = 'week') {
  await Promise.all([
    renderHoursBar(period),
    renderSubjectPie(period),
    renderSessionsLine(period),
  ]);
}

/* ────────────────────────────────────────────────────────────
   EMPTY STATE CHART PLACEHOLDER
──────────────────────────────────────────────────────────── */

/**
 * Draw a simple "no data" message on a canvas when empty.
 * @param {HTMLCanvasElement} canvas
 * @param {string}            message
 */
function _renderEmptyChart(canvas, message = 'No data yet') {
  const ctx  = canvas.getContext('2d');
  const c    = _colors();
  const dpr  = window.devicePixelRatio || 1;
  const w    = canvas.offsetWidth  || 200;
  const h    = canvas.offsetHeight || 200;

  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle    = c.textMuted;
  ctx.font         = `14px 'Barlow', sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, w / 2, h / 2);
}

/* ────────────────────────────────────────────────────────────
   DESTROY ALL  (called on reset)
──────────────────────────────────────────────────────────── */

/**
 * Destroy every managed Chart.js instance.
 * Called from backup.js after a full data reset.
 */
function destroyAll() {
  Object.keys(_instances).forEach(id => {
    _instances[id]?.destroy();
    delete _instances[id];
  });
}

/**
 * Resize every live Chart.js instance (after layout / orientation changes).
 */
function resizeAll() {
  Object.keys(_instances).forEach(id => {
    try {
      _instances[id]?.resize();
    } catch (_) {}
  });
}

let _resizeDebounce = null;
function _scheduleResizeAll() {
  clearTimeout(_resizeDebounce);
  _resizeDebounce = setTimeout(resizeAll, 120);
}

window.addEventListener('resize', _scheduleResizeAll);
window.addEventListener('orientationchange', _scheduleResizeAll);

/* ────────────────────────────────────────────────────────────
   UTILITY
──────────────────────────────────────────────────────────── */
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.ChartsModule = {
  render,
  renderWeekPreview,
  renderHoursBar,
  renderSubjectPie,
  renderSessionsLine,
  renderSubjectDonut,
  renderHeatmap,
  destroyAll,
  resizeAll,
};
