/* ============================================================
   MBBS STUDY COMMAND CENTER — js/sessions.js
   Session helper layer between the DB and the UI.

   Responsibilities:
   ─ Formatting session records for display (duration, date, time)
   ─ Grouping sessions by day / subject / week
   ─ Building summary statistics for a session array
   ─ Generating the HTML for session list items
     (used by both the dashboard recent list and sessions page)
   ─ Providing the subject-colour lookup used by other modules

   This module does NOT own any DOM sections — rendering is
   done by app.js which calls the helpers here.

   Exposes: window.SessionsModule
   Depends: window.DB
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   FORMATTING
──────────────────────────────────────────────────────────── */

/**
 * Format a duration in minutes as a human-readable string.
 * Examples: "45m"  "1h 20m"  "2h"
 *
 * @param {number} totalMins
 * @returns {string}
 */
function formatDuration(totalMins) {
  if (!totalMins || totalMins <= 0) return '0m';
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Format a Unix ms timestamp as a short date string.
 * Uses the user's local timezone.
 * Example: "Mon, Jun 3"
 *
 * @param {number} ms
 * @returns {string}
 */
function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  });
}

/**
 * Format a Unix ms timestamp as a short time string.
 * Example: "09:30 AM"
 *
 * @param {number} ms
 * @returns {string}
 */
function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a Unix ms timestamp as a compact date+time label.
 * Example: "Jun 3 · 09:30 AM"
 *
 * @param {number} ms
 * @returns {string}
 */
function formatDateTime(ms) {
  const date = new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  });
  const time = formatTime(ms);
  return `${date} · ${time}`;
}

/**
 * Return a relative time label for a session timestamp.
 * Examples: "Today", "Yesterday", "Mon, Jun 3"
 *
 * @param {number} ms
 * @returns {string}
 */
