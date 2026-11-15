// Pomodoro Pill — main process
// Owns the timer (single source of truth), windows, tray, global hotkeys and storage.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, globalShortcut, powerMonitor } = require('electron');
const path = require('path');
const { JsonFile, DEFAULT_SETTINGS, localDateKey, computeStats } = require('./store');

const THEMES = [
  { id: 'forest', name: 'Forest Fireflies' },
  { id: 'ocean', name: 'Ocean Dusk' },
  { id: 'monsoon', name: 'Monsoon Rain' },
  { id: 'sakura', name: 'Sakura Drift' },
  { id: 'aurora', name: 'Aurora Night' },
  { id: 'snow', name: 'Snowfall' },
  { id: 'meadow', name: 'Sunny Meadow' }
];
const MODE_LABEL = { work: 'Focus', short: 'Short break', long: 'Long break' };
const PILL_W = 300, PILL_H = 84;          // includes transparent margin for the shadow

if (!app.requestSingleInstanceLock()) { app.quit(); }

app.setAppUserModelId('com.rahul.pomodoropill');

let settingsFile, statsFile;
let pill = null, settingsWin = null, tray = null;
let fsWins = [];                 // full-screen windows (first = main)
let pillWasVisible = true;
let hotkeyErrors = {};
let dragTimer = null;
let quitting = false;

const S = () => settingsFile.data;

// ---------------------------------------------------------------- timer engine
const timer = {
  mode: 'work',
  running: false,
  endAt: 0,          // epoch ms when running
  remaining: 0,      // ms when paused
  duration: 0,       // full length of current session, ms
  cycleDone: 0,      // completed focus sessions in the current cycle
  sessionStart: 0
};

function durationFor(mode) {
  const s = S();
  const min = mode === 'work' ? s.workMin : mode === 'short' ? s.shortMin : s.longMin;
  return Math.max(1, Number(min) || 1) * 60 * 1000;
}
function remainingMs() {
  return timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remaining;
}
function setMode(mode, autoStart = false) {
  timer.mode = mode;
  timer.duration = durationFor(mode);
  timer.remaining = timer.duration;
  timer.running = false;
  if (autoStart) start(); else broadcastState();
}
function start() {
  if (timer.running) return;
  if (timer.remaining <= 0) timer.remaining = timer.duration;
  if (timer.remaining === timer.duration) timer.sessionStart = Date.now();
  timer.endAt = Date.now() + timer.remaining;
  timer.running = true;
  broadcastState();
}
function pause() {
  if (!timer.running) return;
  timer.remaining = Math.max(0, timer.endAt - Date.now());
  timer.running = false;
  broadcastState();
}
function toggle() { timer.running ? pause() : start(); }
function reset() {
  timer.running = false;
  timer.duration = durationFor(timer.mode);
  timer.remaining = timer.duration;
  broadcastState();
}
function nextMode() {
  if (timer.mode === 'work') {
    return (timer.cycleDone % S().cycleLength === 0 && timer.cycleDone > 0) ? 'long' : 'short';
  }
  return 'work';
}
function skip() {
  // Skipping never counts the session.
  const from = timer.mode;
  if (from === 'long') timer.cycleDone = 0;
  const to = from === 'work' ? (((timer.cycleDone + 1) % S().cycleLength === 0) ? 'long' : 'short') : 'work';
  setMode(to, false);
}
function complete() {
  const from = timer.mode;
  if (from === 'work') {
    timer.cycleDone++;
    const s = S();
    statsFile.data.sessions.push({
      d: localDateKey(), t: Date.now(),
      m: Math.round(timer.duration / 60000),
      task: (s.task || '').trim()
    });
    statsFile.save(true);
  } else if (from === 'long') {
    timer.cycleDone = 0;
  }
  const to = nextMode();
  const auto = to === 'work' ? S().autoStartWork : S().autoStartBreaks;
  sendAll('complete', { from, to });
  setMode(to, auto);
  broadcastStats();
}

setInterval(() => {
  if (timer.running && Date.now() >= timer.endAt) complete();
  updateTrayTooltip();
}, 250);

