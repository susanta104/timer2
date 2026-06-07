/* ============================================================
   MBBS STUDY COMMAND CENTER — js/syllabus.js
   Manages the Syllabus Tracker section.

   Responsibilities:
   ─ Render topic list for a selected subject
   ─ Toggle topic done / undone
   ─ Toggle individual subtopic done / undone
   ─ Expand / collapse subtopic list per topic
   ─ Update the completion progress bar and percentage
   ─ Delete individual topics
   ─ Persist all state changes to IndexedDB via DB module

   Exposes: window.SyllabusModule
   Depends: window.DB, window.App
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   INTERNAL STATE
──────────────────────────────────────────────────────────── */

/** Currently selected subject id (string) */
let _currentSubjectId = null;

/** Locally cached topics array for the current subject */
let _topics = [];

/* ────────────────────────────────────────────────────────────
   MAIN RENDER
──────────────────────────────────────────────────────────── */

/**
 * Render the full syllabus view for a given subject.
 * Called by app.js whenever the subject filter changes or
 * a topic is added / toggled / deleted.
 *
 * @param {number|string} subjectId
 */
async function render(subjectId) {
  _currentSubjectId = String(subjectId);

  // Fetch topics and subject info in parallel
  const [topics, subjects] = await Promise.all([
    DB.getTopicsBySubject(Number(subjectId)),
    DB.getAllSubjects(),
  ]);

  _topics = topics;

  const subject = subjects.find(s => String(s.id) === _currentSubjectId);

  // Update completion overview header
  _renderOverview(subject, topics);

  // Render topic list
  _renderTopicList(topics);
}

/* ────────────────────────────────────────────────────────────
   OVERVIEW BAR
──────────────────────────────────────────────────────────── */

/**
 * Update the completion overview card (subject name, %, progress bar).
 *
 * @param {Object|undefined} subject
 * @param {Object[]}         topics
 */
function _renderOverview(subject, topics) {
  const nameEl     = document.getElementById('syllabus-subject-name');
  const pctEl      = document.getElementById('syllabus-pct');
  const barEl      = document.getElementById('syllabus-progress-bar');
  const doneEl     = document.getElementById('topics-done');
  const totalEl    = document.getElementById('topics-total');

  if (!nameEl) return;

  // Subject label
  nameEl.textContent = subject ? subject.name : 'Unknown Subject';

  // Count completion — a topic counts as done when its `done` flag is true.
  // If it has subtopics, it is also considered done when ALL subtopics are done.
  let doneCt  = 0;
  let totalCt = topics.length;

  topics.forEach(t => {
    if (_isTopicComplete(t)) doneCt++;
  });

  const pct = totalCt > 0 ? Math.round((doneCt / totalCt) * 100) : 0;

  if (pctEl)   pctEl.textContent = `${pct}%`;
  if (doneEl)  doneEl.textContent = doneCt;
  if (totalEl) totalEl.textContent = totalCt;

  if (barEl) {
    barEl.style.width = `${pct}%`;
    barEl.setAttribute('aria-valuenow', pct);

    // Colour shift: red → amber → green
    barEl.className = 'progress-bar ' + (
      pct >= 100 ? 'progress-bar--success' :
      pct >= 50  ? 'progress-bar--warning' : ''
    );

    // Apply subject accent colour for partial progress
    if (pct < 100 && subject?.color) {
      barEl.style.background = subject.color;
    } else if (pct >= 100) {
      barEl.style.background = '';
    }
  }
}

/* ────────────────────────────────────────────────────────────
   TOPIC LIST
──────────────────────────────────────────────────────────── */

/**
 * Render the scrollable list of topics.
 * @param {Object[]} topics
 */
