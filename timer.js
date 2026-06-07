/* ============================================================
   MBBS STUDY COMMAND CENTER — js/timer.js
   Study timer state machine.

   Features:
   ─ 25 / 50 / 90 min presets + custom duration
   ─ Start / Pause / Resume / Reset / Skip
   ─ SVG ring progress animation
   ─ Colour shift: cyan → amber (last 20%) → red (last 5%)
   ─ Web Audio API beep on completion (no external audio files)
   ─ Browser Notification on completion (if permission granted)
   ─ Session log form shown on completion
   ─ Daily stats panel refresh (sessions, focus mins, breaks)
   ─ Subject donut chart refresh on timer section entry
   ─ Persists last-used duration to localStorage

   Exposes: window.TimerModule
   Depends: window.DB, window.App, window.StatsModule,
            window.ChartsModule
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   CONSTANTS
──────────────────────────────────────────────────────────── */
const RING_CIRCUMFERENCE = 2 * Math.PI * 100; // r=100 → 628.318…

const STATE = {
  IDLE:    'idle',
  RUNNING: 'running',
  PAUSED:  'paused',
  DONE:    'done',
};

/* ────────────────────────────────────────────────────────────
   TIMER STATE
──────────────────────────────────────────────────────────── */
let _state          = STATE.IDLE;
let _totalSecs      = 25 * 60;   // selected duration in seconds
let _remainingSecs  = 25 * 60;   // countdown value
let _intervalHandle = null;
let _startTimestamp = null;       // Date.now() when last started/resumed
let _sessionStart   = null;       // Date.now() when the session began (first Start press)
let _elapsedAtPause = 0;          // seconds elapsed before a pause
let _audioCtx       = null;       // shared Web Audio context (reused across alerts)

/* ────────────────────────────────────────────────────────────
   DOM REFERENCES (resolved once on init)
──────────────────────────────────────────────────────────── */
let _els = {};

function _resolveEls() {
  _els = {
    display:       document.getElementById('timer-display'),
    phase:         document.getElementById('timer-phase'),
    ring:          document.getElementById('timer-ring-progress'),
    btnStart:      document.getElementById('btn-timer-start'),
    btnReset:      document.getElementById('btn-timer-reset'),
    btnSkip:       document.getElementById('btn-timer-skip'),
    presets:       document.querySelectorAll('.preset-btn'),
    customInput:   document.getElementById('custom-time-input'),
    customMinutes: document.getElementById('custom-minutes'),
    logForm:       document.getElementById('session-log-form'),
    logSubject:    document.getElementById('log-subject'),
    logTopic:      document.getElementById('log-topic'),
    logNotes:      document.getElementById('log-notes'),
    btnLogSave:    document.getElementById('btn-log-save'),
    btnLogSkip:    document.getElementById('btn-log-skip'),
    tdsSessions:   document.getElementById('tds-sessions'),
    tdsFocus:      document.getElementById('tds-focus'),
    tdsBreaks:     document.getElementById('tds-breaks'),
  };
}

/* ────────────────────────────────────────────────────────────
   INITIALISE  (called once by app.js boot, or lazily on first
   visit to the timer section)
──────────────────────────────────────────────────────────── */
function init() {
  _resolveEls();
  _bindPresets();
  _bindControls();
  _bindLogForm();

  // Restore last-used duration
  const saved = parseInt(localStorage.getItem('mbbs_timer_duration') || '25', 10);
  _setDuration(saved);
  _highlightPreset(saved);

  _renderDisplay(_remainingSecs);
  _renderRing(1);
  _setPhaseLabel('Focus');
}

/* ────────────────────────────────────────────────────────────
   PRESET BUTTONS
──────────────────────────────────────────────────────────── */
function _bindPresets() {
  _els.presets.forEach(btn => {
    btn.addEventListener('click', () => {
      if (_state === STATE.RUNNING) return; // ignore during active session

      const val = btn.dataset.minutes;

      if (val === 'custom') {
        _els.customInput?.classList.remove('hidden');
        _els.presets.forEach(b => {
          b.classList.toggle('active', b.dataset.minutes === 'custom');
          b.setAttribute('aria-pressed', String(b.dataset.minutes === 'custom'));
        });
        // Apply current custom field value immediately
        const mins = parseInt(_els.customMinutes?.value || '60', 10);
        _setDuration(Math.max(1, Math.min(480, mins)));
        return;
      }

      _els.customInput?.classList.add('hidden');
      const mins = parseInt(val, 10);
      _setDuration(mins);
      _highlightPreset(mins);
    });
  });

  // Custom minutes input → update duration live
  _els.customMinutes?.addEventListener('input', () => {
    const mins = parseInt(_els.customMinutes.value || '60', 10);
    if (!isNaN(mins) && mins >= 1 && mins <= 480) {
      _setDuration(mins);
    }
  });
}

