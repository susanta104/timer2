/* ============================================================
   MBBS STUDY COMMAND CENTER — app.js
   Master boot file. Loaded last, after all other modules.

   Responsibilities:
   ─ IndexedDB initialisation (via DB module)
   ─ Service Worker registration
   ─ PWA install-prompt handling
   ─ Section routing (sidebar + bottom nav + data-section buttons)
   ─ Mobile sidebar open / close
   ─ Theme (dark / light) with persistence
   ─ Modal open / close / confirm dialog
   ─ Toast notification system
   ─ Online / offline status indicator
   ─ Settings tab wiring (theme pref, sound, notifications, goal)
   ─ Color-swatch picker for Add Subject modal
   ─ Subject modal save → DB → refresh
   ─ Exam modal save → DB → refresh
   ─ Topic modal save → DB → refresh
   ─ Manual session modal save → DB → refresh
   ─ Populating every <select> that lists subjects
   ─ Dashboard bootstrap (stats, streak, countdown, recent sessions, chart)
   ─ Section-entry hooks (lazy-render analytics charts, syllabus, exams, etc.)
   ─ Global event delegation for dynamic elements
   ─ Keyboard accessibility (Escape closes modals/sidebar)
   ============================================================ */

'use strict';

/* ────────────────────────────────────────────────────────────
   CONSTANTS
──────────────────────────────────────────────────────────── */
const SUBJECT_COLORS = [
  '#00d4ff', // cyan
  '#a78bfa', // violet
  '#34d399', // emerald
  '#fb923c', // orange
  '#f472b6', // pink
  '#facc15', // yellow
  '#60a5fa', // blue
  '#f87171', // red
];

const SECTION_TITLES = {
  dashboard: 'Dashboard',
  timer:     'Study Timer',
  sessions:  'Sessions Log',
  subjects:  'Subjects',
  syllabus:  'Syllabus Tracker',
  analytics: 'Analytics',
  exams:     'Exam Countdown',
  settings:  'Settings',
};

/* ────────────────────────────────────────────────────────────
   APP STATE
──────────────────────────────────────────────────────────── */
const AppState = {
  currentSection:     'dashboard',
  theme:              'dark',
  selectedSubjectColor: SUBJECT_COLORS[0],
  confirmCallback:    null,
  deferredInstall:    null,
  analyticsRendered:  false,
  chartWeekPreview:   null,   // Chart.js instance (dashboard mini chart)
};

/* ────────────────────────────────────────────────────────────
   DOM SHORTCUTS
──────────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

/* ────────────────────────────────────────────────────────────
   BOOT
──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Open IndexedDB and seed default subjects on first launch
    await DB.open();
    await DB.seedDefaultSubjects();

    // 2. Apply persisted theme before first paint
    loadTheme();

    // 3. Wire all static UI interactions
    initNavigation();
    initMobileSidebar();
    initThemeToggles();
    initModalSystem();
    initColorPicker();
    initInstallBanner();
    initInstallApp();
    initAudioUnlock();
    initOnlineStatus();
    initSettings();
    initSubjectModal();
    initExamModal();
    initTopicModal();
    initManualSessionModal();
    initDashboardButtons();
    initSectionToolbarButtons();

    // 4. Register service worker
    registerServiceWorker();

    // 5. Navigate to hash route, stored last section, or dashboard
    const hashSection = location.hash.replace(/^#/, '');
    const lastSection = (hashSection && SECTION_TITLES[hashSection])
      ? hashSection
      : (localStorage.getItem('mbbs_last_section') || 'dashboard');
    navigateTo(lastSection, false);

  } catch (err) {
    console.error('[App] Boot error:', err);
    showToast('Failed to initialise database. Please reload.', 'error');
  }
});

/* ────────────────────────────────────────────────────────────
   SERVICE WORKER
──────────────────────────────────────────────────────────── */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  (async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Update available — refresh to apply.', 'info');
          }
        });
      });
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  })();
}

/* ────────────────────────────────────────────────────────────
   NAVIGATION / ROUTING
──────────────────────────────────────────────────────────── */
function initNavigation() {
  // Sidebar nav items
  $$('.nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  // Bottom nav items
  $$('.bottom-nav__item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });

  // Any button anywhere with data-section attribute (e.g. "View All" links)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-section]');
    if (btn && !btn.classList.contains('nav-item') && !btn.classList.contains('bottom-nav__item')) {
      navigateTo(btn.dataset.section);
    }
  });
}

function navigateTo(sectionKey, save = true) {
  if (!SECTION_TITLES[sectionKey]) return;

  // Hide current, show next
  $$('.section').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });

  const target = $(`section-${sectionKey}`);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Update page title
  const titleEl = $('page-title');
  if (titleEl) titleEl.textContent = SECTION_TITLES[sectionKey];

  // Update sidebar nav active state
  $$('.nav-item[data-section]').forEach(btn => {
    const isActive = btn.dataset.section === sectionKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Update bottom nav active state
  $$('.bottom-nav__item[data-section]').forEach(btn => {
    const isActive = btn.dataset.section === sectionKey;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Close sidebar on mobile when navigating
  closeMobileSidebar();

  AppState.currentSection = sectionKey;
  if (save) localStorage.setItem('mbbs_last_section', sectionKey);

  // Section-entry hooks — run after paint
  requestAnimationFrame(() => onSectionEnter(sectionKey));
}

/* Called every time a section becomes visible */
async function onSectionEnter(section) {
  switch (section) {
    case 'dashboard':
      await refreshDashboard();
      break;
    case 'timer':
      await refreshTimerSection();
      break;
    case 'sessions':
      await refreshSessionsSection();
      break;
    case 'subjects':
      await refreshSubjectsSection();
      break;
    case 'syllabus':
      await refreshSyllabusSection();
      break;
    case 'analytics':
      await refreshAnalyticsSection();
      break;
    case 'exams':
      await refreshExamsSection();
      break;
    case 'settings':
      syncSettingsUI();
      syncInstallUI();
      break;
  }
}

/* ────────────────────────────────────────────────────────────
   MOBILE SIDEBAR
──────────────────────────────────────────────────────────── */
function initMobileSidebar() {
  const menuToggle = $('menu-toggle');
  const sidebar    = $('sidebar');

  menuToggle?.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('open');
    isOpen ? closeMobileSidebar() : openMobileSidebar();
  });

  // Tap outside sidebar to close
  document.addEventListener('click', (e) => {
    if (
      sidebar?.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      e.target !== $('menu-toggle') &&
      !$('menu-toggle')?.contains(e.target)
    ) {
      closeMobileSidebar();
    }
  });

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sidebar?.classList.contains('open')) {
        closeMobileSidebar();
        return;
      }
      closeAllModals();
    }
  });
}

