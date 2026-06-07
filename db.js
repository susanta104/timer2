/* ============================================================
   MBBS STUDY COMMAND CENTER — js/db.js
   IndexedDB engine. Loaded first. Exposes window.DB.

   Object Stores:
   ─ sessions   { id, subjectId, subjectName, subjectColor, topic,
                  notes, duration (mins), startTime, endTime,
                  manual, createdAt }
   ─ subjects   { id, name, color, weeklyTarget, createdAt }
   ─ exams      { id, name, date, subjectId, createdAt }
   ─ topics     { id, subjectId, name, subtopics[], done, createdAt }
   ─ settings   { key, value }

   All timestamps are Unix ms (Date.now()).
   All IDs are auto-incremented integers.
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   CONSTANTS
──────────────────────────────────────────────────────────── */
const DB_NAME    = 'MBBSCommandCenter';
const DB_VERSION = 1;

/* Store names */
const STORE_SESSIONS = 'sessions';
const STORE_SUBJECTS = 'subjects';
const STORE_EXAMS    = 'exams';
const STORE_TOPICS   = 'topics';
const STORE_SETTINGS = 'settings';

/* ────────────────────────────────────────────────────────────
   INTERNAL STATE
──────────────────────────────────────────────────────────── */
let _db = null;   // IDBDatabase instance, set after open()

/* ────────────────────────────────────────────────────────────
   OPEN / UPGRADE
──────────────────────────────────────────────────────────── */

/**
 * Open the IndexedDB database.
 * Must be called (and awaited) before any other DB method.
 * Safe to call multiple times — returns immediately if already open.
 *
 * @returns {Promise<IDBDatabase>}
 */
function open() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    /* ── Schema creation / migration ── */
    request.onupgradeneeded = (event) => {
      const db      = event.target.result;
      const oldVer  = event.oldVersion;

      // ── v0 → v1 : initial schema ──────────────────────────
      if (oldVer < 1) {

        /* sessions */
        const sessionStore = db.createObjectStore(STORE_SESSIONS, {
          keyPath:       'id',
          autoIncrement: true,
        });
        sessionStore.createIndex('bySubject',   'subjectId',  { unique: false });
        sessionStore.createIndex('byStartTime', 'startTime',  { unique: false });
        sessionStore.createIndex('byCreatedAt', 'createdAt',  { unique: false });

        /* subjects */
        const subjectStore = db.createObjectStore(STORE_SUBJECTS, {
          keyPath:       'id',
          autoIncrement: true,
        });
        subjectStore.createIndex('byName',      'name',       { unique: false });
        subjectStore.createIndex('byCreatedAt', 'createdAt',  { unique: false });

        /* exams */
        const examStore = db.createObjectStore(STORE_EXAMS, {
          keyPath:       'id',
          autoIncrement: true,
        });
        examStore.createIndex('byDate',      'date',       { unique: false });
        examStore.createIndex('byCreatedAt', 'createdAt',  { unique: false });

        /* topics (syllabus) */
        const topicStore = db.createObjectStore(STORE_TOPICS, {
          keyPath:       'id',
          autoIncrement: true,
        });
        topicStore.createIndex('bySubject',   'subjectId',  { unique: false });
        topicStore.createIndex('byCreatedAt', 'createdAt',  { unique: false });

        /* settings (key-value) */
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }

      // ── future migrations go here ──────────────────────────
      // if (oldVer < 2) { ... }
    };

    request.onsuccess = (event) => {
      _db = event.target.result;

      /* Handle version change from another tab */
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        window.location.reload();
      };

      resolve(_db);
    };

    request.onerror = (event) => {
      console.error('[DB] open() failed:', event.target.error);
      reject(event.target.error);
    };

    request.onblocked = () => {
      console.warn('[DB] open() blocked — close other tabs running this app.');
    };
  });
}

/* ────────────────────────────────────────────────────────────
   TRANSACTION HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Create a read-write transaction for one or more stores.
 * @param {string|string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @returns {IDBTransaction}
 */
function tx(storeNames, mode = 'readonly') {
  if (!_db) throw new Error('[DB] Database not open. Call DB.open() first.');
  return _db.transaction(storeNames, mode);
}

/**
 * Wrap an IDBRequest in a Promise.
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Collect all records from a cursor into an array.
 * @param {IDBRequest} cursorRequest  — request returned by openCursor / openKeyCursor
 * @returns {Promise<any[]>}
 */