function _renderTopicList(topics) {
  const listEl  = document.getElementById('syllabus-list');
  const emptyEl = document.getElementById('syllabus-empty');

  if (!listEl) return;

  // Clear previous content but keep empty-state el
  listEl.querySelectorAll('.syllabus-topic').forEach(el => el.remove());

  if (!topics.length) {
    emptyEl?.classList.remove('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');

  topics.forEach(topic => {
    const el = _buildTopicElement(topic);
    listEl.appendChild(el);
  });
}

/* ────────────────────────────────────────────────────────────
   TOPIC ELEMENT BUILDER
──────────────────────────────────────────────────────────── */

/**
 * Build a single syllabus-topic DOM element.
 * @param {Object} topic
 * @returns {HTMLElement}
 */
function _buildTopicElement(topic) {
  const complete    = _isTopicComplete(topic);
  const hasSubtopics= Array.isArray(topic.subtopics) && topic.subtopics.length > 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'syllabus-topic' +
    (complete        ? ' done'     : '') +
    (hasSubtopics    ? ' has-subtopics' : '');
  wrapper.dataset.id = topic.id;

  /* ── Header row ── */
  const header = document.createElement('div');
  header.className = 'syllabus-topic__header';

  // Done checkbox
  const check = document.createElement('div');
  check.className   = 'syllabus-topic__check';
  check.textContent = complete ? '✓' : '';
  check.setAttribute('role', 'checkbox');
  check.setAttribute('aria-checked', String(complete));
  check.setAttribute('aria-label', `Mark "${_esc(topic.name)}" as ${complete ? 'incomplete' : 'complete'}`);
  check.setAttribute('tabindex', '0');

  // Topic name
  const name = document.createElement('div');
  name.className   = 'syllabus-topic__name';
  name.textContent = topic.name;

  // Subtopic count badge (if any)
  let countBadge = null;
  if (hasSubtopics) {
    const doneSubs = topic.subtopics.filter(s => s.done).length;
    countBadge = document.createElement('span');
    countBadge.className   = 'subtopic-count';
    countBadge.textContent = `${doneSubs}/${topic.subtopics.length}`;
    countBadge.style.cssText =
      'font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);margin-left:6px;';
  }

  // Expand arrow (only if subtopics exist)
  let expandArrow = null;
  if (hasSubtopics) {
    expandArrow = document.createElement('span');
    expandArrow.className   = 'syllabus-topic__expand';
    expandArrow.textContent = '▾';
    expandArrow.setAttribute('aria-hidden', 'true');
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'syllabus-topic__actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.className  = 'icon-btn icon-btn--sm';
  deleteBtn.textContent = '✕';
  deleteBtn.setAttribute('aria-label', `Delete topic "${_esc(topic.name)}"`);
  deleteBtn.title = 'Delete topic';

  actions.appendChild(deleteBtn);

  // Assemble header
  header.appendChild(check);
  header.appendChild(name);
  if (countBadge)  name.appendChild(countBadge);
  if (expandArrow) header.appendChild(expandArrow);
  header.appendChild(actions);

  wrapper.appendChild(header);

  /* ── Subtopics list ── */
  if (hasSubtopics) {
    const subList = _buildSubtopicList(topic);
    wrapper.appendChild(subList);
  }

  /* ── EVENT LISTENERS ── */

  // Toggle topic done/undone
  const toggleDone = async (e) => {
    e.stopPropagation();
    await _toggleTopicDone(topic.id, !complete);
  };

  check.addEventListener('click',   toggleDone);
  check.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleDone(e);
    }
  });

  // Expand / collapse subtopics on header click (not on buttons)
  if (hasSubtopics) {
    header.addEventListener('click', (e) => {
      // Don't toggle expand when clicking check or delete
      if (e.target.closest('.syllabus-topic__check') ||
          e.target.closest('.syllabus-topic__actions')) return;

      wrapper.classList.toggle('expanded');
      const isExpanded = wrapper.classList.contains('expanded');
      if (expandArrow) {
        expandArrow.textContent = isExpanded ? '▴' : '▾';
      }
    });
  }

  // Delete topic
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _deleteTopic(topic.id, topic.name);
  });

  return wrapper;
}