function publicState() {
  const stats = computeStats(statsFile.data.sessions, S().dailyGoal);
  return {
    mode: timer.mode, modeLabel: MODE_LABEL[timer.mode],
    running: timer.running, endAt: timer.endAt, remaining: remainingMs(), duration: timer.duration,
    cycleDone: timer.cycleDone, cycleLength: S().cycleLength,
    task: S().task, todayCount: stats.today.count, todayMinutes: stats.today.minutes, goal: S().dailyGoal,
    fullscreen: fsWins.length > 0, clickThrough: S().clickThrough, now: Date.now()
  };
}

// ---------------------------------------------------------------- messaging
function allWins() { return [pill, settingsWin, ...fsWins].filter(w => w && !w.isDestroyed()); }
function sendAll(ch, payload) { for (const w of allWins()) w.webContents.send(ch, payload); }
function broadcastState() { sendAll('state', publicState()); rebuildMenus(); updateTrayTooltip(); }
function broadcastSettings() { sendAll('settings', publicSettings()); }
function broadcastStats() { sendAll('stats', computeStats(statsFile.data.sessions, S().dailyGoal)); }
function toast(text) { if (pill && !pill.isDestroyed()) pill.webContents.send('toast', text); }
function publicSettings() { return { ...S(), themes: THEMES, hotkeyErrors }; }

// ---------------------------------------------------------------- pill window
function defaultPillPos() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(wa.x + wa.width / 2 - (PILL_W * S().pillScale) / 2), y: wa.y + 12 };
}
function pillSize() { return { width: Math.round(PILL_W * S().pillScale), height: Math.round(PILL_H * S().pillScale) }; }
function clampToDisplay(pos, size) {
  const d = screen.getDisplayMatching({ x: pos.x, y: pos.y, width: size.width, height: size.height });
  const b = d.bounds;
  return {
    x: Math.min(Math.max(pos.x, b.x - 8), b.x + b.width - size.width + 8),
    y: Math.min(Math.max(pos.y, b.y - 8), b.y + b.height - size.height + 8)
  };
}
function createPill() {
  const size = pillSize();
  const pos = clampToDisplay(S().pillPos || defaultPillPos(), size);
  pill = new BrowserWindow({
    ...size, ...pos,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    backgroundColor: '#00000000', title: 'Pomodoro Pill',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.setOpacity(S().opacity);
  pill.loadFile(path.join(__dirname, 'renderer', 'pill.html'));
  pill.once('ready-to-show', () => { pill.showInactive(); applyClickThrough(); });
  pill.on('close', (e) => { if (!quitting) { e.preventDefault(); pill.hide(); } });
}
function resizePill() {
  if (!pill) return;
  const [x, y] = pill.getPosition();
  pill.setBounds({ x, y, ...pillSize() });
}
function applyClickThrough() {
  if (!pill) return;
  pill.setIgnoreMouseEvents(!!S().clickThrough);
}
function showPill() { if (fsWins.length) return; pill.showInactive(); pill.setAlwaysOnTop(true, 'screen-saver'); pill.moveTop(); }
function togglePill() {
  if (fsWins.length) return;
  if (pill.isVisible()) pill.hide(); else showPill();
  rebuildMenus();
}
function setOpacity(v) {
  v = Math.round(Math.min(1, Math.max(0.15, v)) * 100) / 100;
  S().opacity = v; settingsFile.save();
  if (pill) pill.setOpacity(v);
  toast(`Opacity ${Math.round(v * 100)}%`);
  broadcastSettings();
}

// Windows can drop TOPMOST when other topmost windows appear; re-assert it periodically.
setInterval(() => {
  if (pill && !pill.isDestroyed() && pill.isVisible() && !dragTimer) pill.setAlwaysOnTop(true, 'screen-saver');
  for (const w of fsWins) if (!w.isDestroyed()) w.setAlwaysOnTop(true, 'screen-saver');
}, 2500);

// ---------------------------------------------------------------- full screen
function enterFullscreen() {
  if (fsWins.length) { fsWins[0].focus(); return; }
  pillWasVisible = pill.isVisible();
  const pb = pill.getBounds();
  const mainDisplay = screen.getDisplayMatching(pb);
  const displays = S().coverAllMonitors ? screen.getAllDisplays() : [mainDisplay];
  const ordered = [mainDisplay, ...displays.filter(d => d.id !== mainDisplay.id)];
  ordered.forEach((d, i) => {
    const w = new BrowserWindow({
      ...d.bounds, frame: false, show: false, skipTaskbar: true, alwaysOnTop: true,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      backgroundColor: '#05080a', title: 'Pomodoro Pill — Full screen',
      webPreferences: { preload: path.join(__dirname, 'preload.js') }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(path.join(__dirname, 'renderer', 'fullscreen.html'), { query: { role: i === 0 ? 'main' : 'secondary' } });
    w.once('ready-to-show', () => {
      w.setBounds(d.bounds);
      w.show();
      w.setFullScreen(true);        // borderless, covers the taskbar
      if (i === 0) setTimeout(() => { w.focus(); w.moveTop(); }, 60);
    });
    w.on('closed', () => {
      fsWins = fsWins.filter(x => x !== w);
      if (!fsWins.length && !quitting) afterFullscreenExit();
    });
    fsWins.push(w);
  });
  pill.hide();
  broadcastState();
}
function exitFullscreen() {
  const wins = fsWins.slice();
  for (const w of wins) if (!w.isDestroyed()) w.close();
}
function afterFullscreenExit() {
  if (pillWasVisible) showPill();
  broadcastState();
}
function toggleFullscreen() { fsWins.length ? exitFullscreen() : enterFullscreen(); }

// ---------------------------------------------------------------- settings / stats window
function openSettings(tab = 'settings') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('open-tab', tab);
    settingsWin.show(); settingsWin.moveTop(); settingsWin.focus();
    return;
  }
  const wa = screen.getDisplayMatching(pill.getBounds()).workArea;
  const W = 900, H = 640;
  settingsWin = new BrowserWindow({
    width: W, height: H, minWidth: 760, minHeight: 540,
    x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + (wa.height - H) / 2),
    frame: false, show: false, backgroundColor: '#0d1214', title: 'Pomodoro Pill — Settings',
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  settingsWin.setAlwaysOnTop(true, 'screen-saver');
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: { tab } });
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.focus(); });
  settingsWin.on('closed', () => { settingsWin = null; registerHotkeys(); });
}