function _setDuration(minutes) {
  _totalSecs     = minutes * 60;
  _remainingSecs = _totalSecs;
  _renderDisplay(_remainingSecs);
  _renderRing(1);
  _setPhaseLabel('Focus');
  localStorage.setItem('mbbs_timer_duration', String(minutes));
}

function _highlightPreset(minutes) {
  const match = [25, 50, 90].includes(minutes);
  _els.presets.forEach(btn => {
    const isThis = parseInt(btn.dataset.minutes, 10) === minutes;
    btn.classList.toggle('active', isThis);
    btn.setAttribute('aria-pressed', String(isThis));
  });
  if (!match) {
    // Highlight custom button
    _els.presets.forEach(btn => {
      if (btn.dataset.minutes === 'custom') {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      }
    });
  }
}

/* ────────────────────────────────────────────────────────────
   CONTROL BUTTONS
──────────────────────────────────────────────────────────── */
function _bindControls() {
  _els.btnStart?.addEventListener('click', _handleStartPause);
  _els.btnReset?.addEventListener('click', _handleReset);
  _els.btnSkip?.addEventListener('click',  _handleSkip);
}

function _handleStartPause() {
  switch (_state) {
    case STATE.IDLE:
    case STATE.DONE:
      _startTimer();
      break;
    case STATE.RUNNING:
      _pauseTimer();
      break;
    case STATE.PAUSED:
      _resumeTimer();
      break;
  }
}

function _handleReset() {
  _stopInterval();
  _state          = STATE.IDLE;
  _elapsedAtPause = 0;
  _sessionStart   = null;
  _remainingSecs  = _totalSecs;

  _renderDisplay(_remainingSecs);
  _renderRing(1);
  _setPhaseLabel('Focus');
  _setStartLabel('Start');
  _setControlsEnabled(false);
  _hideLogForm();
}

function _handleSkip() {
  // Skip = immediately complete the current session
  _stopInterval();
  _onTimerComplete();
}

/* ────────────────────────────────────────────────────────────
   TIMER LIFECYCLE
──────────────────────────────────────────────────────────── */
function _startTimer() {
  unlockAudio();
  _state          = STATE.RUNNING;
  _sessionStart   = _sessionStart || Date.now();
  _startTimestamp = Date.now();

  _setStartLabel('Pause');
  _setControlsEnabled(true);
  _hideLogForm();
  _setPhaseLabel('Focusing…');

  _runTick();
  _intervalHandle = setInterval(_runTick, 1000);
}

function _pauseTimer() {
  _state           = STATE.PAUSED;
  _elapsedAtPause += Math.floor((Date.now() - _startTimestamp) / 1000);
  _stopInterval();
  _setStartLabel('Resume');
  _setPhaseLabel('Paused');
}

function _resumeTimer() {
  _state          = STATE.RUNNING;
  _startTimestamp = Date.now();
  _setStartLabel('Pause');
  _setPhaseLabel('Focusing…');

  _runTick();
  _intervalHandle = setInterval(_runTick, 1000);
}

