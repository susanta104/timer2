/* ============================================================
   MBBS STUDY COMMAND CENTER — js/stats.js
   Computes all aggregated statistics used by the dashboard
   stat cards, the timer section daily stats, and any module
   that needs summarised numbers without raw session arrays.

   Exposes: window.StatsModule
   Depends: window.DB  (db.js, loaded before this file)
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   TIME BOUNDARY HELPERS
──────────────────────────────────────────────────────────── */

/** Midnight (00:00:00.000) of a given date in local time, as ms */
function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Last ms (23:59:59.999) of a given date in local time */
function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Midnight of the Monday (or Sunday if you prefer) of the current week */
function startOfWeek(date = new Date()) {
  const d   = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day); // roll back to Sunday
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Midnight of the first day of the current calendar month */
function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** Midnight of the first day of the current calendar year */
function startOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 0, 1).getTime();
}

/** Midnight N days ago (0 = today, 1 = yesterday, …) */
function startOfDayNAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

/* ────────────────────────────────────────────────────────────
   CORE AGGREGATION
──────────────────────────────────────────────────────────── */

/**
 * Sum the duration (minutes) of a session array.
 * @param {Object[]} sessions
 * @returns {number}
 */
function sumMinutes(sessions) {
  return sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
}

/**
 * Filter sessions by a [fromMs, toMs] time window (startTime).
 * @param {Object[]} sessions  full session array
 * @param {number}   fromMs
 * @param {number}   toMs
 * @returns {Object[]}
 */
function filterByRange(sessions, fromMs, toMs) {
  return sessions.filter(s => s.startTime >= fromMs && s.startTime <= toMs);
}

/* ────────────────────────────────────────────────────────────
   MAIN COMPUTE FUNCTION
──────────────────────────────────────────────────────────── */

/**
 * Compute all dashboard statistics in a single DB read.
 *
 * @returns {Promise<{
 *   todayMins:       number,
 *   todaySessions:   number,
 *   weekMins:        number,
 *   weekSessions:    number,
 *   monthMins:       number,
 *   monthSessions:   number,
 *   yearMins:        number,
 *   yearSessions:    number,
 *   lifetimeMins:    number,
 *   lifetimeSessions:number,
 *   totalDays:       number,
 *   dailyGoalMins:   number,
 *   dailyGoalPct:    number,
 * }>}
 */
async function compute() {
  const now      = Date.now();
  const todayS   = startOfDay();
  const todayE   = endOfDay();
  const weekS    = startOfWeek();
  const monthS   = startOfMonth();
  const yearS    = startOfYear();

  // Single DB read — filter in memory
  const all = await DB.getAllSessions();

  const todaySess   = filterByRange(all, todayS,  todayE);
  const weekSess    = filterByRange(all, weekS,   now);
  const monthSess   = filterByRange(all, monthS,  now);
  const yearSess    = filterByRange(all, yearS,   now);

  const todayMins   = sumMinutes(todaySess);
  const weekMins    = sumMinutes(weekSess);
  const monthMins   = sumMinutes(monthSess);
  const yearMins    = sumMinutes(yearSess);
  const lifetimeMins= sumMinutes(all);

  // Unique calendar days with at least one session
  const daySet = new Set(
    all.map(s => DB.toDateKey(new Date(s.startTime)))
  );
  const totalDays = daySet.size;

  // Daily goal (stored in localStorage by settings module)
  const goalHrs  = parseInt(localStorage.getItem('mbbs_daily_goal') || '8', 10);
  const goalMins = goalHrs * 60;
  const dailyGoalPct = goalMins > 0
    ? Math.min(100, Math.round((todayMins / goalMins) * 100))
    : 0;

  return {
    todayMins,
    todaySessions:    todaySess.length,
    weekMins,
    weekSessions:     weekSess.length,
    monthMins,
    monthSessions:    monthSess.length,
    yearMins,
    yearSessions:     yearSess.length,
    lifetimeMins,
    lifetimeSessions: all.length,
    totalDays,
    dailyGoalMins:    goalMins,
    dailyGoalPct,
  };
}

/* ────────────────────────────────────────────────────────────
   PERIOD-BASED AGGREGATIONS  (used by charts.js)
──────────────────────────────────────────────────────────── */

/**
 * Build a labelled daily minutes series for the last N days.
 * Each entry: { label: 'Mon 3', minutes: number, date: Date }
 *
 * @param {number} days   — number of days to include (default 7)
 * @returns {Promise<Array<{label:string, minutes:number, date:Date}>>}
 */
