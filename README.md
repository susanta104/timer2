# ⚕ MBBS Study Command Center

A Progressive Web App for medical students — track study sessions, subjects, streaks, syllabus completion, and exam countdowns. Works fully offline. Installable on Android, iPhone, iPad, and MacBook.

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [GitHub Pages Deployment](#github-pages-deployment)
- [Installing the App](#installing-the-app)
  - [Android](#android)
  - [iPhone & iPad](#iphone--ipad)
  - [MacBook (Chrome & Safari)](#macbook-chrome--safari)
- [Usage Guide](#usage-guide)
- [Offline Support](#offline-support)
- [Updating the App](#updating-the-app)
- [Future Updates & Roadmap](#future-updates--roadmap)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## Features

| Feature | Description |
|---|---|
| **Study Timer** | 25, 50, 90-minute presets and custom duration with visual ring progress |
| **Session Logging** | Auto-log after timer ends or enter manually with subject, topic, notes |
| **Subject Tracking** | Per-subject total hours, weekly progress, and colour-coded cards |
| **Daily / Weekly / Monthly / Lifetime Stats** | Running totals always visible on the dashboard |
| **Study Streak** | Current streak, best streak, and last-7-days activity calendar |
| **Syllabus Tracker** | Add topics and subtopics per subject, tick them off as you complete them |
| **Exam Countdown** | Live day/hour/minute/second countdown to multiple upcoming exams |
| **Analytics Charts** | Bar, line, pie, and heatmap charts across week / month / year / all-time |
| **Dark & Light Mode** | Persistent theme preference |
| **Export / Import** | Full JSON backup and restore |
| **Offline-First** | All data stored in IndexedDB; works with zero internet after first load |
| **Installable PWA** | Add to home screen on any device, runs like a native app |

---

## Project Structure

```
mbbs-study-command-center/
│
├── index.html              ← App shell, all sections and modals
├── style.css               ← Complete stylesheet (dark/light, responsive)
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service Worker (offline caching)
│
├── js/
│   ├── db.js               ← IndexedDB setup and all CRUD operations
│   ├── sessions.js         ← Session logging and retrieval
│   ├── stats.js            ← Daily/weekly/monthly/lifetime aggregation
│   ├── streak.js           ← Streak calculation logic
│   ├── countdown.js        ← Exam countdown management and live tick
│   ├── syllabus.js         ← Syllabus topic/subtopic CRUD and rendering
│   ├── charts.js           ← Chart.js wrappers for all analytics views
│   ├── timer.js            ← Study timer state machine
│   ├── backup.js           ← Export and import JSON backup
│   └── app.js              ← Boot, routing, modals, toasts, theme
│
└── icons/
    ├── icon-192.png
    ├── icon-192-maskable.png
    ├── icon-512.png
    ├── icon-512-maskable.png
    ├── screenshot-mobile.png
    └── screenshot-desktop.png
```

---

## GitHub Pages Deployment

### First-time setup

**1. Create a repository**

Go to [github.com/new](https://github.com/new) and create a new **public** repository. Name it anything — for example `mbbs-cmd`.

**2. Push the project files**

```bash
git init
git add .
git commit -m "Initial release — MBBS Study Command Center v1.0.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mbbs-cmd.git
git push -u origin main
```

**3. Enable GitHub Pages**

- Open your repository on GitHub
- Go to **Settings → Pages**
- Under **Source**, select **Deploy from a branch**
- Set **Branch** to `main` and folder to `/ (root)`
- Click **Save**

GitHub will give you a URL like:

```
https://YOUR_USERNAME.github.io/mbbs-cmd/
```

Deployment takes 1–3 minutes. Reload the Pages settings tab to see when it goes live.

> **Important:** The service worker uses relative paths (`./index.html`, `./js/app.js`, etc.) so it works correctly whether the app is served from the root domain or a subdirectory like `/mbbs-cmd/`.

**4. Verify the PWA**

Open Chrome DevTools → **Application → Manifest** and **Application → Service Workers** to confirm both are registered correctly.

### Updating after the first deploy

```bash
# Make your changes, then:
git add .
git commit -m "Update: describe your change"
git push
```

GitHub Pages rebuilds automatically within ~60 seconds. Users already running the app will see a toast notification: **"Update available — refresh to apply."**

---

## Installing the App

Once deployed to GitHub Pages (or any HTTPS server), the app can be installed natively on any device. **No app store required.**

---

### Android

Works on Chrome, Edge, and Samsung Internet.

**Chrome (recommended)**

1. Open Chrome and navigate to your GitHub Pages URL.
2. Wait a few seconds for the page to fully load.
3. Tap the **three-dot menu** (⋮) in the top-right corner.
4. Tap **"Add to Home screen"** or **"Install app"**.
5. Confirm the name and tap **Add** / **Install**.
6. The MBBS CMD icon appears on your home screen and app drawer.
7. Tap it — it opens in standalone mode with no browser chrome.

**Automatic install banner**

The app shows its own install banner at the top of the page. Tap **Install** there to skip the menu steps.

**Tips for Android:**

- Go to **Settings → Apps → MBBS CMD** to see it listed like a native app.
- It supports Android's Back gesture to navigate within the app.
- The splash screen uses the dark background color while the app loads.
- Adaptive icons (maskable) display correctly in circles, squircles, or teardrops depending on your launcher.

---

### iPhone & iPad

Safari on iOS/iPadOS does not show an automatic install prompt — you must use the Share menu.

**Steps:**

1. Open **Safari** (must be Safari — Chrome on iOS cannot install PWAs).
2. Navigate to your GitHub Pages URL.
3. Wait for the page to fully load.
4. Tap the **Share button** — the rectangle with an arrow pointing up:
   - iPhone: bottom center of the screen
   - iPad: top-right of the Safari toolbar
5. Scroll down in the Share sheet and tap **"Add to Home Screen"**.
6. Edit the name if desired (default is **MBBS CMD**).
7. Tap **Add** in the top-right corner.
8. The icon appears on your home screen.

**Open the installed app:**

Tap the ⚕ icon on your home screen. It launches in full-screen standalone mode — no Safari address bar, no tabs.

**iPhone-specific notes:**

- The status bar blends with the app's dark background (`apple-mobile-web-app-status-bar-style: black-translucent`).
- Safe area insets (notch, Dynamic Island, home indicator) are handled automatically with `viewport-fit=cover` and `env(safe-area-inset-*)`.
- The app remembers which section you were on when you close and reopen it.

**iPad-specific notes:**

- The sidebar navigation is always visible in landscape on iPad.
- In portrait, the sidebar slides in from the left — tap the ☰ menu button.
- Charts and analytics grids use the full wide layout automatically.
- Split View and Slide Over are supported — the responsive layout adapts.

**Updating on iOS:**

Apple caches aggressively. To get the latest version:
1. Open the installed app.
2. Pull-to-refresh is not available in standalone mode — instead, go to **Settings → Safari → Clear History and Website Data**, or delete and re-add the app.

---

### MacBook (Chrome & Safari)

#### Chrome / Edge / Brave (recommended)

1. Open Chrome and navigate to your GitHub Pages URL.
2. Look for the **install icon** (⊕) in the address bar on the right side.
3. Click it and select **"Install MBBS Study Command Center"**.
4. Click **Install** in the dialog.
5. The app opens in its own window — no browser tabs, no address bar.
6. It appears in your **Applications folder**, **Dock**, and **Launchpad**.

If you do not see the install icon:
- Open **Chrome menu (⋮) → Save and Share → Install page as app...**

**To add to Dock:**

After installing, right-click the app in your Dock → **Options → Keep in Dock**.

#### Safari (macOS Sonoma 14 and later)

Safari on macOS added PWA install support in Sonoma.

1. Open Safari and navigate to your GitHub Pages URL.
2. Click **File** in the menu bar.
3. Select **"Add to Dock…"**
4. Edit the name if desired and click **Add**.
5. The app appears in your Dock and runs as a standalone window.

**Safari on macOS Ventura and earlier:**

PWA installation is not supported. Use Chrome or Edge instead.

**MacBook tips:**

- The app window is resizable — drag to any size; the layout responds at every breakpoint.
- Press `⌘ + R` inside the app window to reload and pick up updates.
- All data lives in IndexedDB inside the browser profile — it survives system restarts.
- To export a backup before switching browsers, go to **Settings → Export**.

---

## Usage Guide

### First launch

1. Go to **Subjects** and add your MBBS subjects (Anatomy, Physiology, Biochemistry, etc.). Assign each a color and a weekly hour target.
2. Go to **Syllabus** and select a subject to add topics and subtopics.
3. Go to **Exam Countdown** and add your next scheduled exam.
4. Return to **Dashboard** — your stats, streak, and countdown are now live.

### Starting a study session

1. Tap **Study Timer** in the navigation.
2. Select a preset duration (25, 50, or 90 min) or set a custom time.
3. Tap **Start**.
4. When the timer ends, the session log form appears — select the subject, add a topic/notes, and tap **Save Session**.

### Logging a session manually

1. Go to **Sessions**.
2. Tap **+ Manual Entry**.
3. Fill in the subject, topic, date, duration, and optional notes.
4. Tap **Save Session**.

### Checking your syllabus

1. Go to **Syllabus**.
2. Select a subject from the dropdown.
3. Add topics with **+ Add Topic**. Paste subtopics as a comma-separated list.
4. Tap a topic's checkbox to mark it complete. Expand a topic to check off individual subtopics.
5. The progress bar and percentage update instantly.

### Backing up your data

1. Go to **Settings → Export**.
2. A JSON file downloads to your device containing all sessions, subjects, exams, and syllabus data.
3. Store this file in iCloud, Google Drive, or any safe location.

### Restoring a backup

1. Go to **Settings → Import**.
2. Select the previously exported JSON file.
3. All data is restored and the UI refreshes automatically.

---

## Offline Support

The app is fully functional without an internet connection after the first load.

| Resource | Offline behavior |
|---|---|
| App shell (HTML, CSS, JS) | Served from cache — instant load |
| Study data (sessions, subjects, exams) | Stored in IndexedDB — never needs internet |
| Google Fonts | Served from cache if previously loaded |
| Chart.js | Served from cache |
| First-ever load | Requires internet to download and cache all assets |

**The service worker caches:**

- `mbbs-shell-v1.0.0` — all app shell files
- `mbbs-fonts-v1.0.0` — Google Fonts stylesheets and woff2 files
- `mbbs-cdn-v1.0.0` — Chart.js from jsDelivr
- `mbbs-runtime-v1.0.0` — any other fetched resources

If you open the app with no connection and assets have not been cached yet, a clean offline fallback page is displayed with a **Try Again** button.

---

## Updating the App

### For developers — pushing a new version

1. Make your code changes.
2. Open `sw.js` and bump the version string at the top:

```js
// Before
const CACHE_VERSION = 'v1.0.0';

// After
const CACHE_VERSION = 'v1.1.0';
```

3. Commit and push to GitHub:

```bash
git add .
git commit -m "Release v1.1.0 — describe changes"
git push
```

4. GitHub Pages deploys within ~60 seconds.
5. When users next open the app, the service worker detects the change, downloads the new version in the background, and shows a toast: **"Update available — refresh to apply."**
6. The user refreshes once — the new version activates instantly.

> Bumping `CACHE_VERSION` is the critical step. It causes the browser to treat the new SW as a different worker, triggering install and activate events, which delete old caches and pre-cache fresh files.

### For users — getting the latest version

**Android / Chrome:** The app updates silently in the background. When an update is ready, a notification appears inside the app. Tap refresh or close and reopen.

**iPhone / iPad / Safari:** Delete the app from your home screen and re-add it from Safari to guarantee you have the latest version.

**MacBook / Chrome:** The app updates automatically. Press `⌘ + R` inside the app window to apply a pending update immediately.

---

## Future Updates & Roadmap

The following features are planned for future releases. Contributions are welcome.

### v1.1 — Smart Reminders

- [ ] Daily study reminder notifications (using the Push API hook already in `sw.js`)
- [ ] Configurable reminder time in Settings
- [ ] Break reminders during long sessions
- [ ] Exam-day morning alert

### v1.2 — Pomodoro Mode

- [ ] Automatic break scheduling (5-min break after 25 min, 15-min break after 4 cycles)
- [ ] Break timer with a distinct ring tone
- [ ] Pomodoro cycle counter displayed on the timer screen
- [ ] Option to skip or extend breaks

### v1.3 — Goals & Progress

- [ ] Daily hour goal with a progress ring on the dashboard
- [ ] Weekly goal per subject (UI exists; enforcement logic planned)
- [ ] Monthly milestone badges
- [ ] Goal completion celebration animation

### v1.4 — Notes & Resources

- [ ] Rich text notes per topic in the syllabus
- [ ] Link external resources (YouTube, PDF, article) to a topic
- [ ] Quick-access notes panel during a timer session
- [ ] Search across all notes

### v1.5 — Multi-Device Sync

- [ ] Optional cloud sync via a lightweight backend (Firebase / Supabase)
- [ ] Sign in with Google — data follows you across devices
- [ ] Conflict resolution for offline-first edits
- [ ] Shared study groups (see friends' streaks)

### v2.0 — AI Study Assistant

- [ ] Generate a revision schedule from syllabus completion data
- [ ] Suggest topics to revise based on time since last studied
- [ ] Spaced repetition scoring per topic
- [ ] Weekly performance report with AI commentary

---

### Contributing

1. Fork the repository on GitHub.
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add: my feature"`
4. Push and open a Pull Request.

Please keep each PR focused on one feature or fix. All code must work offline and pass basic testing on Chrome (Android + macOS), Safari (iOS + macOS), and Firefox.

---

## Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Semantic app shell and section structure |
| CSS3 | Custom properties, grid, flexbox, animations — no framework |
| Vanilla JavaScript (ES2020) | All app logic — no build step required |
| IndexedDB | Client-side persistent storage for all study data |
| Service Worker | Offline caching, background sync hook, push notification hook |
| Web App Manifest | PWA installability, icons, shortcuts, splash screen |
| Chart.js 4 | Bar, line, pie, and doughnut analytics charts |
| Google Fonts | Share Tech Mono, Barlow Condensed, Barlow |

**No Node.js. No npm. No build step. No framework.**
Open `index.html` directly in a browser during development, or deploy the folder as-is to any static host.

---

## License

MIT License — free to use, modify, and distribute.

```
Copyright (c) 2025 MBBS Study Command Center

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

---

*Built for medical students who take their study seriously.*