function openMobileSidebar() {
  const sidebar    = $('sidebar');
  const menuToggle = $('menu-toggle');
  sidebar?.classList.add('open');
  menuToggle?.setAttribute('aria-expanded', 'true');
}

function closeMobileSidebar() {
  const sidebar    = $('sidebar');
  const menuToggle = $('menu-toggle');
  sidebar?.classList.remove('open');
  menuToggle?.setAttribute('aria-expanded', 'false');
}

/* ────────────────────────────────────────────────────────────
   THEME
──────────────────────────────────────────────────────────── */
function initThemeToggles() {
  $('theme-toggle')?.addEventListener('click', toggleTheme);
  $('header-theme-toggle')?.addEventListener('click', toggleTheme);
}

function loadTheme() {
  const saved = localStorage.getItem('mbbs_theme') || 'dark';
  applyTheme(saved);
}

function toggleTheme() {
  const next = AppState.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('mbbs_theme', next);
}

function applyTheme(theme) {
  AppState.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  // Sync meta theme-color
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.content = theme === 'dark' ? '#0a0e1a' : '#f0f3fa';
  }

  // Sidebar toggle label + icon
  const icon  = $('theme-icon');
  const label = $('theme-label');
  const headerBtn = $('header-theme-toggle');

  if (theme === 'dark') {
    if (icon)      icon.textContent  = '◑';
    if (label)     label.textContent = 'Light Mode';
    if (headerBtn) headerBtn.textContent = '◑';
  } else {
    if (icon)      icon.textContent  = '◐';
    if (label)     label.textContent = 'Dark Mode';
    if (headerBtn) headerBtn.textContent = '◐';
  }

  // Settings pref buttons
  $('pref-dark')?.classList.toggle('active', theme === 'dark');
  $('pref-dark')?.setAttribute('aria-pressed', String(theme === 'dark'));
  $('pref-light')?.classList.toggle('active', theme === 'light');
  $('pref-light')?.setAttribute('aria-pressed', String(theme === 'light'));
}

/* ────────────────────────────────────────────────────────────
   MODAL SYSTEM
──────────────────────────────────────────────────────────── */
function initModalSystem() {
  // Static close buttons (data-close="modal-id")
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) closeModal(closeBtn.dataset.close);
  });

  // Backdrop click closes all modals
  $('modal-backdrop')?.addEventListener('click', closeAllModals);

  // Confirm dialog
  $('btn-confirm-cancel')?.addEventListener('click', () => {
    closeModal('modal-confirm');
    AppState.confirmCallback = null;
  });

  $('btn-confirm-ok')?.addEventListener('click', () => {
    closeModal('modal-confirm');
    if (typeof AppState.confirmCallback === 'function') {
      AppState.confirmCallback();
      AppState.confirmCallback = null;
    }
  });
}

