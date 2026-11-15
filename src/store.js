// Persistent settings + stats, stored as JSON in %APPDATA%\Pomodoro Pill
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  workMin: 25,
  shortMin: 5,
  longMin: 15,
  cycleLength: 4,          // pomodoros before a long break
  autoStartBreaks: true,
  autoStartWork: false,
  dailyGoal: 8,
  theme: 'forest',
  opacity: 0.92,
  pillScale: 1,
  animatePill: true,
  clickThrough: false,
  coverAllMonitors: true,
  hideCursorInFullscreen: true,
  startWithWindows: false,
  chime: false,
  pillPos: null,           // {x, y}
  task: '',
  recentTasks: [],
  hotkeys: {
    toggle: 'Ctrl+Alt+P',
    skip: 'Ctrl+Alt+S',
    reset: 'Ctrl+Alt+R',
    fullscreen: 'Ctrl+Alt+F',
    showHide: 'Ctrl+Alt+H',
    clickThrough: 'Ctrl+Alt+T',
    opacityUp: 'Ctrl+Alt+Up',
    opacityDown: 'Ctrl+Alt+Down'
  }
};

class JsonFile {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = this._load();
    this._timer = null;
  }
  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return deepMerge(structuredClone(this.defaults), raw);
    } catch {
      return structuredClone(this.defaults);
    }
  }
  save(immediate = false) {
    clearTimeout(this._timer);
    const write = () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
        fs.renameSync(tmp, this.file);
      } catch (e) { console.error('save failed', this.file, e); }
    };
    if (immediate) write(); else this._timer = setTimeout(write, 400);
  }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = deepMerge(base[k], over[k]);
    } else {
      base[k] = over[k];
    }
  }
  return base;
}

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeStats(sessions, dailyGoal) {
  const today = localDateKey();
  const byDay = new Map();
  for (const s of sessions) {
    const e = byDay.get(s.d) || { count: 0, minutes: 0 };
    e.count++; e.minutes += s.m;
    byDay.set(s.d, e);
  }
  const todaySessions = sessions.filter(s => s.d === today);
  const tasks = {};
  for (const s of todaySessions) {
    const k = s.task || '(no label)';
    tasks[k] = tasks[k] || { count: 0, minutes: 0 };
    tasks[k].count++; tasks[k].minutes += s.m;
  }
  // streak: consecutive days with >=1 pomodoro, ending today (or yesterday if today empty)
  let streak = 0;
  const cur = new Date();
  if (!byDay.has(today)) cur.setDate(cur.getDate() - 1);
  while (byDay.has(localDateKey(cur))) { streak++; cur.setDate(cur.getDate() - 1); }

  const last30 = [];
  const c = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(c); d.setDate(c.getDate() - i);
    const k = localDateKey(d);
    const e = byDay.get(k) || { count: 0, minutes: 0 };
    last30.push({ d: k, count: e.count, minutes: e.minutes });
  }
  let best = 0; for (const e of byDay.values()) best = Math.max(best, e.count);
  const totalMinutes = sessions.reduce((a, s) => a + s.m, 0);
  return {
    today: { count: todaySessions.length, minutes: todaySessions.reduce((a, s) => a + s.m, 0), goal: dailyGoal },
    tasks: Object.entries(tasks).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.minutes - a.minutes),
    streak, best, total: sessions.length, totalMinutes,
    last30,
    recent: sessions.slice(-12).reverse()
  };
}

module.exports = { JsonFile, DEFAULT_SETTINGS, localDateKey, computeStats };
