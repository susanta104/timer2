/* ============================================================
   MBBS STUDY COMMAND CENTER — js/countdown.js
   Manages exam countdown logic:
   ─ Fetching the next upcoming exam from DB
   ─ Live second-by-second tick driving the dashboard widget
   ─ Computing d / h / m / s from a target timestamp
   ─ Formatting countdown units for display
   ─ Stopping / restarting the tick when section changes

   Exposes: window.CountdownModule
   Depends: window.DB  (db.js)
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   STATE
──────────────────────────────────────────────────────────── */
let _tickInterval  = null;   // setInterval handle
let _targetMs      = null;   // target exam timestamp (ms)
let _tickCallback  = null;   // fn(days, hours, mins, secs)

/* ────────────────────────────────────────────────────────────
   CORE TIME MATH
──────────────────────────────────────────────────────────── */

/**
 * Decompose a future timestamp into countdown units.
 * If the target is in the past all values are 0.
 *
 * @param {number} targetMs   Unix ms timestamp of exam
 * @param {number} [nowMs]    Override "now" (useful for tests)
 * @returns {{ total:number, days:number, hours:number, mins:number, secs:number, expired:boolean }}
 */
function decompose(targetMs, nowMs = Date.now()) {
  const diff = targetMs - nowMs;

  if (diff <= 0) {
    return { total: 0, days: 0, hours: 0, mins: 0, secs: 0, expired: true };
  }

  const totalSecs = Math.floor(diff / 1000);
  const days      = Math.floor(totalSecs / 86400);
  const hours     = Math.floor((totalSecs % 86400) / 3600);
  const mins      = Math.floor((totalSecs % 3600)  / 60);
  const secs      = totalSecs % 60;

  return { total: totalSecs, days, hours, mins, secs, expired: false };
}

/**
 * Format a countdown unit value as a zero-padded string.
 * Days can be more than 2 digits so we don't pad them.
 *
 * @param {number} value
 * @param {boolean} [padDays=false]
 * @returns {string}
 */
function pad(value, padDays = false) {
  if (padDays) return String(value);
  return String(value).padStart(2, '0');
}

/* ────────────────────────────────────────────────────────────
   TICK ENGINE
──────────────────────────────────────────────────────────── */

/**
 * Start the live countdown tick.
 * Fires callback immediately, then every second.
 * Automatically stops when the exam expires.
 *
 * @param {number}   targetMs    Unix ms of exam date/time
 * @param {Function} callback    fn(days, hours, mins, secs)
 */
function startTick(targetMs, callback) {
  // Stop any existing tick first
  stopTick();

  _targetMs     = targetMs;
  _tickCallback = callback;

  const tick = () => {
    const { days, hours, mins, secs, expired } = decompose(_targetMs);

    if (expired) {
      stopTick();
      // Notify callback with zeros so UI clears
      callback(0, 0, 0, 0);
      // Trigger a dashboard refresh to re-evaluate next exam
      _onExpiry();
      return;
    }

    callback(days, hours, mins, secs);
  };

  // Fire immediately, then on interval
  tick();
  _tickInterval = setInterval(tick, 1000);
}

/**
 * Stop the live countdown tick.
 */
function stopTick() {
  if (_tickInterval !== null) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
  _targetMs     = null;
  _tickCallback = null;
}

/**
 * Called internally when the countdown reaches zero.
 * Refreshes the dashboard countdown widget.
 */
async function _onExpiry() {
  try {
    // Give the DB a moment to settle, then refresh the widget
    await new Promise(r => setTimeout(r, 500));
    if (typeof App !== 'undefined' && App.refreshCountdownWidget) {
      await App.refreshCountdownWidget();
    }
  } catch (_) {
    // Non-critical
  }
}

/* ────────────────────────────────────────────────────────────
   DB WRAPPERS
──────────────────────────────────────────────────────────── */

/**
 * Get the next upcoming exam (date > now).
 * @returns {Promise<Object|null>}
 */
async function getNext() {
  try {
    return await DB.getNextExam();
  } catch (err) {
    console.error('[Countdown] getNext() failed:', err);
    return null;
  }
}

/**
 * Get all exams sorted by date ascending.
 * @returns {Promise<Object[]>}
 */
async function getAll() {
  try {
    return await DB.getAllExams();
  } catch (err) {
    console.error('[Countdown] getAll() failed:', err);
    return [];
  }
}