function openModal(modalId) {
  const modal    = $(modalId);
  const backdrop = $('modal-backdrop');
  if (!modal) return;

  backdrop?.classList.remove('hidden');
  backdrop?.removeAttribute('aria-hidden');
  modal.classList.remove('hidden');
  modal.removeAttribute('aria-hidden');

  // Focus first focusable element
  requestAnimationFrame(() => {
    const first = modal.querySelector('input, select, textarea, button:not(.modal__close)');
    first?.focus();
  });

  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
  const modal = $(modalId);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');

  // Only hide backdrop if no other modals are open
  const anyOpen = $$('.modal:not(.hidden)').length > 0;
  if (!anyOpen) {
    $('modal-backdrop')?.classList.add('hidden');
    $('modal-backdrop')?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
}

function closeAllModals() {
  $$('.modal').forEach(m => {
    m.classList.add('hidden');
    m.setAttribute('aria-hidden', 'true');
  });
  $('modal-backdrop')?.classList.add('hidden');
  $('modal-backdrop')?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/**
 * Show a confirm dialog.
 * @param {string} message
 * @param {Function} onConfirm
 */
function showConfirm(message, onConfirm) {
  const msgEl = $('confirm-message');
  if (msgEl) msgEl.textContent = message;
  AppState.confirmCallback = onConfirm;
  openModal('modal-confirm');
}

/* ────────────────────────────────────────────────────────────
   TOAST NOTIFICATIONS
──────────────────────────────────────────────────────────── */
/**
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {number} duration  ms
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = $('toast-container');
  if (!container) return;

  const icons = { info: '◈', success: '✓', error: '✕' };

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${icons[type] || '◈'}</span>
    <span class="toast__message">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Auto-dismiss
  const dismiss = () => {
    if (!toast.parentNode) return;
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    // Fallback remove
    setTimeout(() => toast.remove(), 400);
  };

  setTimeout(dismiss, duration);
  toast.addEventListener('click', dismiss);
}

/* ────────────────────────────────────────────────────────────
   ONLINE / OFFLINE STATUS
──────────────────────────────────────────────────────────── */
function initOnlineStatus() {
  const dot = $('online-status');
  if (!dot) return;

  const update = () => {
    const online = navigator.onLine;
    dot.classList.toggle('offline', !online);
    dot.title = online ? 'Online' : 'Offline';
  };

  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

/* ────────────────────────────────────────────────────────────
   PWA INSTALL BANNER
──────────────────────────────────────────────────────────── */
function isAppInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isIOSSafari() {
  return isIOS() && !isAppInstalled() && !window.matchMedia('(display-mode: standalone)').matches;
}

async function promptInstall() {
  if (isAppInstalled()) {
    showToast('App is already installed.', 'info');
    return;
  }

  if (AppState.deferredInstall) {
    AppState.deferredInstall.prompt();
    const { outcome } = await AppState.deferredInstall.userChoice;
    if (outcome === 'accepted') {
      showToast('App installed successfully!', 'success');
      syncInstallUI();
    }
    AppState.deferredInstall = null;
    $('install-banner')?.classList.add('hidden');
    return;
  }

  if (isIOSSafari()) {
    showToast('Tap Share (↑) then "Add to Home Screen".', 'info', 5000);
    $('install-ios-hint')?.classList.remove('hidden');
    return;
  }

  showToast('Use your browser menu: Install app / Add to Home Screen.', 'info', 4500);
}

function syncInstallUI() {
  const installed = isAppInstalled();
  const banner    = $('install-banner');
  const card      = $('install-card');
  const btn       = $('btn-install-settings');
  const status    = $('install-status');
  const iosHint   = $('install-ios-hint');

  if (installed) {
    banner?.classList.add('hidden');
    card?.classList.add('install-card--done');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Installed';
    }
    if (status) status.textContent = 'Running as an installed app.';
    iosHint?.classList.add('hidden');
    return;
  }

  card?.classList.remove('install-card--done');
  if (btn) {
    btn.disabled = false;
    btn.textContent = AppState.deferredInstall ? 'Install Now' : 'Add to Home Screen';
  }
  if (status) {
    status.textContent = AppState.deferredInstall
      ? 'Ready to install — works fully offline.'
      : isIOSSafari()
        ? 'On iPhone/iPad: Share → Add to Home Screen.'
        : 'Install for offline access and a home-screen icon.';
  }
  if (isIOSSafari()) iosHint?.classList.remove('hidden');
}

function initInstallBanner() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    AppState.deferredInstall = e;
    if (!localStorage.getItem('mbbs_install_dismissed')) {
      $('install-banner')?.classList.remove('hidden');
    }
    syncInstallUI();
  });

  $('btn-install')?.addEventListener('click', promptInstall);

  $('btn-install-dismiss')?.addEventListener('click', () => {
    $('install-banner')?.classList.add('hidden');
    localStorage.setItem('mbbs_install_dismissed', '1');
  });

  window.addEventListener('appinstalled', () => {
    $('install-banner')?.classList.add('hidden');
    AppState.deferredInstall = null;
    syncInstallUI();
    showToast('App added to home screen!', 'success');
  });

  if (isIOSSafari() && !localStorage.getItem('mbbs_install_dismissed')) {
    $('install-banner')?.classList.remove('hidden');
  }
}

function initInstallApp() {
  $('btn-install-settings')?.addEventListener('click', promptInstall);
  syncInstallUI();
}

/** Unlock Web Audio on first user gesture (required by browsers). */
function initAudioUnlock() {
  const unlock = () => {
    if (typeof TimerModule !== 'undefined' && TimerModule.unlockAudio) {
      TimerModule.unlockAudio();
    }
  };
  document.addEventListener('click', unlock, { passive: true });
  document.addEventListener('touchstart', unlock, { passive: true });
  document.addEventListener('keydown', unlock, { passive: true });
}

/* ────────────────────────────────────────────────────────────
   COLOR PICKER (Subject modal)
──────────────────────────────────────────────────────────── */
function initColorPicker() {
  const container = $('subject-color-picker');
  if (!container) return;

  SUBJECT_COLORS.forEach((color, i) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch' + (i === 0 ? ' selected' : '');
    swatch.style.background = color;
    swatch.setAttribute('aria-label', `Color ${i + 1}`);
    swatch.dataset.color = color;

    swatch.addEventListener('click', () => {
      $$('.color-swatch', container).forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      AppState.selectedSubjectColor = color;
    });

    container.appendChild(swatch);
  });

  // Reset selection on modal open
  AppState.selectedSubjectColor = SUBJECT_COLORS[0];
}

function resetColorPicker() {
  const container = $('subject-color-picker');
  if (!container) return;
  $$('.color-swatch', container).forEach((s, i) => {
    s.classList.toggle('selected', i === 0);
  });
  AppState.selectedSubjectColor = SUBJECT_COLORS[0];
}

/* ────────────────────────────────────────────────────────────
   SUBJECT MODAL
──────────────────────────────────────────────────────────── */
function initSubjectModal() {
  // Open triggers
  $('btn-add-subject')?.addEventListener('click', openSubjectModal);

  // Save
  $('btn-save-subject')?.addEventListener('click', saveSubject);

  // Enter key in name field
  $('subject-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveSubject();
  });
}

function openSubjectModal() {
  $('subject-name').value    = '';
  $('subject-target').value  = '';
  resetColorPicker();
  openModal('modal-subject');
  $('subject-name')?.focus();
}