/* ────────────────────────────────────────────────────────────
   SUBTOPIC LIST
──────────────────────────────────────────────────────────── */

/**
 * Build the collapsible subtopics <div> for a topic.
 * @param {Object} topic
 * @returns {HTMLElement}
 */
function _buildSubtopicList(topic) {
  const container = document.createElement('div');
  container.className = 'syllabus-subtopics';

  topic.subtopics.forEach((sub, idx) => {
    const row = document.createElement('div');
    row.className = 'syllabus-subtopic';

    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = sub.done;
    cb.id      = `sub-${topic.id}-${idx}`;
    cb.setAttribute('aria-label', sub.name);

    const label = document.createElement('label');
    label.htmlFor   = `sub-${topic.id}-${idx}`;
    label.className = 'syllabus-subtopic__name' + (sub.done ? ' done-text' : '');
    label.textContent = sub.name;

    cb.addEventListener('change', () => {
      _toggleSubtopicDone(topic.id, idx, cb.checked);
    });

    row.appendChild(cb);
    row.appendChild(label);
    container.appendChild(row);
  });

  return container;
}

/* ────────────────────────────────────────────────────────────
   TOGGLE HANDLERS
──────────────────────────────────────────────────────────── */

/**
 * Toggle the top-level done flag on a topic.
 * When marking done: also marks all subtopics done.
 * When marking undone: leaves subtopics as-is.
 *
 * @param {number}  topicId
 * @param {boolean} newDone
 */
async function _toggleTopicDone(topicId, newDone) {
  const topic = _topics.find(t => t.id === topicId);
  if (!topic) return;

  // If marking the whole topic done, also mark all subtopics done
  let subtopics = topic.subtopics || [];
  if (newDone && subtopics.length > 0) {
    subtopics = subtopics.map(s => ({ ...s, done: true }));
  }

  try {
    await DB.updateTopic(topicId, { done: newDone, subtopics });
    await render(_currentSubjectId);
  } catch (err) {
    console.error('[Syllabus] _toggleTopicDone:', err);
    App.showToast('Could not update topic.', 'error');
  }
}

/**
 * Toggle a single subtopic's done state.
 * After toggling, auto-updates the parent topic's done flag:
 *   - If ALL subtopics done → parent done = true
 *   - If ANY subtopic undone → parent done = false
 *
 * @param {number}  topicId
 * @param {number}  subtopicIdx
 * @param {boolean} newDone
 */