// ---------------------------------------------------------------- hotkeys
const HOTKEY_ACTIONS = {
  toggle: () => toggle(),
  skip: () => skip(),
  reset: () => reset(),
  fullscreen: () => toggleFullscreen(),
  showHide: () => togglePill(),
  clickThrough: () => toggleClickThrough(),
  opacityUp: () => setOpacity(S().opacity + 0.08),
  opacityDown: () => setOpacity(S().opacity - 0.08)
};
function registerHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyErrors = {};
  for (const [action, accel] of Object.entries(S().hotkeys)) {
    if (!accel || !HOTKEY_ACTIONS[action]) continue;
    let ok = false;
    try { ok = globalShortcut.register(accel, HOTKEY_ACTIONS[action]); } catch { ok = false; }
    if (!ok) hotkeyErrors[action] = accel;
  }
  return hotkeyErrors;
}
function toggleClickThrough() {
  S().clickThrough = !S().clickThrough; settingsFile.save();
  applyClickThrough();
  toast(S().clickThrough ? `Click-through ON · ${S().hotkeys.clickThrough || 'tray menu'} to undo` : 'Click-through OFF');
  broadcastSettings(); broadcastState();
}

// ---------------------------------------------------------------- tray + menus
function trayImage() {
  const p = path.join(__dirname, 'assets', process.platform === 'win32' ? 'tray.ico' : 'tray.png');
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}
function fmt(ms) {
  const t = Math.ceil(ms / 1000);
  const m = Math.floor(t / 60), s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
let lastTip = '';
function updateTrayTooltip() {
  if (!tray) return;
  const tip = `${MODE_LABEL[timer.mode]} ${fmt(remainingMs())}${timer.running ? '' : ' (paused)'} — Pomodoro Pill`;
  if (tip !== lastTip) { tray.setToolTip(tip); lastTip = tip; }
}
function buildMenu() {
  const s = S();
  const hk = (a) => s.hotkeys[a] || undefined;
  return Menu.buildFromTemplate([
    { label: timer.running ? 'Pause' : 'Start', accelerator: hk('toggle'), registerAccelerator: false, click: toggle },
    { label: 'Skip to next', accelerator: hk('skip'), registerAccelerator: false, click: skip },
    { label: 'Reset session', accelerator: hk('reset'), registerAccelerator: false, click: reset },
    { label: 'Switch to', submenu: [
      { label: 'Focus', type: 'radio', checked: timer.mode === 'work', click: () => setMode('work') },
      { label: 'Short break', type: 'radio', checked: timer.mode === 'short', click: () => setMode('short') },
      { label: 'Long break', type: 'radio', checked: timer.mode === 'long', click: () => setMode('long') }
    ] },
    { type: 'separator' },
    { label: fsWins.length ? 'Exit full screen' : 'Full screen', accelerator: hk('fullscreen'), registerAccelerator: false, click: toggleFullscreen },
    { label: pill && pill.isVisible() ? 'Hide timer' : 'Show timer', accelerator: hk('showHide'), registerAccelerator: false, click: togglePill, enabled: !fsWins.length },
    { label: 'Click-through', type: 'checkbox', checked: !!s.clickThrough, accelerator: hk('clickThrough'), registerAccelerator: false, click: toggleClickThrough },
    { label: 'Opacity', submenu: [1, 0.85, 0.7, 0.55, 0.4, 0.25].map(v => ({
      label: `${Math.round(v * 100)}%`, type: 'radio', checked: Math.abs(s.opacity - v) < 0.04, click: () => setOpacity(v)
    })) },
    { label: 'Theme', submenu: THEMES.map(t => ({
      label: t.name, type: 'radio', checked: s.theme === t.id,
      click: () => { s.theme = t.id; settingsFile.save(); broadcastSettings(); rebuildMenus(); }
    })) },
    { type: 'separator' },
    { label: 'Today’s stats…', click: () => openSettings('stats') },
    { label: 'Settings…', click: () => openSettings('settings') },
    { type: 'separator' },
    { label: 'Quit Pomodoro Pill', click: () => { quitting = true; app.quit(); } }
  ]);
}
let menuTimer = null;
function rebuildMenus() {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => { if (tray) tray.setContextMenu(buildMenu()); }, 50);
}
function createTray() {
  tray = new Tray(trayImage());
  tray.setContextMenu(buildMenu());
  tray.on('click', togglePill);
  tray.on('double-click', () => openSettings('stats'));
  updateTrayTooltip();
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('init', (e) => ({
  state: publicState(), settings: publicSettings(),
  stats: computeStats(statsFile.data.sessions, S().dailyGoal),
  platform: process.platform
}));

ipcMain.handle('update-settings', (e, patch) => {
  const s = S();
  const before = { ...s, hotkeys: { ...s.hotkeys } };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'hotkeys') s.hotkeys = { ...s.hotkeys, ...v };
    else if (k in DEFAULT_SETTINGS) s[k] = v;
  }
  // sanitize numbers
  s.workMin = clampNum(s.workMin, 1, 180, 25);
  s.shortMin = clampNum(s.shortMin, 1, 60, 5);
  s.longMin = clampNum(s.longMin, 1, 120, 15);
  s.cycleLength = clampNum(s.cycleLength, 1, 12, 4);
  s.dailyGoal = clampNum(s.dailyGoal, 1, 30, 8);
  s.pillScale = clampNum(s.pillScale, 0.7, 1.6, 1);
  settingsFile.save();

  // durations changed while session untouched → apply immediately
  const durKey = { work: 'workMin', short: 'shortMin', long: 'longMin' }[timer.mode];
  if (before[durKey] !== s[durKey] && !timer.running && timer.remaining === timer.duration) {
    timer.duration = durationFor(timer.mode); timer.remaining = timer.duration;
  }
  if (before.opacity !== s.opacity && pill) pill.setOpacity(s.opacity);
  if (before.pillScale !== s.pillScale) resizePill();
  if (before.clickThrough !== s.clickThrough) applyClickThrough();
  if (patch && patch.hotkeys) registerHotkeys();
  if (before.startWithWindows !== s.startWithWindows) applyLoginItem();
  broadcastSettings(); broadcastState(); broadcastStats();
  return publicSettings();
});