async function saveSubject() {
  const name   = $('subject-name')?.value.trim();
  const target = parseInt($('subject-target')?.value) || 0;

  if (!name) {
    showToast('Please enter a subject name.', 'error');
    $('subject-name')?.focus();
    return;
  }

  try {
    await DB.addSubject({
      name,
      color:        AppState.selectedSubjectColor,
      weeklyTarget: target,
      createdAt:    Date.now(),
    });

    closeModal('modal-subject');
    showToast(`Subject "${name}" added.`, 'success');
    await refreshSubjectsSection();
    await populateAllSubjectSelects();

    // If dashboard visible, refresh
    if (AppState.currentSection === 'dashboard') await refreshDashboard();

  } catch (err) {
    console.error('[App] saveSubject:', err);
    showToast('Could not save subject.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   EXAM MODAL
──────────────────────────────────────────────────────────── */
function initExamModal() {
  // Multiple open triggers
  $('btn-add-exam')?.addEventListener('click',       openExamModal);
  $('btn-add-exam-empty')?.addEventListener('click', openExamModal);
  $('btn-add-exam-page')?.addEventListener('click',  openExamModal);

  $('btn-save-exam')?.addEventListener('click', saveExam);
}

function openExamModal() {
  $('exam-name').value  = '';
  $('exam-date').value  = '';

  // Set min datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('exam-date').min = now.toISOString().slice(0, 16);

  openModal('modal-exam');
}

async function saveExam() {
  const name      = $('exam-name')?.value.trim();
  const dateStr   = $('exam-date')?.value;
  const subjectId = $('exam-subject')?.value || '';

  if (!name) {
    showToast('Please enter an exam name.', 'error');
    return;
  }
  if (!dateStr) {
    showToast('Please select an exam date.', 'error');
    return;
  }

  const examDate = new Date(dateStr).getTime();
  if (examDate <= Date.now()) {
    showToast('Exam date must be in the future.', 'error');
    return;
  }

  try {
    await DB.addExam({ name, date: examDate, subjectId, createdAt: Date.now() });
    closeModal('modal-exam');
    showToast(`Exam "${name}" added.`, 'success');
    await refreshExamsSection();
    await refreshCountdownWidget();
  } catch (err) {
    console.error('[App] saveExam:', err);
    showToast('Could not save exam.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   TOPIC MODAL (Syllabus)
──────────────────────────────────────────────────────────── */
function initTopicModal() {
  $('btn-add-topic')?.addEventListener('click', () => {
    const subjectId = $('syllabus-subject-filter')?.value;
    if (!subjectId) {
      showToast('Please select a subject first.', 'error');
      return;
    }
    $('topic-name').value      = '';
    $('topic-subtopics').value = '';
    openModal('modal-topic');
  });

  $('btn-save-topic')?.addEventListener('click', saveTopic);
}

async function saveTopic() {
  const name         = $('topic-name')?.value.trim();
  const subtopicsRaw = $('topic-subtopics')?.value.trim();
  const subjectId    = $('syllabus-subject-filter')?.value;

  if (!name) {
    showToast('Please enter a topic name.', 'error');
    return;
  }
  if (!subjectId) {
    showToast('Please select a subject.', 'error');
    return;
  }

  const subtopics = subtopicsRaw
    ? subtopicsRaw.split(',').map(s => ({
        name: s.trim(),
        done: false,
      })).filter(s => s.name)
    : [];

  try {
    await DB.addTopic({
      subjectId: Number(subjectId),
      name,
      subtopics,
      done:      false,
      createdAt: Date.now(),
    });

    closeModal('modal-topic');
    showToast(`Topic "${name}" added.`, 'success');

    if (typeof SyllabusModule !== 'undefined') {
      await SyllabusModule.render(subjectId);
    }

  } catch (err) {
    console.error('[App] saveTopic:', err);
    showToast('Could not save topic.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   MANUAL SESSION MODAL
──────────────────────────────────────────────────────────── */
function initManualSessionModal() {
  $('btn-add-session-manual')?.addEventListener('click', openManualSessionModal);
  $('btn-save-manual-session')?.addEventListener('click', saveManualSession);
}

function openManualSessionModal() {
  // Default date to today
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  $('ms-date').value     = today.toISOString().slice(0, 10);
  $('ms-topic').value    = '';
  $('ms-notes').value    = '';
  $('ms-duration').value = '';
  openModal('modal-manual-session');
}

async function saveManualSession() {
  const subjectId = $('ms-subject')?.value;
  const topic     = $('ms-topic')?.value.trim();
  const notes     = $('ms-notes')?.value.trim();
  const dateStr   = $('ms-date')?.value;
  const duration  = parseInt($('ms-duration')?.value);

  if (!subjectId) {
    showToast('Please select a subject.', 'error');
    return;
  }
  if (!dateStr) {
    showToast('Please select a date.', 'error');
    return;
  }
  if (!duration || duration < 1) {
    showToast('Please enter a valid duration.', 'error');
    return;
  }

  const [y, m, d] = dateStr.split('-').map(Number);
  const startTime = new Date(y, m - 1, d).getTime();
  const subjects  = await DB.getAllSubjects();
  const subject   = subjects.find(s => String(s.id) === String(subjectId));

  try {
    await DB.addSession({
      subjectId,
      subjectName:  subject?.name  || 'Unknown',
      subjectColor: subject?.color || '#00d4ff',
      topic,
      notes,
      duration,          // minutes
      startTime,
      endTime:   startTime + duration * 60 * 1000,
      manual:    true,
      createdAt: Date.now(),
    });

    closeModal('modal-manual-session');
    showToast('Session logged.', 'success');
    await onSectionEnter(AppState.currentSection);

  } catch (err) {
    console.error('[App] saveManualSession:', err);
    showToast('Could not save session.', 'error');
  }
}

/* ────────────────────────────────────────────────────────────
   POPULATE SUBJECT <SELECT> ELEMENTS
──────────────────────────────────────────────────────────── */
async function populateAllSubjectSelects() {
  const subjects = await DB.getAllSubjects();

  const selectIds = [
    'log-subject',
    'ms-subject',
    'exam-subject',
    'syllabus-subject-filter',
    'filter-subject',
  ];

  selectIds.forEach(id => {
    const sel = $(id);
    if (!sel) return;

    // Preserve current value
    const current = sel.value;

    // Keep only the first placeholder option
    const firstOpt = sel.querySelector('option');
    sel.innerHTML = '';
    if (firstOpt) sel.appendChild(firstOpt);

    subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value       = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });

    // Restore previous value if still valid
    if (current && subjects.some(s => String(s.id) === current)) {
      sel.value = current;
    }
  });
}

/* ────────────────────────────────────────────────────────────
   SETTINGS
──────────────────────────────────────────────────────────── */
function initSettings() {
  // Theme preference buttons
  $('pref-dark')?.addEventListener('click', () => {
    applyTheme('dark');
    localStorage.setItem('mbbs_theme', 'dark');
  });
  $('pref-light')?.addEventListener('click', () => {
    applyTheme('light');
    localStorage.setItem('mbbs_theme', 'light');
  });

  // Sound preference
  $('pref-sound')?.addEventListener('change', (e) => {
    localStorage.setItem('mbbs_sound', e.target.checked ? '1' : '0');
    if (e.target.checked && typeof TimerModule !== 'undefined' && TimerModule.playTestSound) {
      TimerModule.playTestSound();
    }
  });

  $('btn-test-sound')?.addEventListener('click', () => {
    if (typeof TimerModule !== 'undefined' && TimerModule.playTestSound) {
      TimerModule.playTestSound();
    }
  });

  // Notifications preference
  $('pref-notifications')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          e.target.checked = false;
          showToast('Notification permission denied.', 'error');
          return;
        }
      }
      localStorage.setItem('mbbs_notifications', '1');
    } else {
      localStorage.setItem('mbbs_notifications', '0');
    }
  });

  // Daily goal
  $('pref-daily-goal')?.addEventListener('change', (e) => {
    const val = Math.max(1, Math.min(24, parseInt(e.target.value) || 8));
    e.target.value = val;
    localStorage.setItem('mbbs_daily_goal', val);
  });

  // Danger zone
  $('btn-clear-sessions')?.addEventListener('click', () => {
    showConfirm(
      'Delete ALL study sessions? This cannot be undone.',
      async () => {
        await DB.clearAllSessions();
        showToast('All sessions deleted.', 'success');
        await onSectionEnter(AppState.currentSection);
      }
    );
  });

  $('btn-reset-all')?.addEventListener('click', () => {
    showConfirm(
      'Reset EVERYTHING? All data (sessions, subjects, exams, syllabus) will be permanently deleted.',
      async () => {
        await DB.resetAll();
        await DB.seedDefaultSubjects();
        localStorage.removeItem('mbbs_last_section');
        showToast('All data reset. Default subjects restored.', 'success');
        await populateAllSubjectSelects();
        navigateTo('dashboard');
      }
    );
  });

  // Export / Import (delegated to backup module)
  $('btn-export')?.addEventListener('click', () => {
    if (typeof BackupModule !== 'undefined') {
      BackupModule.exportData();
    }
  });

  $('btn-import-trigger')?.addEventListener('click', () => {
    $('btn-import')?.click();
  });

  $('btn-import')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (typeof BackupModule !== 'undefined') {
      await BackupModule.importData(file);
      await populateAllSubjectSelects();
      await onSectionEnter(AppState.currentSection);
    }
    e.target.value = ''; // reset so same file can be re-imported
  });
}