async function getDailySeriesForWeek(days = 7) {
  const all    = await DB.getAllSessions();
  const result = [];

  for (let i = days - 1; i >= 0; i--) {
    const d    = new Date();
    d.setDate(d.getDate() - i);
    const from = startOfDay(d);
    const to   = endOfDay(d);
    const sess = filterByRange(all, from, to);
    result.push({
      label:   formatDayLabel(d, days),
      minutes: sumMinutes(sess),
      date:    new Date(d),
      count:   sess.length,
    });
  }

  return result;
}

/**
 * Build a weekly-total series for the last N weeks.
 * Each entry: { label: 'Wk 23', minutes: number, weekStart: Date }
 *
 * @param {number} weeks
 * @returns {Promise<Array<{label:string, minutes:number, weekStart:Date}>>}
 */
async function getWeeklySeriesForMonth(weeks = 4) {
  const all    = await DB.getAllSessions();
  const result = [];

  // Find the start of the current week
  const thisWeekStart = new Date(startOfWeek());

  for (let i = weeks - 1; i >= 0; i--) {
    const wStart = new Date(thisWeekStart);
    wStart.setDate(thisWeekStart.getDate() - i * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 6);
    wEnd.setHours(23, 59, 59, 999);

    const sess = filterByRange(all, wStart.getTime(), wEnd.getTime());
    const weekNum = getWeekNumber(wStart);

    result.push({
      label:     `Wk ${weekNum}`,
      minutes:   sumMinutes(sess),
      weekStart: new Date(wStart),
      count:     sess.length,
    });
  }

  return result;
}

/**
 * Build a monthly-total series for the last N months.
 * Each entry: { label: 'Jan', minutes: number, month: Date }
 *
 * @param {number} months
 * @returns {Promise<Array<{label:string, minutes:number, month:Date}>>}
 */
async function getMonthlySeriesForYear(months = 12) {
  const all    = await DB.getAllSessions();
  const result = [];
  const now    = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mStart = d.getTime();
    const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();

    const sess = filterByRange(all, mStart, mEnd);
    result.push({
      label:   d.toLocaleString('default', { month: 'short' }),
      minutes: sumMinutes(sess),
      month:   new Date(d),
      count:   sess.length,
    });
  }

  return result;
}

/**
 * Build a yearly-total series for all years with data.
 * Each entry: { label: '2024', minutes: number }
 *
 * @returns {Promise<Array<{label:string, minutes:number, count:number}>>}
 */
async function getYearlySeries() {
  const all = await DB.getAllSessions();
  if (!all.length) return [];

  const map = {};
  all.forEach(s => {
    const yr = new Date(s.startTime).getFullYear();
    if (!map[yr]) map[yr] = { minutes: 0, count: 0 };
    map[yr].minutes += s.duration || 0;
    map[yr].count   += 1;
  });

  return Object.keys(map)
    .sort()
    .map(yr => ({
      label:   String(yr),
      minutes: map[yr].minutes,
      count:   map[yr].count,
    }));
}

/* ────────────────────────────────────────────────────────────
   HEATMAP DATA  (last 12 weeks = 84 days)
──────────────────────────────────────────────────────────── */

/**
 * Build heatmap cell data for the last N weeks.
 * Returns a flat array of { dateKey, minutes, level (0–4) }
 * ordered oldest → newest.
 *
 * Level thresholds (minutes):
 *   0 = 0 min   (no study)
 *   1 = 1–30    (light)
 *   2 = 31–90   (moderate)
 *   3 = 91–180  (solid)
 *   4 = 181+    (intense)
 *
 * @param {number} weeks
 * @returns {Promise<Array<{dateKey:string, date:Date, minutes:number, level:number}>>}
 */
async function getHeatmapData(weeks = 12) {
  const days   = weeks * 7;
  const all    = await DB.getAllSessions();

  // Build a dateKey → minutes map
  const minuteMap = {};
  all.forEach(s => {
    const key = DB.toDateKey(new Date(s.startTime));
    minuteMap[key] = (minuteMap[key] || 0) + (s.duration || 0);
  });

  const result = [];
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key     = DB.toDateKey(d);
    const minutes = minuteMap[key] || 0;

    result.push({
      dateKey: key,
      date:    new Date(d),
      minutes,
      level:   minutesToLevel(minutes),
    });
  }

  return result;
}

/**
 * Map study minutes to a heat level 0–4.
 * @param {number} minutes
 * @returns {0|1|2|3|4}
 */
function minutesToLevel(minutes) {
  if (minutes <= 0)   return 0;
  if (minutes <= 30)  return 1;
  if (minutes <= 90)  return 2;
  if (minutes <= 180) return 3;
  return 4;
}

/* ────────────────────────────────────────────────────────────
   SUBJECT BREAKDOWN STATS
──────────────────────────────────────────────────────────── */