function _stopInterval() {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

/* ────────────────────────────────────────────────────────────
   TICK
──────────────────────────────────────────────────────────── */
function _runTick() {
  const elapsedNow = Math.floor((Date.now() - _startTimestamp) / 1000);
  const totalElapsed = _elapsedAtPause + elapsedNow;
  _remainingSecs = Math.max(0, _totalSecs - totalElapsed);

  _renderDisplay(_remainingSecs);
  _renderRing(_remainingSecs / _totalSecs);
  _updateRingColour(_remainingSecs / _totalSecs);

  // Update page title with countdown
  document.title = `${_formatTime(_remainingSecs)} — MBBS CMD`;

  if (_remainingSecs <= 0) {
    _stopInterval();
    _onTimerComplete();
  }
}

/* ────────────────────────────────────────────────────────────
   COMPLETION
──────────────────────────────────────────────────────────── */
function _onTimerComplete() {
  _state = STATE.DONE;
  _stopInterval();

  _renderDisplay(0);
  _renderRing(0);
  _setPhaseLabel('Done! 🎉');
  _setStartLabel('Start New');
  _setControlsEnabled(true);

  // Restore page title
  document.title = 'MBBS Study Command Center';

  // Sound alert
  _playCompletionSound();

  // Browser notification
  _sendNotification();

  // Show the session log form
  _showLogForm();

  // Refresh daily stats panel
  refreshDailyStats();
}

/* ────────────────────────────────────────────────────────────
   DISPLAY RENDERING
──────────────────────────────────────────────────────────── */

/**
 * Update the digital time display (MM:SS or H:MM:SS).
 * @param {number} secs
 */
function _renderDisplay(secs) {
  if (_els.display) {
    _els.display.textContent = _formatTime(secs);
  }
}

/**
 * Format seconds as MM:SS or H:MM:SS.
 * @param {number} totalSecs
 * @returns {string}
 */
function _formatTime(totalSecs) {
  const h   = Math.floor(totalSecs / 3600);
  const m   = Math.floor((totalSecs % 3600) / 60);
  const s   = totalSecs % 60;
  const mm  = String(m).padStart(2, '0');
  const ss  = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Update the SVG ring progress.
 * @param {number} fraction  0.0 (empty) → 1.0 (full)
 */
function _renderRing(fraction) {
  if (!_els.ring) return;
  const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
  _els.ring.style.strokeDashoffset = offset;
}

/**
 * Shift ring colour based on remaining fraction.
 * 1.0–0.20 → accent (cyan)
 * 0.20–0.05 → amber (warning)
 * 0.05–0.00 → danger (red)
 */
function _updateRingColour(fraction) {
  if (!_els.ring) return;
  _els.ring.classList.remove('warning', 'danger');
  if (fraction <= 0.05) {
    _els.ring.classList.add('danger');
  } else if (fraction <= 0.20) {
    _els.ring.classList.add('warning');
  }
}

function _setPhaseLabel(text) {
  if (_els.phase) _els.phase.textContent = text;
}

function _setStartLabel(text) {
  if (_els.btnStart) _els.btnStart.textContent = text;
}

function _setControlsEnabled(enabled) {
  if (_els.btnReset) _els.btnReset.disabled = !enabled;
  if (_els.btnSkip)  _els.btnSkip.disabled  = !enabled;
}

/* ────────────────────────────────────────────────────────────
   SOUND  (Web Audio API — no external files needed)
──────────────────────────────────────────────────────────── */

function _getAudioContext() {
  if (_audioCtx) return _audioCtx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  _audioCtx = new AudioCtx();
  return _audioCtx;
}

/**
 * Resume audio context after a user gesture (browser autoplay policy).
 */
async function unlockAudio() {
  try {
    const ctx = _getAudioContext();
    if (ctx && ctx.state === 'suspended') await ctx.resume();
  } catch (_) {}
}

/**
 * Play chime tones on the shared AudioContext.
 * @param {boolean} [force=false]  ignore sound preference (for test button)
 */
async function _playChime(force = false) {
  if (!force && localStorage.getItem('mbbs_sound') === '0') return;

  try {
    const ctx = _getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();

    const tones = [
      { freq: 523.25, start: 0.00, dur: 0.18 },
      { freq: 659.25, start: 0.20, dur: 0.18 },
      { freq: 783.99, start: 0.40, dur: 0.35 },
    ];

    const t0 = ctx.currentTime;
    tones.forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0 + start);
      gain.gain.setValueAtTime(0.001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + start + dur);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.08);
    });
  } catch (err) {
    console.warn('[Timer] Sound error:', err);
  }
}

function _playCompletionSound() {
  _playChime(false);
}

function playTestSound() {
  _playChime(true);
}

/* ────────────────────────────────────────────────────────────
   BROWSER NOTIFICATION
──────────────────────────────────────────────────────────── */
function _sendNotification() {
  const notifEnabled = localStorage.getItem('mbbs_notifications') === '1';
  if (!notifEnabled) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const mins = Math.round(_totalSecs / 60);
  try {
    new Notification('MBBS Study Session Complete', {
      body:  `You studied for ${mins} minute${mins !== 1 ? 's' : ''}. Great work!`,
      icon:  './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag:   'mbbs-timer-done',
    });
  } catch (err) {
    console.warn('[Timer] Notification error:', err);
  }
}