async function _toggleSubtopicDone(topicId, subtopicIdx, newDone) {
  const topic = _topics.find(t => t.id === topicId);
  if (!topic) return;

  const subtopics = (topic.subtopics || []).map((s, i) =>
    i === subtopicIdx ? { ...s, done: newDone } : s
  );

  // Auto-sync parent done state with subtopics
  const allSubsDone = subtopics.length > 0 && subtopics.every(s => s.done);

  try {
    await DB.updateTopic(topicId, { subtopics, done: allSubsDone });
    await render(_currentSubjectId);
  } catch (err) {
    console.error('[Syllabus] _toggleSubtopicDone:', err);
    App.showToast('Could not update subtopic.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   DELETE TOPIC
──────────────────────────────────────────────────────────── */

/**
 * Prompt confirmation then delete a topic.
 * @param {number} topicId
 * @param {string} topicName
 */
function _deleteTopic(topicId, topicName) {
  App.showConfirm(
    `Delete topic "${topicName}"?`,
    async () => {
      try {
        await DB.deleteTopic(topicId);
        App.showToast(`Topic "${topicName}" deleted.`, 'success');
        await render(_currentSubjectId);
      } catch (err) {
        console.error('[Syllabus] _deleteTopic:', err);
        App.showToast('Could not delete topic.', 'error');
      }
    }
  );
}

/* ────────────────────────────────────────────────────────────
   COMPLETION HELPERS
──────────────────────────────────────────────────────────── */

/**
 * Determine whether a topic counts as complete.
 * Rules:
 *   1. If it has no subtopics → use its own `done` flag.
 *   2. If it has subtopics → complete only when ALL subtopics done.
 *
 * @param {Object} topic
 * @returns {boolean}
 */
function _isTopicComplete(topic) {
  if (!topic.subtopics || topic.subtopics.length === 0) {
    return Boolean(topic.done);
  }
  return topic.subtopics.every(s => s.done);
}

/**
 * Compute completion stats for a subject without rendering.
 * Useful for subject cards on the Subjects page.
 *
 * @param {number|string} subjectId
 * @returns {Promise<{done:number, total:number, pct:number}>}
 */
async function getCompletionStats(subjectId) {
  const topics = await DB.getTopicsBySubject(Number(subjectId));
  const total  = topics.length;
  const done   = topics.filter(t => _isTopicComplete(t)).length;
  const pct    = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

/**
 * Compute completion stats for ALL subjects at once.
 * Returns a map of subjectId → { done, total, pct }.
 *
 * @returns {Promise<Object>}
 */
async function getAllCompletionStats() {
  const [subjects, allTopics] = await Promise.all([
    DB.getAllSubjects(),
    DB.getAllTopics(),
  ]);

  const map = {};

  subjects.forEach(sub => {
    const subTopics = allTopics.filter(
      t => String(t.subjectId) === String(sub.id)
    );
    const total = subTopics.length;
    const done  = subTopics.filter(t => _isTopicComplete(t)).length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    map[sub.id] = { done, total, pct };
  });

  return map;
}

/* ────────────────────────────────────────────────────────────
   SEARCH / FILTER  (future use)
──────────────────────────────────────────────────────────── */

/**
 * Filter the currently rendered topics by a search string.
 * Hides non-matching topic elements in the DOM without re-querying DB.
 *
 * @param {string} query
 */
function filterTopics(query) {
  const q = (query || '').trim().toLowerCase();
  const items = document.querySelectorAll('.syllabus-topic');

  items.forEach(el => {
    const name = el.querySelector('.syllabus-topic__name')?.textContent.toLowerCase() || '';
    const match = !q || name.includes(q);
    el.style.display = match ? '' : 'none';
  });
}

/* ────────────────────────────────────────────────────────────
   BULK OPERATIONS
──────────────────────────────────────────────────────────── */

/**
 * Mark all topics in the current subject as done.
 */
async function markAllDone() {
  if (!_currentSubjectId || !_topics.length) return;

  try {
    await Promise.all(
      _topics.map(t => {
        const subtopics = (t.subtopics || []).map(s => ({ ...s, done: true }));
        return DB.updateTopic(t.id, { done: true, subtopics });
      })
    );
    await render(_currentSubjectId);
    App.showToast('All topics marked complete.', 'success');
  } catch (err) {
    console.error('[Syllabus] markAllDone:', err);
    App.showToast('Could not update topics.', 'error');
  }
}

/**
 * Mark all topics in the current subject as undone.
 */
async function markAllUndone() {
  if (!_currentSubjectId || !_topics.length) return;

  try {
    await Promise.all(
      _topics.map(t => {
        const subtopics = (t.subtopics || []).map(s => ({ ...s, done: false }));
        return DB.updateTopic(t.id, { done: false, subtopics });
      })
    );
    await render(_currentSubjectId);
    App.showToast('All topics marked incomplete.', 'success');
  } catch (err) {
    console.error('[Syllabus] markAllUndone:', err);
    App.showToast('Could not update topics.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   UTILITY
──────────────────────────────────────────────────────────── */

/**
 * Escape HTML for safe DOM injection.
 * @param {string} str
 * @returns {string}
 */
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
window.SyllabusModule = {
  render,
  getCompletionStats,
  getAllCompletionStats,
  filterTopics,
  markAllDone,
  markAllUndone,
};