function syncSettingsUI() {
  // Sound
  const sound = $('pref-sound');
  if (sound) sound.checked = localStorage.getItem('mbbs_sound') !== '0';

  // Notifications
  const notif = $('pref-notifications');
  if (notif) notif.checked = localStorage.getItem('mbbs_notifications') === '1';

  // Daily goal
  const goal = $('pref-daily-goal');
  if (goal) goal.value = localStorage.getItem('mbbs_daily_goal') || '8';

  // Theme
  const theme = localStorage.getItem('mbbs_theme') || 'dark';
  applyTheme(theme);
}

/* ────────────────────────────────────────────────────────────
   DASHBOARD BUTTONS (shortcuts in cards)
──────────────────────────────────────────────────────────── */
function initDashboardButtons() {
  // "View All" sessions → sessions section
  $('btn-view-all-sessions')?.addEventListener('click', () => navigateTo('sessions'));
}

/* ────────────────────────────────────────────────────────────
   SECTION TOOLBAR BUTTONS
──────────────────────────────────────────────────────────── */
function initSectionToolbarButtons() {
  // Analytics period tabs
  $$('.period-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      $$('.period-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      if (typeof ChartsModule !== 'undefined') {
        await ChartsModule.render(tab.dataset.period);
      }
    });
  });

  // Syllabus subject filter
  $('syllabus-subject-filter')?.addEventListener('change', async (e) => {
    const subjectId = e.target.value;
    if (subjectId && typeof SyllabusModule !== 'undefined') {
      await SyllabusModule.render(subjectId);
    }
  });

  // Sessions filters
  ['filter-subject', 'filter-date-from', 'filter-date-to'].forEach(id => {
    $(id)?.addEventListener('change', refreshSessionsSection);
  });

  $('btn-filter-clear')?.addEventListener('click', async () => {
    $('filter-subject').value    = '';
    $('filter-date-from').value  = '';
    $('filter-date-to').value    = '';
    await refreshSessionsSection();
  });
}