ipcMain.handle('get-stats', () => computeStats(statsFile.data.sessions, S().dailyGoal));
ipcMain.handle('reset-stats', () => { statsFile.data.sessions = []; statsFile.save(true); broadcastStats(); broadcastState(); return true; });
ipcMain.handle('suspend-hotkeys', (e, on) => { if (on) globalShortcut.unregisterAll(); else registerHotkeys(); return hotkeyErrors; });

ipcMain.on('action', (e, name, payload) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  switch (name) {
    case 'toggle': toggle(); break;
    case 'start': start(); break;
    case 'pause': pause(); break;
    case 'reset': reset(); break;
    case 'skip': skip(); break;
    case 'set-mode': setMode(payload); break;
    case 'fullscreen-enter': enterFullscreen(); break;
    case 'fullscreen-exit': exitFullscreen(); break;
    case 'fullscreen-toggle': toggleFullscreen(); break;
    case 'open-settings': openSettings(payload || 'settings'); break;
    case 'hide-pill': pill.hide(); rebuildMenus(); break;
    case 'quit': quitting = true; app.quit(); break;
    case 'nudge-opacity': setOpacity(S().opacity + Number(payload || 0)); break;
    case 'set-opacity': setOpacity(Number(payload)); break;
    case 'click-through': toggleClickThrough(); break;
    case 'set-task': {
      const t = String(payload || '').slice(0, 80).trim();
      S().task = t;
      if (t) S().recentTasks = [t, ...S().recentTasks.filter(x => x !== t)].slice(0, 8);
      settingsFile.save(); broadcastSettings(); broadcastState();
      break;
    }
    case 'pill-menu': buildMenu().popup({ window: pill }); break;
    case 'drag-start': startDrag(payload); break;
    case 'drag-end': endDrag(); break;
    case 'win-close': if (win) win.close(); break;
    case 'win-minimize': if (win) win.minimize(); break;
    case 'focus-self': if (win) win.focus(); break;
  }
});