/* ────────────────────────────────────────────────────────────
   DISPLAY HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Format an exam date as a readable string.
 * e.g. "Wed, 15 Jan 2025 · 09:00 AM"
 *
 * @param {number} ms  Unix timestamp
 * @returns {string}
 */
function formatExamDate(ms) {
  const d = new Date(ms);
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short',
    day:     'numeric',
    month:   'short',
    year:    'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
  });
  return `${dateStr} · ${timeStr}`;
}

/**
 * Human-readable distance from now to targetMs.
 * Used for exam cards in the Exams section.
 * e.g. "in 3 days", "in 2 hours", "2 days ago"
 *
 * @param {number} targetMs
 * @returns {string}
 */
function relativeTime(targetMs) {
  const diff    = targetMs - Date.now();
  const absDiff = Math.abs(diff);
  const past    = diff < 0;

  const secs  = Math.floor(absDiff / 1000);
  const mins  = Math.floor(secs  / 60);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  const weeks = Math.floor(days  / 7);
  const months= Math.floor(days  / 30);

  let label;
  if (secs  <  60)  label = 'just now';
  else if (mins < 60)   label = `${mins} min`;
  else if (hours < 24)  label = `${hours} hr${hours !== 1 ? 's' : ''}`;
  else if (days  <  7)  label = `${days} day${days  !== 1 ? 's' : ''}`;
  else if (weeks < 5)   label = `${weeks} week${weeks !== 1 ? 's' : ''}`;
  else                  label = `${months} month${months !== 1 ? 's' : ''}`;

  if (secs < 60) return label;
  return past ? `${label} ago` : `in ${label}`;
}

/**
 * Classify an exam's urgency for styling purposes.
 * Returns one of: 'past' | 'urgent' | 'near' | 'future'
 *
 * @param {number} targetMs
 * @returns {'past'|'urgent'|'near'|'future'}
 */
function classifyUrgency(targetMs) {
  const diff = targetMs - Date.now();
  if (diff <= 0)              return 'past';
  if (diff <= 7  * 86400000) return 'urgent';   // ≤ 7 days
  if (diff <= 30 * 86400000) return 'near';     // ≤ 30 days
  return 'future';
}

/**
 * Get a motivational message based on days remaining.
 * Displayed below the countdown timer on the dashboard.
 *
 * @param {number} days
 * @returns {string}
 */
function motivationalMessage(days) {
  if (days <= 0)  return 'Exam day — good luck! You've got this.';
  if (days === 1) return 'Exam tomorrow — final review time!';
  if (days <= 3)  return 'Almost there — stay focused and trust your preparation.';
  if (days <= 7)  return 'One week left — high-yield topics first.';
  if (days <= 14) return 'Two weeks out — build momentum every day.';
  if (days <= 30) return 'Steady, consistent sessions win this.';
  if (days <= 60) return 'Plenty of time — build the habit now.';
  return 'Long runway ahead — use it wisely.';
}

/* ────────────────────────────────────────────────────────────
   URGENCY RING PROGRESS  (for dashboard widget)
──────────────────────────────────────────────────────────── */

/**
 * Calculate the proportion of time elapsed toward an exam.
 * Used to drive a progress/urgency indicator.
 *
 * Returns a value 0.0 – 1.0 where:
 *   0.0 = exam was just added (far away)
 *   1.0 = exam is now (or past)
 *
 * Requires the exam's createdAt timestamp to compute the full span.
 *
 * @param {number} createdAtMs  when the exam was added
 * @param {number} examMs       exam date
 * @returns {number}  0.0 – 1.0
 */
function elapsedFraction(createdAtMs, examMs) {
  const total   = examMs - createdAtMs;
  if (total <= 0) return 1;
  const elapsed = Date.now() - createdAtMs;
  return Math.min(1, Math.max(0, elapsed / total));
}

/* ────────────────────────────────────────────────────────────
   PAGE VISIBILITY  — pause tick when tab is hidden
──────────────────────────────────────────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab hidden — pause the interval to save resources
    if (_tickInterval !== null) {
      clearInterval(_tickInterval);
      _tickInterval = null;
    }
  } else {
    // Tab visible again — restart if we had an active target
    if (_targetMs !== null && _tickCallback !== null) {
      startTick(_targetMs, _tickCallback);
    }
  }
});

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.CountdownModule = {
  /* Tick engine */
  startTick,
  stopTick,

  /* DB wrappers */
  getNext,
  getAll,

  /* Math */
  decompose,
  pad,
  elapsedFraction,

  /* Display */
  formatExamDate,
  relativeTime,
  classifyUrgency,
  motivationalMessage,
};