/* ────────────────────────────────────────────────────────────
   DASHBOARD REFRESH
──────────────────────────────────────────────────────────── */
async function refreshDashboard() {
  await populateAllSubjectSelects();

  // Stats
  if (typeof StatsModule !== 'undefined') {
    const stats = await StatsModule.compute();
    renderStatCards(stats);
  }

  // Streak
  if (typeof StreakModule !== 'undefined') {
    const streak = await StreakModule.compute();
    renderStreakWidget(streak);
  }

  // Countdown widget
  await refreshCountdownWidget();

  // Recent sessions
  await renderRecentSessions();

  // Weekly preview chart
  if (typeof ChartsModule !== 'undefined') {
    await ChartsModule.renderWeekPreview('chart-week-preview');
  }
}

/* ── Stat cards ── */
function renderStatCards(stats) {
  const fmtTime = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  };

  animateValue('stat-today',    fmtTime(stats.todayMins));
  animateValue('stat-week',     fmtTime(stats.weekMins));
  animateValue('stat-month',    fmtTime(stats.monthMins));
  animateValue('stat-lifetime', fmtTime(stats.lifetimeMins));

  const sessions = $('stat-today-sessions');
  if (sessions) sessions.textContent = `${stats.todaySessions} session${stats.todaySessions !== 1 ? 's' : ''}`;

  const weekAvg = $('stat-week-avg');
  if (weekAvg) {
    const avgH = (stats.weekMins / 60 / 7).toFixed(1);
    weekAvg.textContent = `avg ${avgH}h/day`;
  }

  const monthSess = $('stat-month-sessions');
  if (monthSess) monthSess.textContent = `${stats.monthSessions} sessions`;

  const lifetimeDays = $('stat-lifetime-days');
  if (lifetimeDays) lifetimeDays.textContent = `${stats.totalDays} study days`;
}

function animateValue(id, value) {
  const el = $(id);
  if (!el) return;
  if (el.textContent !== value) {
    el.textContent = value;
    el.classList.remove('updating');
    void el.offsetWidth; // reflow to retrigger animation
    el.classList.add('updating');
  }
}

/* ── Streak widget ── */
function renderStreakWidget(streak) {
  // Badge
  const badge = $('streak-badge');
  if (badge) badge.textContent = streak.current;

  // Numbers
  const curr = $('current-streak');
  const best = $('best-streak');
  if (curr) curr.textContent = streak.current;
  if (best) best.textContent = streak.best;

  // Flame display
  const flames = $('streak-flames');
  if (flames) {
    if (streak.current === 0) {
      flames.textContent = '—';
      flames.classList.remove('alive');
    } else {
      const count = Math.min(streak.current, 7);
      flames.textContent = '🔥'.repeat(count);
      flames.classList.add('alive');
    }
  }

  // Last 7 days mini calendar
  const weekEl = $('streak-week');
  if (weekEl) {
    weekEl.innerHTML = '';
    const dayLabels = ['S','M','T','W','T','F','S'];
    streak.last7.forEach((studied, i) => {
      const dayDate = new Date();
      dayDate.setDate(dayDate.getDate() - (6 - i));
      const isToday = i === 6;
      const div = document.createElement('div');
      div.className = 'streak-day' +
        (studied ? ' streak-day--studied' : '') +
        (isToday ? ' streak-day--today' : '');
      div.setAttribute('role', 'listitem');
      div.setAttribute('aria-label', `${dayLabels[dayDate.getDay()]}: ${studied ? 'studied' : 'no study'}`);
      div.innerHTML = `
        <div class="streak-day__dot"></div>
        <span class="streak-day__label">${dayLabels[dayDate.getDay()]}</span>
      `;
      weekEl.appendChild(div);
    });
  }
}

/* ── Countdown widget (dashboard) ── */
async function refreshCountdownWidget() {
  if (typeof CountdownModule !== 'undefined') {
    const next = await CountdownModule.getNext();
    renderCountdownWidget(next);
  }
}