function startDrag({ offsetX, offsetY }) {
  clearInterval(dragTimer);
  const size = pillSize();
  const started = Date.now();
  dragTimer = setInterval(() => {
    if (!pill || Date.now() - started > 20000) return endDrag();
    const p = screen.getCursorScreenPoint();
    pill.setBounds({ x: Math.round(p.x - offsetX), y: Math.round(p.y - offsetY), ...size });
  }, 12);
}
function endDrag() {
  if (!dragTimer) return;
  clearInterval(dragTimer); dragTimer = null;
  const b = pill.getBounds();
  const pos = clampToDisplay({ x: b.x, y: b.y }, { width: b.width, height: b.height });
  pill.setBounds({ ...pos, width: b.width, height: b.height });
  S().pillPos = pos; settingsFile.save();
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n * 100) / 100));
}
function applyLoginItem() {
  if (process.platform !== 'win32') return;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: !!S().startWithWindows, path: exe });
}

// ---------------------------------------------------------------- lifecycle
app.on('second-instance', () => { if (fsWins.length) fsWins[0].focus(); else showPill(); });

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  settingsFile = new JsonFile(path.join(dir, 'settings.json'), DEFAULT_SETTINGS);
  statsFile = new JsonFile(path.join(dir, 'stats.json'), { sessions: [] });
  // Keep the theme valid if a theme was renamed between versions
  if (!THEMES.some(t => t.id === S().theme)) S().theme = 'forest';
  timer.duration = durationFor('work');
  timer.remaining = timer.duration;

  createPill();
  createTray();
  registerHotkeys();
  if (Object.keys(hotkeyErrors).length) {
    setTimeout(() => toast(`Hotkey in use by another app: ${Object.values(hotkeyErrors).join(', ')}`), 1500);
  }
  applyLoginItem();

  screen.on('display-removed', () => {
    if (!pill) return;
    const b = pill.getBounds();
    const pos = clampToDisplay({ x: b.x, y: b.y }, b);
    pill.setBounds({ ...pos, width: b.width, height: b.height });
  });
  powerMonitor.on('resume', () => broadcastState());
});

app.on('window-all-closed', (e) => { /* stay alive in tray */ });
app.on('before-quit', () => { quitting = true; settingsFile && settingsFile.save(true); statsFile && statsFile.save(true); });
app.on('will-quit', () => globalShortcut.unregisterAll());

// Test hook (used only for automated screenshots during development)
if (process.env.POMO_TEST) require('./testhook')({ app, get pill() { return pill; }, get settingsWin() { return settingsWin; }, get fsWins() { return fsWins; }, openSettings, enterFullscreen, exitFullscreen, start, complete, timer, S });