/* ────────────────────────────────────────────────────────────
   SESSION LOG FORM
──────────────────────────────────────────────────────────── */
function _showLogForm() {
  _els.logForm?.classList.remove('hidden');
  // Scroll form into view on mobile
  _els.logForm?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _hideLogForm() {
  _els.logForm?.classList.add('hidden');
  if (_els.logTopic)   _els.logTopic.value   = '';
  if (_els.logNotes)   _els.logNotes.value   = '';
  if (_els.logSubject) _els.logSubject.value  = '';
}

function _bindLogForm() {
  _els.btnLogSave?.addEventListener('click', _saveSession);
  _els.btnLogSkip?.addEventListener('click', () => {
    _hideLogForm();
    _handleReset();
  });
}

async function _saveSession() {
  const subjectId = _els.logSubject?.value;
  const topic     = _els.logTopic?.value.trim()  || '';
  const notes     = _els.logNotes?.value.trim()   || '';
  const duration  = Math.max(1, Math.round(_totalSecs / 60));
  const startTime = _sessionStart || (Date.now() - _totalSecs * 1000);
  const endTime   = Date.now();

  // Look up subject details
  let subjectName  = '';
  let subjectColor = '#00d4ff';

  if (subjectId) {
    try {
      const subjects = await DB.getAllSubjects();
      const sub = subjects.find(s => String(s.id) === String(subjectId));
      if (sub) {
        subjectName  = sub.name;
        subjectColor = sub.color;
      }
    } catch (_) {}
  }

  try {
    await DB.addSession({
      subjectId:    subjectId ? Number(subjectId) : null,
      subjectName:  subjectName  || 'General',
      subjectColor: subjectColor,
      topic,
      notes,
      duration,
      startTime,
      endTime,
      manual:    false,
      createdAt: Date.now(),
    });

    App.showToast('Session saved!', 'success');
    _hideLogForm();
    _handleReset();

    // Refresh timer daily stats and subject donut
    await refreshDailyStats();
    await ChartsModule.renderSubjectDonut('chart-subject-donut', 'subject-legend');

    // If dashboard is re-opened it will refresh automatically via onSectionEnter

  } catch (err) {
    console.error('[Timer] _saveSession:', err);
    App.showToast('Could not save session.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   DAILY STATS PANEL
──────────────────────────────────────────────────────────── */

/**
 * Refresh the three counters on the timer section sidebar.
 * Called on section entry and after a session is saved.
 */
async function refreshDailyStats() {
  try {
    const stats = await StatsModule.computeTimerDailyStats();

    if (_els.tdsSessions) _els.tdsSessions.textContent = stats.sessions;
    if (_els.tdsFocus) {
      _els.tdsFocus.textContent = stats.focusMins >= 60
        ? `${Math.floor(stats.focusMins / 60)}h ${stats.focusMins % 60}m`
        : `${stats.focusMins}m`;
    }
    if (_els.tdsBreaks) _els.tdsBreaks.textContent = stats.breaks;

  } catch (err) {
    console.warn('[Timer] refreshDailyStats:', err);
  }
}

/**
 * Render the subject donut on the timer sidebar.
 * Delegated to ChartsModule.
 */
async function renderSubjectDonut(canvasId, legendId) {
  if (typeof ChartsModule !== 'undefined') {
    await ChartsModule.renderSubjectDonut(canvasId, legendId);
  }
}

/* ────────────────────────────────────────────────────────────
   PAGE VISIBILITY — pause if tab hidden, resume on return
──────────────────────────────────────────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (_state !== STATE.RUNNING) return;

  if (document.hidden) {
    // Record elapsed time without showing as paused to the user
    _elapsedAtPause += Math.floor((Date.now() - _startTimestamp) / 1000);
    _stopInterval();
  } else {
    // Resume seamlessly
    _startTimestamp = Date.now();
    _runTick();
    _intervalHandle = setInterval(_runTick, 1000);
  }
});

/* ────────────────────────────────────────────────────────────
   PUBLIC API
──────────────────────────────────────────────────────────── */
window.TimerModule = {
  init,
  refreshDailyStats,
  renderSubjectDonut,
  unlockAudio,
  playTestSound,

  // Exposed for testing / external access
  getState:     () => _state,
  getRemaining: () => _remainingSecs,
  getTotal:     () => _totalSecs,
};

/* ────────────────────────────────────────────────────────────
   AUTO-INIT
   The timer section is not the landing section, so we init
   lazily the first time the user visits it.
   app.js calls TimerModule.init() inside refreshTimerSection().
   Guard against double-init.
──────────────────────────────────────────────────────────── */
let _initialised = false;
const _origInit  = TimerModule.init;

TimerModule.init = function () {
  if (_initialised) return;
  _initialised = true;
  _origInit();
};