function renderCountdownWidget(exam) {
  const emptyEl  = $('countdown-empty');
  const activeEl = $('countdown-active');

  if (!exam) {
    emptyEl?.classList.remove('hidden');
    activeEl?.classList.add('hidden');
    CountdownModule.stopTick();
    return;
  }

  emptyEl?.classList.add('hidden');
  activeEl?.classList.remove('hidden');

  const nameEl = $('countdown-exam-name');
  const dateEl = $('countdown-date');
  if (nameEl) nameEl.textContent = exam.name;
  if (dateEl) {
    dateEl.textContent = new Date(exam.date).toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  // Live tick
  CountdownModule.startTick(exam.date, (d, h, m, s) => {
    const cdDays  = $('cd-days');
    const cdHours = $('cd-hours');
    const cdMins  = $('cd-mins');
    const cdSecs  = $('cd-secs');
    if (cdDays)  cdDays.textContent  = String(d).padStart(2,'0');
    if (cdHours) cdHours.textContent = String(h).padStart(2,'0');
    if (cdMins)  cdMins.textContent  = String(m).padStart(2,'0');
    if (cdSecs)  cdSecs.textContent  = String(s).padStart(2,'0');
  });
}

/* ── Recent sessions ── */
async function renderRecentSessions() {
  const sessions = await DB.getRecentSessions(8);
  const emptyEl  = $('recent-sessions-empty');
  const listEl   = $('recent-session-items');

  if (!listEl) return;

  if (!sessions.length) {
    emptyEl?.classList.remove('hidden');
    listEl.innerHTML = '';
    return;
  }

  emptyEl?.classList.add('hidden');
  listEl.innerHTML = sessions.map(s => sessionItemHTML(s, false)).join('');
}

/* ────────────────────────────────────────────────────────────
   SESSIONS SECTION REFRESH
──────────────────────────────────────────────────────────── */
async function refreshSessionsSection() {
  const subjectId  = $('filter-subject')?.value  || '';
  const dateFrom   = $('filter-date-from')?.value || '';
  const dateTo     = $('filter-date-to')?.value   || '';

  let sessions = await DB.getAllSessions();

  // Apply filters
  if (subjectId) {
    sessions = sessions.filter(s => String(s.subjectId) === subjectId);
  }
  if (dateFrom) {
    const [fy, fm, fd] = dateFrom.split('-').map(Number);
    const from = new Date(fy, fm - 1, fd).getTime();
    sessions = sessions.filter(s => s.startTime >= from);
  }
  if (dateTo) {
    const [ty, tm, td] = dateTo.split('-').map(Number);
    const to = new Date(ty, tm - 1, td, 23, 59, 59, 999).getTime();
    sessions = sessions.filter(s => s.startTime <= to);
  }

  // Sort newest first
  sessions.sort((a, b) => b.startTime - a.startTime);

  const emptyEl = $('sessions-empty');
  const listEl  = $('all-session-items');
  const countEl = $('sessions-count-label');
  const timeEl  = $('sessions-total-time-label');

  if (!listEl) return;

  if (!sessions.length) {
    emptyEl?.classList.remove('hidden');
    listEl.innerHTML = '';
  } else {
    emptyEl?.classList.add('hidden');
    listEl.innerHTML = sessions.map(s => sessionItemHTML(s, true)).join('');

    // Wire delete buttons
    listEl.querySelectorAll('.session-item__delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = parseInt(e.currentTarget.dataset.id);
        showConfirm('Delete this session?', async () => {
          await DB.deleteSession(id);
          showToast('Session deleted.', 'success');
          await refreshSessionsSection();
          if (AppState.currentSection === 'dashboard') await refreshDashboard();
        });
      });
    });
  }

  // Summary bar
  const totalMins = sessions.reduce((acc, s) => acc + (s.duration || 0), 0);
  if (countEl) countEl.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
  if (timeEl) {
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    timeEl.textContent = `${h}h ${String(m).padStart(2, '0')}m total`;
  }
}

/* ── Session item HTML ── */
function sessionItemHTML(s, withDelete = false) {
  const date = new Date(s.startTime).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
  const time = new Date(s.startTime).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });
  const dur = s.duration >= 60
    ? `${Math.floor(s.duration / 60)}h ${s.duration % 60}m`
    : `${s.duration}m`;

  const deleteBtn = withDelete
    ? `<button class="session-item__delete" data-id="${s.id}" aria-label="Delete session" title="Delete">✕</button>`
    : '';

  return `
    <li class="session-item">
      <div class="session-item__color" style="background:${escapeHtml(s.subjectColor || '#00d4ff')}"></div>
      <div class="session-item__body">
        <div class="session-item__subject">${escapeHtml(s.subjectName || 'No Subject')}</div>
        ${s.topic ? `<div class="session-item__topic">${escapeHtml(s.topic)}</div>` : ''}
      </div>
      <div class="session-item__meta">
        <span class="session-item__duration">${dur}</span>
        <span class="session-item__date">${date} ${time}</span>
      </div>
      ${deleteBtn}
    </li>
  `;
}

/* ────────────────────────────────────────────────────────────
   SUBJECTS SECTION REFRESH
──────────────────────────────────────────────────────────── */
async function refreshSubjectsSection() {
  const subjects = await DB.getAllSubjects();
  const grid     = $('subject-grid');
  const emptyEl  = $('subjects-empty');

  if (!grid) return;

  if (!subjects.length) {
    emptyEl?.classList.remove('hidden');
    // Clear all subject cards but keep empty state
    grid.querySelectorAll('.subject-card').forEach(c => c.remove());
    return;
  }

  emptyEl?.classList.add('hidden');

  // Fetch all sessions to compute per-subject stats
  const allSessions = await DB.getAllSessions();

  // Build stats map
  const statsMap = {};
  allSessions.forEach(s => {
    const key = String(s.subjectId);
    if (!statsMap[key]) statsMap[key] = { total: 0, sessions: 0, thisWeek: 0 };
    statsMap[key].total    += s.duration || 0;
    statsMap[key].sessions += 1;

    // This week
    const weekStart = getWeekStart();
    if (s.startTime >= weekStart) statsMap[key].thisWeek += s.duration || 0;
  });

  grid.innerHTML = '';
  if (emptyEl) grid.appendChild(emptyEl);

  subjects.forEach(sub => {
    const stats   = statsMap[String(sub.id)] || { total: 0, sessions: 0, thisWeek: 0 };
    const totalH  = (stats.total / 60).toFixed(1);
    const weekH   = (stats.thisWeek / 60).toFixed(1);
    const target  = sub.weeklyTarget || 0;
    const pct     = target > 0 ? Math.min(100, Math.round((stats.thisWeek / 60 / target) * 100)) : 0;

    const card = document.createElement('div');
    card.className = 'subject-card';
    card.innerHTML = `
      <div class="subject-card__stripe" style="background:${escapeHtml(sub.color)}"></div>
      <div class="subject-card__header">
        <div class="subject-card__name">${escapeHtml(sub.name)}</div>
        <div class="subject-card__actions">
          <button class="icon-btn icon-btn--sm subject-card__delete" data-id="${sub.id}" aria-label="Delete ${escapeHtml(sub.name)}">✕</button>
        </div>
      </div>
      <div class="subject-card__stats">
        <div class="subject-stat">
          <span class="subject-stat__value">${totalH}h</span>
          <span class="subject-stat__label">Total</span>
        </div>
        <div class="subject-stat">
          <span class="subject-stat__value">${stats.sessions}</span>
          <span class="subject-stat__label">Sessions</span>
        </div>
        <div class="subject-stat">
          <span class="subject-stat__value">${weekH}h</span>
          <span class="subject-stat__label">This week</span>
        </div>
        <div class="subject-stat">
          <span class="subject-stat__value" style="color:${escapeHtml(sub.color)}">${target ? target + 'h' : '—'}</span>
          <span class="subject-stat__label">Wk target</span>
        </div>
      </div>
      ${target > 0 ? `
        <div class="subject-card__progress">
          <div class="subject-card__progress-label">
            <span>Weekly progress</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar ${pct >= 100 ? 'progress-bar--success' : ''}"
                 style="width:${pct}%; ${pct < 100 ? 'background:' + escapeHtml(sub.color) : ''}"
                 role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            </div>
          </div>
        </div>
      ` : ''}
    `;

    // Delete button
    card.querySelector('.subject-card__delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(e.currentTarget.dataset.id);
      showConfirm(
        `Delete subject "${sub.name}"? Sessions linked to this subject will remain but lose their subject label.`,
        async () => {
          await DB.deleteSubject(id);
          showToast(`Subject "${sub.name}" deleted.`, 'success');
          await refreshSubjectsSection();
          await populateAllSubjectSelects();
        }
      );
    });

    grid.appendChild(card);
  });
}