function relativeDate(ms) {
  const now      = new Date();
  const target   = new Date(ms);
  const todayKey = _dateKey(now);
  const targKey  = _dateKey(target);

  if (targKey === todayKey) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (targKey === _dateKey(yesterday)) return 'Yesterday';

  // Within the last 7 days → show weekday
  const diffMs = now - target;
  if (diffMs < 7 * 86400000) {
    return target.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return formatDate(ms);
}

/* ────────────────────────────────────────────────────────────
   GROUPING
──────────────────────────────────────────────────────────── */

/**
 * Group an array of sessions by calendar day (local time).
 * Returns a Map<string, session[]> where keys are 'YYYY-MM-DD',
 * ordered newest first.
 *
 * @param {Object[]} sessions
 * @returns {Map<string, Object[]>}
 */
function groupByDay(sessions) {
  const map = new Map();

  // Sort newest first before grouping
  const sorted = [...sessions].sort((a, b) => b.startTime - a.startTime);

  sorted.forEach(s => {
    const key = _dateKey(new Date(s.startTime));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });

  return map;
}

/**
 * Group an array of sessions by subject id.
 * Returns a Map<subjectId, session[]>.
 *
 * @param {Object[]} sessions
 * @returns {Map<string, Object[]>}
 */
function groupBySubject(sessions) {
  const map = new Map();

  sessions.forEach(s => {
    const key = String(s.subjectId ?? 'none');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });

  return map;
}

/**
 * Group sessions into ISO week buckets.
 * Returns a Map<'YYYY-WNN', session[]> ordered chronologically.
 *
 * @param {Object[]} sessions
 * @returns {Map<string, Object[]>}
 */
function groupByWeek(sessions) {
  const map = new Map();

  sessions.forEach(s => {
    const d   = new Date(s.startTime);
    const key = `${d.getFullYear()}-W${String(_isoWeek(d)).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });

  // Return sorted by key
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/* ────────────────────────────────────────────────────────────
   SUMMARY STATISTICS FOR A SESSION ARRAY
──────────────────────────────────────────────────────────── */

/**
 * Compute summary statistics for an array of sessions.
 *
 * @param {Object[]} sessions
 * @returns {{
 *   count:        number,
 *   totalMins:    number,
 *   avgMins:      number,
 *   longestMins:  number,
 *   shortestMins: number,
 *   uniqueDays:   number,
 *   uniqueSubjects: number,
 * }}
 */
function summarise(sessions) {
  if (!sessions.length) {
    return {
      count: 0, totalMins: 0, avgMins: 0,
      longestMins: 0, shortestMins: 0,
      uniqueDays: 0, uniqueSubjects: 0,
    };
  }

  const durations = sessions.map(s => s.duration || 0);
  const total     = durations.reduce((a, b) => a + b, 0);

  const daySet     = new Set(sessions.map(s => _dateKey(new Date(s.startTime))));
  const subjectSet = new Set(sessions.map(s => String(s.subjectId ?? 'none')));

  return {
    count:          sessions.length,
    totalMins:      total,
    avgMins:        Math.round(total / sessions.length),
    longestMins:    Math.max(...durations),
    shortestMins:   Math.min(...durations),
    uniqueDays:     daySet.size,
    uniqueSubjects: subjectSet.size,
  };
}

/* ────────────────────────────────────────────────────────────
   SUBJECT COLOUR LOOKUP
──────────────────────────────────────────────────────────── */

/** In-memory cache: subjectId → color */
let _colorCache = {};
let _colorCacheTs = 0;

/**
 * Get a colour for a subject id.
 * Falls back to the accent cyan if the subject is not found.
 * Cache is invalidated after 30 seconds to pick up new subjects.
 *
 * @param {number|string} subjectId
 * @returns {Promise<string>}  hex colour
 */
async function getSubjectColor(subjectId) {
  const now = Date.now();
  if (now - _colorCacheTs > 30000) {
    try {
      const subjects = await DB.getAllSubjects();
      _colorCache = {};
      subjects.forEach(s => { _colorCache[String(s.id)] = s.color; });
      _colorCacheTs = now;
    } catch (_) {}
  }
  return _colorCache[String(subjectId)] || '#00d4ff';
}

/**
 * Invalidate the subject colour cache immediately.
 * Called when a subject is added or deleted.
 */
function invalidateColorCache() {
  _colorCache   = {};
  _colorCacheTs = 0;
}

/* ────────────────────────────────────────────────────────────
   BEST SESSION FINDER
──────────────────────────────────────────────────────────── */

/**
 * Find the single longest session in an array.
 * @param {Object[]} sessions
 * @returns {Object|null}
 */
function longestSession(sessions) {
  if (!sessions.length) return null;
  return sessions.reduce((best, s) =>
    (s.duration || 0) > (best.duration || 0) ? s : best
  );
}

/**
 * Find the most productive day (highest total minutes)
 * in an array of sessions.
 *
 * @param {Object[]} sessions
 * @returns {{ dateKey: string, minutes: number } | null}
 */
function mostProductiveDay(sessions) {
  if (!sessions.length) return null;

  const byDay = {};
  sessions.forEach(s => {
    const key = _dateKey(new Date(s.startTime));
    byDay[key] = (byDay[key] || 0) + (s.duration || 0);
  });

  const best = Object.entries(byDay)
    .sort((a, b) => b[1] - a[1])[0];

  return best ? { dateKey: best[0], minutes: best[1] } : null;
}

/**
 * Find the most-studied subject in an array of sessions.
 * Returns { subjectId, subjectName, subjectColor, minutes }.
 *
 * @param {Object[]} sessions
 * @returns {Object|null}
 */
function topSubject(sessions) {
  if (!sessions.length) return null;

  const map = {};
  sessions.forEach(s => {
    const key = String(s.subjectId ?? 'none');
    if (!map[key]) {
      map[key] = {
        subjectId:    s.subjectId,
        subjectName:  s.subjectName  || 'Unknown',
        subjectColor: s.subjectColor || '#00d4ff',
        minutes:      0,
      };
    }
    map[key].minutes += s.duration || 0;
  });

  return Object.values(map)
    .sort((a, b) => b.minutes - a.minutes)[0] || null;
}

/* ────────────────────────────────────────────────────────────
   SESSION ITEM HTML
   Canonical HTML builder — single source of truth used by
   both the dashboard recent list and the full sessions page.
──────────────────────────────────────────────────────────── */

/**
 * Build an <li> HTML string for a session record.
 *
 * @param {Object}  session
 * @param {boolean} withDelete   include the delete button
 * @param {boolean} showRelDate  show "Today / Yesterday / …" label
 * @returns {string}  HTML string for innerHTML / insertAdjacentHTML
 */
function buildSessionItemHTML(session, withDelete = false, showRelDate = false) {
  const color    = _esc(session.subjectColor || '#00d4ff');
  const subject  = _esc(session.subjectName  || 'No Subject');
  const topic    = session.topic ? _esc(session.topic) : '';
  const dur      = formatDuration(session.duration);
  const dateLabel = showRelDate
    ? relativeDate(session.startTime)
    : formatDate(session.startTime);
  const time     = formatTime(session.startTime);

  const topicHTML = topic
    ? `<div class="session-item__topic">${topic}</div>`
    : '';

  const relDateHTML = showRelDate
    ? `<span class="session-item__rel-date">${dateLabel}</span>`
    : '';

  const deleteHTML = withDelete
    ? `<button class="session-item__delete"
               data-id="${session.id}"
               aria-label="Delete session"
               title="Delete">✕</button>`
    : '';

  return `
    <li class="session-item" data-id="${session.id}">
      <div class="session-item__color" style="background:${color}"></div>
      <div class="session-item__body">
        <div class="session-item__subject">${subject}</div>
        ${topicHTML}
        ${relDateHTML}
      </div>
      <div class="session-item__meta">
        <span class="session-item__duration">${dur}</span>
        <span class="session-item__date">${showRelDate ? time : `${dateLabel.replace(/^\w+,\s*/, '')} ${time}`}</span>
      </div>
      ${deleteHTML}
    </li>
  `.trim();
}

/* ────────────────────────────────────────────────────────────
   GROUPED SESSION LIST HTML
   Renders sessions in day-grouped sections with date headers.
──────────────────────────────────────────────────────────── */

/**
 * Build the full HTML for a grouped session list
 * (day headers + session items within each group).
 *
 * @param {Object[]} sessions   already sorted newest-first
 * @param {boolean}  withDelete include delete buttons
 * @returns {string}  HTML string
 */
function buildGroupedListHTML(sessions, withDelete = false) {
  if (!sessions.length) return '';

  const groups = groupByDay(sessions);
  let html = '';

  groups.forEach((groupSessions, dateKeyStr) => {
    const d          = _dateFromKey(dateKeyStr);
    const label      = relativeDate(d.getTime());
    const totalMins  = groupSessions.reduce((a, s) => a + (s.duration || 0), 0);
    const totalLabel = formatDuration(totalMins);

    html += `
      <div class="session-day-group">
        <div class="session-day-header">
          <span class="session-day-header__label">${_esc(label)}</span>
          <span class="session-day-header__total">${totalLabel}</span>
        </div>
        <ul class="session-items session-items--full">
          ${groupSessions.map(s => buildSessionItemHTML(s, withDelete, false)).join('')}
        </ul>
      </div>
    `;
  });

  return html;
}

/* ────────────────────────────────────────────────────────────
   FILTER HELPER
──────────────────────────────────────────────────────────── */

/**
 * Filter an array of sessions by optional criteria.
 *
 * @param {Object[]} sessions
 * @param {{
 *   subjectId?: string|number,
 *   dateFrom?:  string,   'YYYY-MM-DD'
 *   dateTo?:    string,   'YYYY-MM-DD'
 *   query?:     string,   search term against topic/notes/subject
 * }} filters
 * @returns {Object[]}
 */
function applyFilters(sessions, filters = {}) {
  let result = sessions;

  if (filters.subjectId) {
    result = result.filter(s =>
      String(s.subjectId) === String(filters.subjectId)
    );
  }

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    result = result.filter(s => s.startTime >= from);
  }

  if (filters.dateTo) {
    // Include the entire dateTo day
    const to = new Date(filters.dateTo).getTime() + 86400000 - 1;
    result = result.filter(s => s.startTime <= to);
  }

  if (filters.query) {
    const q = filters.query.toLowerCase();
    result = result.filter(s =>
      (s.subjectName || '').toLowerCase().includes(q) ||
      (s.topic       || '').toLowerCase().includes(q) ||
      (s.notes       || '').toLowerCase().includes(q)
    );
  }

  return result;
}

/* ────────────────────────────────────────────────────────────
   PRIVATE HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Format a Date as 'YYYY-MM-DD' in local time.
 * @param {Date} date
 * @returns {string}
 */
function _dateKey(date) {
  return DB.toDateKey(date);
}

/**
 * Parse a 'YYYY-MM-DD' key back to a local Date at midnight.
 * @param {string} key
 * @returns {Date}
 */
function _dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * ISO week number for a Date.
 * @param {Date} date
 * @returns {number}
 */
function _isoWeek(date) {
  const d      = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Escape HTML for safe DOM injection.
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.SessionsModule = {
  /* Formatting */
  formatDuration,
  formatDate,
  formatTime,
  formatDateTime,
  relativeDate,

  /* Grouping */
  groupByDay,
  groupBySubject,
  groupByWeek,

  /* Statistics */
  summarise,
  longestSession,
  mostProductiveDay,
  topSubject,

  /* HTML builders */
  buildSessionItemHTML,
  buildGroupedListHTML,

  /* Filtering */
  applyFilters,

  /* Subject colour */
  getSubjectColor,
  invalidateColorCache,
};