/**
 * Get per-subject minutes for a given time period.
 *
 * @param {'today'|'week'|'month'|'year'|'all'} period
 * @returns {Promise<Array<{subjectId, subjectName, subjectColor, minutes, sessions}>>}
 */
async function getSubjectBreakdown(period = 'all') {
  const all  = await DB.getAllSessions();
  const now  = Date.now();

  let from = 0;
  switch (period) {
    case 'today': from = startOfDay();   break;
    case 'week':  from = startOfWeek();  break;
    case 'month': from = startOfMonth(); break;
    case 'year':  from = startOfYear();  break;
    case 'all':   from = 0;              break;
    default:      from = 0;
  }

  const filtered = from > 0 ? filterByRange(all, from, now) : all;

  const map = {};
  filtered.forEach(s => {
    const key = String(s.subjectId || 'none');
    if (!map[key]) {
      map[key] = {
        subjectId:    s.subjectId,
        subjectName:  s.subjectName  || 'Unknown',
        subjectColor: s.subjectColor || '#00d4ff',
        minutes:      0,
        sessions:     0,
      };
    }
    map[key].minutes  += s.duration || 0;
    map[key].sessions += 1;
  });

  return Object.values(map).sort((a, b) => b.minutes - a.minutes);
}

/* ────────────────────────────────────────────────────────────
   SESSION COUNT SERIES  (for line chart)
──────────────────────────────────────────────────────────── */

/**
 * Get daily session counts for the last N days.
 * Returns array of { label, count, date } oldest → newest.
 *
 * @param {number} days
 * @returns {Promise<Array<{label:string, count:number, date:Date}>>}
 */
async function getDailySessionCountSeries(days = 7) {
  const all    = await DB.getAllSessions();
  const result = [];

  for (let i = days - 1; i >= 0; i--) {
    const d    = new Date();
    d.setDate(d.getDate() - i);
    const from = startOfDay(d);
    const to   = endOfDay(d);
    const sess = filterByRange(all, from, to);

    result.push({
      label: formatDayLabel(d, days),
      count: sess.length,
      date:  new Date(d),
    });
  }

  return result;
}

/* ────────────────────────────────────────────────────────────
   TIMER SECTION DAILY STATS
──────────────────────────────────────────────────────────── */

/**
 * Compute statistics specific to the timer section UI:
 * sessions today, focus minutes today, and break count.
 *
 * @returns {Promise<{sessions:number, focusMins:number, breaks:number}>}
 */
async function computeTimerDailyStats() {
  const from    = startOfDay();
  const to      = endOfDay();
  const all     = await DB.getAllSessions();
  const today   = filterByRange(all, from, to);

  return {
    sessions:  today.length,
    focusMins: sumMinutes(today),
    // A break is counted between consecutive sessions; min 0
    breaks:    Math.max(0, today.length - 1),
  };
}

/* ────────────────────────────────────────────────────────────
   FORMATTING HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Format a Date as a short day label.
 * Uses abbreviated weekday for 7-day ranges, or 'Mon 3' style for longer.
 *
 * @param {Date}   date
 * @param {number} rangeSize  total number of days in the range
 * @returns {string}
 */
function formatDayLabel(date, rangeSize = 7) {
  if (rangeSize <= 7) {
    // "Mon", "Tue", …
    return date.toLocaleString('default', { weekday: 'short' });
  }
  if (rangeSize <= 31) {
    // "Mon 3", "Tue 4", …
    const wd = date.toLocaleString('default', { weekday: 'short' });
    return `${wd} ${date.getDate()}`;
  }
  // "Jan 3", "Feb 14", …
  return date.toLocaleString('default', { month: 'short', day: 'numeric' });
}

/**
 * Format minutes as a human-readable string.
 * @param {number} totalMins
 * @returns {string}  e.g. "3h 25m" or "45m"
 */
function formatMinutes(totalMins) {
  if (totalMins <= 0) return '0m';
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * ISO week number for a Date.
 * @param {Date} date
 * @returns {number}
 */
function getWeekNumber(date) {
  const d     = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.StatsModule = {
  /* Dashboard stat cards */
  compute,

  /* Chart data series */
  getDailySeriesForWeek,
  getWeeklySeriesForMonth,
  getMonthlySeriesForYear,
  getYearlySeries,

  /* Heatmap */
  getHeatmapData,
  minutesToLevel,

  /* Subject breakdown */
  getSubjectBreakdown,

  /* Session count series (line chart) */
  getDailySessionCountSeries,

  /* Timer section */
  computeTimerDailyStats,

  /* Formatting utilities */
  formatMinutes,
  formatDayLabel,

  /* Time boundary utilities (used by other modules) */
  startOfDay,
  endOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  startOfDayNAgo,

  /* Helpers */
  sumMinutes,
  filterByRange,
};