/* ────────────────────────────────────────────────────────────
   SYLLABUS SECTION REFRESH
──────────────────────────────────────────────────────────── */
async function refreshSyllabusSection() {
  await populateAllSubjectSelects();

  const subjectId = $('syllabus-subject-filter')?.value;
  if (subjectId && typeof SyllabusModule !== 'undefined') {
    await SyllabusModule.render(subjectId);
  }
}

/* ────────────────────────────────────────────────────────────
   ANALYTICS SECTION REFRESH
──────────────────────────────────────────────────────────── */
async function refreshAnalyticsSection() {
  if (typeof ChartsModule === 'undefined') return;

  const activePeriod = document.querySelector('.period-tab.active')?.dataset.period || 'week';
  await ChartsModule.render(activePeriod);
  await ChartsModule.renderHeatmap('heatmap-container');
}

/* ────────────────────────────────────────────────────────────
   EXAMS SECTION REFRESH
──────────────────────────────────────────────────────────── */
async function refreshExamsSection() {
  await populateAllSubjectSelects();

  const exams  = await DB.getAllExams();
  const grid   = $('exams-grid');
  const emptyEl = $('exams-empty');

  if (!grid) return;

  if (!exams.length) {
    emptyEl?.classList.remove('hidden');
    grid.querySelectorAll('.exam-card').forEach(c => c.remove());
    return;
  }

  emptyEl?.classList.add('hidden');

  // Sort by date ascending
  exams.sort((a, b) => a.date - b.date);

  grid.innerHTML = '';
  if (emptyEl) grid.appendChild(emptyEl);

  const now = Date.now();

  exams.forEach(exam => {
    const diff = exam.date - now;
    const days = Math.ceil(diff / 86400000);
    const isPast   = diff < 0;
    const isUrgent = !isPast && days <= 7;
    const isNear   = !isPast && !isUrgent && days <= 30;

    const card = document.createElement('div');
    card.className = 'exam-card' +
      (isPast   ? ' exam-card--past'   : '') +
      (isUrgent ? ' exam-card--urgent' : '') +
      (isNear   ? ' exam-card--near'   : '');

    const dateStr = new Date(exam.date).toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
    const timeStr = new Date(exam.date).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });

    const displayDays = isPast ? `${Math.abs(days)} days ago` : `${days} day${days !== 1 ? 's' : ''}`;

    card.innerHTML = `
      <div class="exam-card__header">
        <div class="exam-card__name">${escapeHtml(exam.name)}</div>
        <button class="exam-card__delete" data-id="${exam.id}" aria-label="Delete exam">✕</button>
      </div>
      <div class="exam-card__countdown">
        <span class="exam-card__days">${Math.abs(days)}</span>
        <span class="exam-card__days-label">${isPast ? 'days ago' : 'days left'}</span>
      </div>
      <div class="exam-card__date">${dateStr} · ${timeStr}</div>
    `;

    card.querySelector('.exam-card__delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(e.currentTarget.dataset.id);
      showConfirm(`Delete exam "${exam.name}"?`, async () => {
        await DB.deleteExam(id);
        showToast('Exam deleted.', 'success');
        await refreshExamsSection();
        await refreshCountdownWidget();
      });
    });

    grid.appendChild(card);
  });
}

/* ────────────────────────────────────────────────────────────
   TIMER SECTION REFRESH
──────────────────────────────────────────────────────────── */
async function refreshTimerSection() {
  await populateAllSubjectSelects();

  if (typeof TimerModule !== 'undefined') {
    TimerModule.init();
    await TimerModule.refreshDailyStats();
    await TimerModule.renderSubjectDonut('chart-subject-donut', 'subject-legend');
  }
}

/* ────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────── */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = now.getDate() - day;
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.getTime();
}

/* ────────────────────────────────────────────────────────────
   GLOBAL EXPORTS (used by other modules)
──────────────────────────────────────────────────────────── */
window.App = {
  showToast,
  showConfirm,
  openModal,
  closeModal,
  closeAllModals,
  navigateTo,
  refreshDashboard,
  refreshSessionsSection,
  refreshSubjectsSection,
  refreshSyllabusSection,
  refreshAnalyticsSection,
  refreshExamsSection,
  refreshTimerSection,
  refreshCountdownWidget,
  populateAllSubjectSelects,
  escapeHtml,
  getWeekStart,
  sessionItemHTML,
  renderCountdownWidget,
  SUBJECT_COLORS,
};
