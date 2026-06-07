/* ============================================================
   MBBS STUDY COMMAND CENTER — js/streak.js
   Computes study streak data for the dashboard widget.

   Definitions:
   ─ A day "counts" if at least 1 session was logged on it
     (local calendar date, not UTC).
   ─ Current streak = consecutive days ending today or yesterday
     that each have at least one session.
   ─ Best streak    = longest such run across all history.
   ─ last7          = boolean[7] where index 0 = 6 days ago,
                      index 6 = today.

   Exposes: window.StreakModule
   Depends: window.DB  (db.js)
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Format a Date as 'YYYY-MM-DD' in local time.
 * Delegates to DB.toDateKey so the format is always identical.
 * @param {Date} date
 * @returns {string}
 */
function dateKey(date) {
  return DB.toDateKey(date);
}

/**
 * Return the Date N calendar days before today (local time).
 * @param {number} n  0 = today, 1 = yesterday, …
 * @returns {Date}
 */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* ────────────────────────────────────────────────────────────
   CORE COMPUTATION
──────────────────────────────────────────────────────────── */

/**
 * Compute all streak-related data from the full session history.
 *
 * Algorithm:
 * 1. Pull all sessions and collect the set of studied date-keys.
 * 2. Walk backwards from today to find the current streak.
 *    - If today has sessions → streak starts at 1, then keeps
 *      counting backwards as long as each prior day has sessions.
 *    - If today has no sessions but yesterday does → same walk
 *      starting from yesterday (streak not yet broken).
 *    - Otherwise current streak = 0.
 * 3. Find the best streak by sorting all studied days and finding
 *    the longest consecutive run.
 * 4. Build the last-7-days boolean array.
 *
 * @returns {Promise<{
 *   current: number,
 *   best:    number,
 *   last7:   boolean[],   // [6daysAgo, …, today]
 *   studiedToday: boolean,
 *   totalStudyDays: number,
 * }>}
 */
async function compute() {
  // Single DB read
  const sessions = await DB.getAllSessions();

  // Build Set<string> of unique studied date-keys
  const studiedSet = new Set(
    sessions.map(s => DB.toDateKey(new Date(s.startTime)))
  );

  const todayKey     = dateKey(daysAgo(0));
  const yesterdayKey = dateKey(daysAgo(1));

  /* ── Current streak ── */
  let current = 0;

  const studiedToday     = studiedSet.has(todayKey);
  const studiedYesterday = studiedSet.has(yesterdayKey);

  if (studiedToday || studiedYesterday) {
    // Start walking back from today (if studied) or yesterday
    const startOffset = studiedToday ? 0 : 1;

    for (let i = startOffset; ; i++) {
      const key = dateKey(daysAgo(i));
      if (studiedSet.has(key)) {
        current++;
      } else {
        break;
      }
      // Safety cap — can't exceed total study days
      if (current >= studiedSet.size) break;
    }
  }

  /* ── Best streak ── */
  const best = computeBestStreak(studiedSet);

  /* ── Last 7 days array ── */
  // Index 0 = 6 days ago … Index 6 = today
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const key = dateKey(daysAgo(6 - i));
    return studiedSet.has(key);
  });

  return {
    current,
    best,
    last7,
    studiedToday,
    totalStudyDays: studiedSet.size,
  };
}

/* ────────────────────────────────────────────────────────────
   BEST STREAK ALGORITHM
──────────────────────────────────────────────────────────── */

/**
 * Find the longest run of consecutive calendar days in a Set
 * of 'YYYY-MM-DD' strings.
 *
 * Strategy:
 * 1. Convert each dateKey to a day-number (ms since epoch ÷ 86400000).
 * 2. Sort ascending.
 * 3. Walk the sorted array — if the next day-number is exactly
 *    current + 1, extend the run; otherwise reset.
 *
 * @param {Set<string>} studiedSet
 * @returns {number}
 */
function computeBestStreak(studiedSet) {
  if (studiedSet.size === 0) return 0;

  // Convert date strings to day-numbers for arithmetic comparison
  const dayNumbers = Array.from(studiedSet)
    .map(key => {
      // key = 'YYYY-MM-DD' (local time — treat as UTC noon to avoid DST edge)
      const [y, m, d] = key.split('-').map(Number);
      return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    })
    .sort((a, b) => a - b);

  let best    = 1;
  let current = 1;

  for (let i = 1; i < dayNumbers.length; i++) {
    if (dayNumbers[i] === dayNumbers[i - 1] + 1) {
      current++;
      if (current > best) best = current;
    } else if (dayNumbers[i] !== dayNumbers[i - 1]) {
      // Gap (skip duplicates just in case)
      current = 1;
    }
  }

  return best;
}

/* ────────────────────────────────────────────────────────────
   EXTENDED HISTORY  (used by analytics)
──────────────────────────────────────────────────────────── */

/**
 * Get a boolean activity array for the last N days.
 * Index 0 = N-1 days ago, index N-1 = today.
 *
 * @param {number} days
 * @returns {Promise<boolean[]>}
 */
async function getActivityArray(days = 84) {
  const sessions   = await DB.getAllSessions();
  const studiedSet = new Set(
    sessions.map(s => DB.toDateKey(new Date(s.startTime)))
  );

  return Array.from({ length: days }, (_, i) => {
    const key = dateKey(daysAgo(days - 1 - i));
    return studiedSet.has(key);
  });
}

/**
 * Get per-day minute totals for the last N days.
 * Index 0 = N-1 days ago, index N-1 = today.
 *
 * @param {number} days
 * @returns {Promise<number[]>}
 */
async function getMinutesArray(days = 84) {
  const sessions = await DB.getAllSessions();
  const map      = {};

  sessions.forEach(s => {
    const key = DB.toDateKey(new Date(s.startTime));
    map[key]  = (map[key] || 0) + (s.duration || 0);
  });

  return Array.from({ length: days }, (_, i) => {
    const key = dateKey(daysAgo(days - 1 - i));
    return map[key] || 0;
  });
}

/**
 * Describe a streak result in a human-readable sentence.
 * Used by any UI that wants a text summary.
 *
 * @param {{current:number, best:number, studiedToday:boolean}} streak
 * @returns {string}
 */
function describeStreak(streak) {
  if (streak.current === 0) {
    return streak.best > 0
      ? `No active streak. Best was ${streak.best} day${streak.best !== 1 ? 's' : ''}.`
      : 'Start studying to build your streak!';
  }
  if (streak.current === streak.best) {
    return `🔥 On a ${streak.current}-day streak — personal best!`;
  }
  return `🔥 ${streak.current}-day streak. Best: ${streak.best} days.`;
}

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.StreakModule = {
  compute,
  computeBestStreak,
  getActivityArray,
  getMinutesArray,
  describeStreak,
};
