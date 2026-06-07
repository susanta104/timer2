/* ============================================================
   MBBS STUDY COMMAND CENTER — js/backup.js
   Export and import a full JSON backup of all app data.

   Export:
   ─ Calls DB.exportAll() to get sessions, subjects, exams,
     topics, and settings
   ─ Serialises to JSON and triggers a browser file download
   ─ Filename includes the current date for easy versioning

   Import:
   ─ Reads a user-selected .json file via FileReader
   ─ Validates the structure before writing anything to DB
   ─ Calls DB.importAll() which clears existing data and
     replaces it with the backup contents
   ─ Shows progress toasts throughout

   Exposes: window.BackupModule
   Depends: window.DB, window.App
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   EXPORT
──────────────────────────────────────────────────────────── */

/**
 * Export all data as a downloadable JSON file.
 * Filename: mbbs-backup-YYYY-MM-DD.json
 */
async function exportData() {
  try {
    App.showToast('Preparing backup…', 'info', 2000);

    const snapshot = await DB.exportAll();

    // Pretty-print so the file is human-readable
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);

    const dateStr  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `mbbs-backup-${dateStr}.json`;

    const anchor = document.createElement('a');
    anchor.href     = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();

    // Clean up
    setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 1000);

    const sessionCount = snapshot.sessions?.length ?? 0;
    const subjectCount = snapshot.subjects?.length ?? 0;
    App.showToast(
      `Backup downloaded — ${sessionCount} session${sessionCount !== 1 ? 's' : ''}, ` +
      `${subjectCount} subject${subjectCount !== 1 ? 's' : ''}.`,
      'success'
    );

  } catch (err) {
    console.error('[Backup] exportData:', err);
    App.showToast('Export failed. Please try again.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   IMPORT
──────────────────────────────────────────────────────────── */

/**
 * Read a user-selected File, validate it, then restore to DB.
 * @param {File} file  — selected via <input type="file">
 */
async function importData(file) {
  if (!file) return;

  // Basic file type check
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    App.showToast('Please select a valid .json backup file.', 'error');
    return;
  }

  App.showToast('Reading backup file…', 'info', 2000);

  try {
    const text     = await _readFile(file);
    const snapshot = _parseJSON(text);

    if (!snapshot) {
      App.showToast('Invalid backup file — could not parse JSON.', 'error');
      return;
    }

    const validation = _validateSnapshot(snapshot);
    if (!validation.ok) {
      App.showToast(`Invalid backup: ${validation.reason}`, 'error');
      return;
    }

    // Confirm before overwriting
    App.showConfirm(
      `Restore backup from ${_snapshotDateLabel(snapshot)}?\n\n` +
      `This will replace all current data with:\n` +
      `• ${snapshot.sessions?.length ?? 0} sessions\n` +
      `• ${snapshot.subjects?.length ?? 0} subjects\n` +
      `• ${snapshot.exams?.length    ?? 0} exams\n` +
      `• ${snapshot.topics?.length   ?? 0} topics`,
      async () => {
        await _performImport(snapshot);
      }
    );

  } catch (err) {
    console.error('[Backup] importData:', err);
    App.showToast('Import failed — file could not be read.', 'error');
  }
}

/**
 * Actually write the snapshot to DB and refresh the UI.
 * @param {Object} snapshot
 */
async function _performImport(snapshot) {
  try {
    App.showToast('Restoring data…', 'info', 3000);

    await DB.importAll(snapshot);

    // Destroy all chart instances so they redraw with fresh data
    if (typeof ChartsModule !== 'undefined') {
      ChartsModule.destroyAll();
    }

    // Stop any live countdown tick
    if (typeof CountdownModule !== 'undefined') {
      CountdownModule.stopTick();
    }

    // Repopulate all subject selects
    await App.populateAllSubjectSelects();

    // Refresh current section
    await App.navigateTo('dashboard');

    const sessionCount = snapshot.sessions?.length ?? 0;
    App.showToast(
      `Restore complete — ${sessionCount} session${sessionCount !== 1 ? 's' : ''} imported.`,
      'success',
      4000
    );

  } catch (err) {
    console.error('[Backup] _performImport:', err);
    App.showToast('Restore failed. Your previous data may still be intact.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   FILE READER WRAPPER
──────────────────────────────────────────────────────────── */

/**
 * Read a File as text using FileReader wrapped in a Promise.
 * @param {File} file
 * @returns {Promise<string>}
 */
function _readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = ()  => reject(new Error('FileReader error'));
    reader.readAsText(file, 'UTF-8');
  });
}

/* ────────────────────────────────────────────────────────────
   JSON PARSER  (safe — returns null on failure)
──────────────────────────────────────────────────────────── */

/**
 * Safely parse a JSON string.
 * @param {string} text
 * @returns {Object|null}
 */
function _parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────
   SNAPSHOT VALIDATION
──────────────────────────────────────────────────────────── */

/**
 * Validate that a parsed snapshot has the expected structure.
 * We check for the presence of expected top-level arrays.
 * We do NOT do deep field validation — missing optional fields
 * are handled gracefully by DB.importAll().
 *
 * @param {any} snapshot
 * @returns {{ ok: boolean, reason?: string }}
 */
function _validateSnapshot(snapshot) {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return { ok: false, reason: 'Root value is not an object.' };
  }

  // At minimum we expect at least one of the main arrays to exist
  const hasAnyData =
    Array.isArray(snapshot.sessions) ||
    Array.isArray(snapshot.subjects) ||
    Array.isArray(snapshot.exams)    ||
    Array.isArray(snapshot.topics);

  if (!hasAnyData) {
    return {
      ok:     false,
      reason: 'File does not contain any recognisable MBBS backup data.',
    };
  }

  // Validate sessions array items have minimal required fields
  if (Array.isArray(snapshot.sessions) && snapshot.sessions.length > 0) {
    const sample = snapshot.sessions[0];
    if (typeof sample !== 'object' || sample === null) {
      return { ok: false, reason: 'Sessions array contains invalid entries.' };
    }
  }

  // Validate subjects
  if (Array.isArray(snapshot.subjects) && snapshot.subjects.length > 0) {
    const sample = snapshot.subjects[0];
    if (!sample?.name) {
      return { ok: false, reason: 'Subjects array entries are missing required fields.' };
    }
  }

  return { ok: true };
}

/* ────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Format a human-readable date label from a snapshot's exportedAt field.
 * Falls back to "unknown date" if missing.
 *
 * @param {Object} snapshot
 * @returns {string}
 */
function _snapshotDateLabel(snapshot) {
  if (!snapshot.exportedAt) return 'unknown date';
  try {
    return new Date(snapshot.exportedAt).toLocaleDateString('en-US', {
      weekday: 'short',
      year:    'numeric',
      month:   'short',
      day:     'numeric',
    });
  } catch (_) {
    return 'unknown date';
  }
}

/**
 * Generate a quick summary string for a snapshot.
 * Useful for display in confirmations or logs.
 *
 * @param {Object} snapshot
 * @returns {string}
 */
function summarise(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 'Empty snapshot';
  const s = snapshot.sessions?.length ?? 0;
  const u = snapshot.subjects?.length ?? 0;
  const e = snapshot.exams?.length    ?? 0;
  const t = snapshot.topics?.length   ?? 0;
  return `${s} sessions · ${u} subjects · ${e} exams · ${t} topics`;
}

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.BackupModule = {
  exportData,
  importData,
  summarise,
};