function cursorToArray(cursorRequest) {
  return new Promise((resolve, reject) => {
    const results = [];
    cursorRequest.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    cursorRequest.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Wrap a transaction's completion in a Promise (for write ops).
 * @param {IDBTransaction} transaction
 * @returns {Promise<void>}
 */
function txComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror    = (e) => reject(e.target.error);
    transaction.onabort    = (e) => reject(e.target.error);
  });
}

/* ────────────────────────────────────────────────────────────
   SESSIONS
──────────────────────────────────────────────────────────── */

/**
 * Add a new study session record.
 * @param {Object} session
 * @returns {Promise<number>} new session id
 */
function addSession(session) {
  return new Promise((resolve, reject) => {
    const transaction = tx(STORE_SESSIONS, 'readwrite');
    const store       = transaction.objectStore(STORE_SESSIONS);
    const req         = store.add(session);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Get all sessions, newest first.
 * @returns {Promise<Object[]>}
 */
async function getAllSessions() {
  const transaction = tx(STORE_SESSIONS, 'readonly');
  const store       = transaction.objectStore(STORE_SESSIONS);
  const results     = await cursorToArray(store.openCursor());
  return results.sort((a, b) => b.startTime - a.startTime);
}

/**
 * Get the N most recent sessions.
 * @param {number} limit
 * @returns {Promise<Object[]>}
 */
async function getRecentSessions(limit = 10) {
  const all = await getAllSessions();
  return all.slice(0, limit);
}

/**
 * Get all sessions for a specific subject.
 * @param {number} subjectId
 * @returns {Promise<Object[]>}
 */
async function getSessionsBySubject(subjectId) {
  const transaction = tx(STORE_SESSIONS, 'readonly');
  const store       = transaction.objectStore(STORE_SESSIONS);
  const index       = store.index('bySubject');
  const results     = await cursorToArray(index.openCursor(IDBKeyRange.only(subjectId)));
  return results.sort((a, b) => b.startTime - a.startTime);
}

/**
 * Get sessions within a time range [fromMs, toMs].
 * @param {number} fromMs  Unix timestamp ms (inclusive)
 * @param {number} toMs    Unix timestamp ms (inclusive)
 * @returns {Promise<Object[]>}
 */
async function getSessionsInRange(fromMs, toMs) {
  const transaction = tx(STORE_SESSIONS, 'readonly');
  const store       = transaction.objectStore(STORE_SESSIONS);
  const index       = store.index('byStartTime');
  const range       = IDBKeyRange.bound(fromMs, toMs, false, false);
  const results     = await cursorToArray(index.openCursor(range));
  return results.sort((a, b) => b.startTime - a.startTime);
}

/**
 * Get sessions for a single calendar day (local time).
 * @param {Date|number} date  Date object or timestamp
 * @returns {Promise<Object[]>}
 */
function getSessionsForDay(date) {
  const d     = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end   = start + 86400000 - 1;
  return getSessionsInRange(start, end);
}

/**
 * Delete a session by id.
 * @param {number} id
 * @returns {Promise<void>}
 */
function deleteSession(id) {
  const transaction = tx(STORE_SESSIONS, 'readwrite');
  const store       = transaction.objectStore(STORE_SESSIONS);
  store.delete(id);
  return txComplete(transaction);
}

/**
 * Update an existing session (merge patch).
 * @param {number} id
 * @param {Object} patch
 * @returns {Promise<void>}
 */
async function updateSession(id, patch) {
  const transaction = tx(STORE_SESSIONS, 'readwrite');
  const store       = transaction.objectStore(STORE_SESSIONS);
  const existing    = await promisify(store.get(id));
  if (!existing) throw new Error(`[DB] Session ${id} not found`);
  store.put({ ...existing, ...patch, id });
  return txComplete(transaction);
}

/**
 * Delete all sessions.
 * @returns {Promise<void>}
 */
function clearAllSessions() {
  const transaction = tx(STORE_SESSIONS, 'readwrite');
  transaction.objectStore(STORE_SESSIONS).clear();
  return txComplete(transaction);
}

/* ────────────────────────────────────────────────────────────
   SUBJECTS
──────────────────────────────────────────────────────────── */

/**
 * Add a new subject.
 * @param {Object} subject  { name, color, weeklyTarget, createdAt }
 * @returns {Promise<number>} new subject id
 */
function addSubject(subject) {
  return new Promise((resolve, reject) => {
    const transaction = tx(STORE_SUBJECTS, 'readwrite');
    const store       = transaction.objectStore(STORE_SUBJECTS);
    const req         = store.add(subject);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Get all subjects, sorted by creation date ascending.
 * @returns {Promise<Object[]>}
 */
async function getAllSubjects() {
  const transaction = tx(STORE_SUBJECTS, 'readonly');
  const store       = transaction.objectStore(STORE_SUBJECTS);
  const results     = await cursorToArray(store.openCursor());
  return results.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get a single subject by id.
 * @param {number} id
 * @returns {Promise<Object|undefined>}
 */
function getSubject(id) {
  const transaction = tx(STORE_SUBJECTS, 'readonly');
  const store       = transaction.objectStore(STORE_SUBJECTS);
  return promisify(store.get(id));
}

/**
 * Update a subject (merge patch).
 * @param {number} id
 * @param {Object} patch
 * @returns {Promise<void>}
 */
async function updateSubject(id, patch) {
  const transaction = tx(STORE_SUBJECTS, 'readwrite');
  const store       = transaction.objectStore(STORE_SUBJECTS);
  const existing    = await promisify(store.get(id));
  if (!existing) throw new Error(`[DB] Subject ${id} not found`);
  store.put({ ...existing, ...patch, id });
  return txComplete(transaction);
}

/**
 * Delete a subject by id.
 * Does NOT cascade-delete sessions — they retain subjectName/Color for history.
 * @param {number} id
 * @returns {Promise<void>}
 */
function deleteSubject(id) {
  const transaction = tx(STORE_SUBJECTS, 'readwrite');
  transaction.objectStore(STORE_SUBJECTS).delete(id);
  return txComplete(transaction);
}

/* ────────────────────────────────────────────────────────────
   EXAMS
──────────────────────────────────────────────────────────── */

/**
 * Add a new exam.
 * @param {Object} exam  { name, date (ms), subjectId, createdAt }
 * @returns {Promise<number>} new exam id
 */
function addExam(exam) {
  return new Promise((resolve, reject) => {
    const transaction = tx(STORE_EXAMS, 'readwrite');
    const store       = transaction.objectStore(STORE_EXAMS);
    const req         = store.add(exam);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Get all exams, sorted by date ascending.
 * @returns {Promise<Object[]>}
 */
async function getAllExams() {
  const transaction = tx(STORE_EXAMS, 'readonly');
  const store       = transaction.objectStore(STORE_EXAMS);
  const results     = await cursorToArray(store.openCursor());
  return results.sort((a, b) => a.date - b.date);
}

/**
 * Get the next upcoming exam (date > now).
 * @returns {Promise<Object|null>}
 */
async function getNextExam() {
  const all    = await getAllExams();
  const now    = Date.now();
  const future = all.filter(e => e.date > now);
  return future.length ? future[0] : null;
}

/**
 * Delete an exam by id.
 * @param {number} id
 * @returns {Promise<void>}
 */
function deleteExam(id) {
  const transaction = tx(STORE_EXAMS, 'readwrite');
  transaction.objectStore(STORE_EXAMS).delete(id);
  return txComplete(transaction);
}

/* ────────────────────────────────────────────────────────────
   TOPICS (Syllabus)
──────────────────────────────────────────────────────────── */

/**
 * Add a new syllabus topic.
 * @param {Object} topic  { subjectId, name, subtopics[], done, createdAt }
 * @returns {Promise<number>} new topic id
 */
function addTopic(topic) {
  return new Promise((resolve, reject) => {
    const transaction = tx(STORE_TOPICS, 'readwrite');
    const store       = transaction.objectStore(STORE_TOPICS);
    const req         = store.add(topic);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Get all topics for a given subject, ordered by creation.
 * @param {number|string} subjectId
 * @returns {Promise<Object[]>}
 */
async function getTopicsBySubject(subjectId) {
  const transaction = tx(STORE_TOPICS, 'readonly');
  const store       = transaction.objectStore(STORE_TOPICS);
  const index       = store.index('bySubject');
  // IndexedDB stores keys as-added; coerce to Number for lookup
  const results     = await cursorToArray(
    index.openCursor(IDBKeyRange.only(Number(subjectId)))
  );
  return results.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get all topics across all subjects.
 * @returns {Promise<Object[]>}
 */
async function getAllTopics() {
  const transaction = tx(STORE_TOPICS, 'readonly');
  const store       = transaction.objectStore(STORE_TOPICS);
  return cursorToArray(store.openCursor());
}

/**
 * Update a topic (merge patch).
 * Used to toggle done state or update subtopics array.
 * @param {number} id
 * @param {Object} patch
 * @returns {Promise<void>}
 */
async function updateTopic(id, patch) {
  const transaction = tx(STORE_TOPICS, 'readwrite');
  const store       = transaction.objectStore(STORE_TOPICS);
  const existing    = await promisify(store.get(id));
  if (!existing) throw new Error(`[DB] Topic ${id} not found`);
  store.put({ ...existing, ...patch, id });
  return txComplete(transaction);
}

/**
 * Delete a topic by id.
 * @param {number} id
 * @returns {Promise<void>}
 */
function deleteTopic(id) {
  const transaction = tx(STORE_TOPICS, 'readwrite');
  transaction.objectStore(STORE_TOPICS).delete(id);
  return txComplete(transaction);
}

/**
 * Delete all topics for a given subject.
 * Called when a subject is deleted.
 * @param {number} subjectId
 * @returns {Promise<void>}
 */
async function deleteTopicsBySubject(subjectId) {
  const topics = await getTopicsBySubject(subjectId);
  if (!topics.length) return;

  const transaction = tx(STORE_TOPICS, 'readwrite');
  const store       = transaction.objectStore(STORE_TOPICS);
  topics.forEach(t => store.delete(t.id));
  return txComplete(transaction);
}

/* ────────────────────────────────────────────────────────────
   SETTINGS (key-value store)
──────────────────────────────────────────────────────────── */

/**
 * Get a setting value by key.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getSetting(key) {
  const transaction = tx(STORE_SETTINGS, 'readonly');
  const store       = transaction.objectStore(STORE_SETTINGS);
  const record      = await promisify(store.get(key));
  return record ? record.value : undefined;
}

/**
 * Set a setting value.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
function setSetting(key, value) {
  const transaction = tx(STORE_SETTINGS, 'readwrite');
  transaction.objectStore(STORE_SETTINGS).put({ key, value });
  return txComplete(transaction);
}

/**
 * Delete a setting.
 * @param {string} key
 * @returns {Promise<void>}
 */
function deleteSetting(key) {
  const transaction = tx(STORE_SETTINGS, 'readwrite');
  transaction.objectStore(STORE_SETTINGS).delete(key);
  return txComplete(transaction);
}

/**
 * Get all settings as a plain { key: value } object.
 * @returns {Promise<Object>}
 */
async function getAllSettings() {
  const transaction = tx(STORE_SETTINGS, 'readonly');
  const store       = transaction.objectStore(STORE_SETTINGS);
  const records     = await cursorToArray(store.openCursor());
  const map = {};
  records.forEach(r => { map[r.key] = r.value; });
  return map;
}

/* ────────────────────────────────────────────────────────────
   BULK OPERATIONS (used by backup / reset)
──────────────────────────────────────────────────────────── */

/**
 * Export a complete snapshot of all data.
 * @returns {Promise<Object>} { sessions, subjects, exams, topics, settings, exportedAt }
 */
async function exportAll() {
  const [sessions, subjects, exams, topics, settings] = await Promise.all([
    getAllSessions(),
    getAllSubjects(),
    getAllExams(),
    getAllTopics(),
    getAllSettings(),
  ]);

  return {
    version:    DB_VERSION,
    exportedAt: Date.now(),
    sessions,
    subjects,
    exams,
    topics,
    settings,
  };
}

/**
 * Import a complete snapshot, replacing all existing data.
 * Runs everything in a single transaction sequence to keep
 * the stores consistent.
 *
 * @param {Object} snapshot  — produced by exportAll()
 * @returns {Promise<void>}
 */
async function importAll(snapshot) {
  const { sessions = [], subjects = [], exams = [], topics = [], settings = {} } = snapshot;

  // Clear all stores first
  await resetAll();

  // Re-open in case resetAll closed the db
  await open();

  // Subjects first (sessions reference them by id)
  if (subjects.length) {
    const t = tx(STORE_SUBJECTS, 'readwrite');
    const s = t.objectStore(STORE_SUBJECTS);
    subjects.forEach(sub => s.put(sub));
    await txComplete(t);
  }

  // Sessions
  if (sessions.length) {
    const t = tx(STORE_SESSIONS, 'readwrite');
    const s = t.objectStore(STORE_SESSIONS);
    sessions.forEach(sess => s.put(sess));
    await txComplete(t);
  }

  // Exams
  if (exams.length) {
    const t = tx(STORE_EXAMS, 'readwrite');
    const s = t.objectStore(STORE_EXAMS);
    exams.forEach(exam => s.put(exam));
    await txComplete(t);
  }

  // Topics
  if (topics.length) {
    const t = tx(STORE_TOPICS, 'readwrite');
    const s = t.objectStore(STORE_TOPICS);
    topics.forEach(topic => s.put(topic));
    await txComplete(t);
  }

  // Settings
  const settingKeys = Object.keys(settings);
  if (settingKeys.length) {
    const t = tx(STORE_SETTINGS, 'readwrite');
    const s = t.objectStore(STORE_SETTINGS);
    settingKeys.forEach(key => s.put({ key, value: settings[key] }));
    await txComplete(t);
  }
}

/**
 * Wipe every object store — full factory reset.
 * After this call, open() must be called again before any reads/writes.
 * @returns {Promise<void>}
 */
async function resetAll() {
  const stores = [
    STORE_SESSIONS,
    STORE_SUBJECTS,
    STORE_EXAMS,
    STORE_TOPICS,
    STORE_SETTINGS,
  ];

  const transaction = tx(stores, 'readwrite');
  stores.forEach(name => transaction.objectStore(name).clear());
  return txComplete(transaction);
}

/* ────────────────────────────────────────────────────────────
   ANALYTICS HELPERS
   Pre-aggregated queries used by stats.js and charts.js
──────────────────────────────────────────────────────────── */

/**
 * Get total study minutes for a specific calendar day.
 * @param {Date|number} date
 * @returns {Promise<number>} minutes
 */
async function getDayMinutes(date) {
  const sessions = await getSessionsForDay(date);
  return sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
}

/**
 * Get total study minutes for each of the last N days.
 * Returns an array of { date: Date, minutes: number } objects,
 * index 0 = oldest, index N-1 = today.
 *
 * @param {number} days
 * @returns {Promise<Array<{date: Date, minutes: number}>>}
 */
async function getLastNDaysMinutes(days = 7) {
  const result = [];
  const today  = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const minutes = await getDayMinutes(d);
    result.push({ date: new Date(d), minutes });
  }

  return result;
}

/**
 * Aggregate total minutes per subject across all sessions.
 * @returns {Promise<Array<{subjectId, subjectName, subjectColor, minutes}>>}
 */
async function getMinutesPerSubject() {
  const sessions = await getAllSessions();
  const map      = {};

  sessions.forEach(s => {
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

/**
 * Get daily session counts for a date range.
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Promise<Map<string, number>>} Map of 'YYYY-MM-DD' → count
 */
async function getDailySessionCounts(fromMs, toMs) {
  const sessions = await getSessionsInRange(fromMs, toMs);
  const map      = new Map();

  sessions.forEach(s => {
    const key = toDateKey(new Date(s.startTime));
    map.set(key, (map.get(key) || 0) + 1);
  });

  return map;
}

/**
 * Get daily minutes for a date range.
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Promise<Map<string, number>>} Map of 'YYYY-MM-DD' → minutes
 */
async function getDailyMinutes(fromMs, toMs) {
  const sessions = await getSessionsInRange(fromMs, toMs);
  const map      = new Map();

  sessions.forEach(s => {
    const key = toDateKey(new Date(s.startTime));
    map.set(key, (map.get(key) || 0) + (s.duration || 0));
  });

  return map;
}

/**
 * Get the set of unique calendar days that have at least one session.
 * @returns {Promise<Set<string>>} Set of 'YYYY-MM-DD' strings
 */
async function getStudiedDays() {
  const sessions = await getAllSessions();
  const days     = new Set();
  sessions.forEach(s => days.add(toDateKey(new Date(s.startTime))));
  return days;
}

/**
 * Count of unique calendar days that have sessions.
 * @returns {Promise<number>}
 */
async function getTotalStudyDays() {
  const days = await getStudiedDays();
  return days.size;
}

/* ────────────────────────────────────────────────────────────
   PRIVATE HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Format a Date as 'YYYY-MM-DD' in local time.
 * @param {Date} date
 * @returns {string}
 */
function toDateKey(date) {
  const y  = date.getFullYear();
  const m  = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.DB = {
  /* Lifecycle */
  open,

  /* Sessions */
  addSession,
  getAllSessions,
  getRecentSessions,
  getSessionsBySubject,
  getSessionsInRange,
  getSessionsForDay,
  deleteSession,
  updateSession,
  clearAllSessions,

  /* Subjects */
  addSubject,
  getAllSubjects,
  getSubject,
  updateSubject,
  deleteSubject,

  /* Exams */
  addExam,
  getAllExams,
  getNextExam,
  deleteExam,

  /* Topics (Syllabus) */
  addTopic,
  getTopicsBySubject,
  getAllTopics,
  updateTopic,
  deleteTopic,
  deleteTopicsBySubject,

  /* Settings */
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,

  /* Bulk */
  exportAll,
  importAll,
  resetAll,

  /* Analytics helpers */
  getDayMinutes,
  getLastNDaysMinutes,
  getMinutesPerSubject,
  getDailySessionCounts,
  getDailyMinutes,
  getStudiedDays,
  getTotalStudyDays,

  /* Utility */
  toDateKey,
};
