(async function () {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const init = await pomo.init();
  let settings = init.settings, stats = init.stats;

  // ---------- chrome
  $('wMin').innerHTML = ICONS.minus; $('wClose').innerHTML = ICONS.close;
  $('wMin').onclick = () => pomo.action('win-minimize');
  $('wClose').onclick = () => pomo.action('win-close');
  const NAV = { timer: ['Timer', ICONS.clock], appearance: ['Appearance', ICONS.palette], hotkeys: ['Hotkeys', ICONS.keyboard], stats: ['Stats', ICONS.chart], general: ['General', ICONS.power] };
  $$('nav button').forEach(b => { const [l, i] = NAV[b.dataset.tab]; b.innerHTML = `${i}<span>${l}</span>`; b.onclick = () => showTab(b.dataset.tab); });

  const tbScene = new NatureScene($('tbScene'), { theme: settings.theme, fps: 24, density: 0.5 });
  tbScene.start();

  let previews = [];
  function showTab(tab) {
    if (tab === 'settings') tab = 'timer';
    $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('section').forEach(s => s.classList.toggle('active', s.id === 'tab-' + tab));
    previews.forEach(p => (tab === 'appearance' ? p.start() : p.stop()));
    if (tab === 'stats') pomo.getStats().then(s => { stats = s; renderStats(); });
  }
  pomo.on('open-tab', showTab);

  // ---------- steppers
  $$('.stepper').forEach(el => {
    const key = el.dataset.key, min = +el.dataset.min, max = +el.dataset.max, unit = el.dataset.unit ?? 'min';
    el.innerHTML = `<button data-d="-1">−</button><input type="number" min="${min}" max="${max}"><span>${unit}</span><button data-d="1">+</button>`;
    const input = el.querySelector('input');
    const set = (v) => { v = Math.min(max, Math.max(min, Math.round(+v || min))); input.value = v; save({ [key]: v }); };
    el.querySelectorAll('button').forEach(b => b.onclick = () => set(+input.value + +b.dataset.d));
    input.addEventListener('change', () => set(input.value));
    input.addEventListener('wheel', (e) => { e.preventDefault(); set(+input.value + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    el._sync = () => { if (document.activeElement !== input) input.value = settings[key]; };
  });

  // ---------- switches
  $$('.switch input').forEach(inp => {
    inp.addEventListener('change', () => save({ [inp.dataset.key]: inp.checked }));
  });

  // ---------- ranges
  let rangeTimer;
  function bindRange(id, valId, key, toVal, fmt) {
    const r = $(id);
    r.addEventListener('input', () => {
      $(valId).textContent = fmt(+r.value);
      clearTimeout(rangeTimer);
      rangeTimer = setTimeout(() => save({ [key]: toVal(+r.value) }), 30);
    });
  }
  bindRange('opacity', 'opacityVal', 'opacity', v => v / 100, v => v + '%');
  bindRange('scale', 'scaleVal', 'pillScale', v => v / 100, v => v + '%');

  // ---------- themes
  const grid = $('themes');
  grid.innerHTML = settings.themes.map(t => {
    const p = NatureScene.palette(t.id);
    return `<div class="theme" data-id="${t.id}" tabindex="0"><canvas></canvas><div class="swatch"><i style="background:${p.accent}"></i><i style="background:${p.accentBreak}"></i></div><div class="name">${t.name}</div></div>`;
  }).join('');
  previews = $$('.theme').map(el => {
    const sc = new NatureScene(el.querySelector('canvas'), { theme: el.dataset.id, fps: 24, density: 0.6 });
    el.onclick = () => save({ theme: el.dataset.id });
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') save({ theme: el.dataset.id }); };
    return sc;
  });

  // ---------- hotkeys
  const HK = [
    ['toggle', 'Start / pause'], ['skip', 'Skip to next session'], ['reset', 'Reset current session'],
    ['fullscreen', 'Toggle full screen'], ['showHide', 'Show / hide the floating timer'], ['clickThrough', 'Toggle click-through'],
    ['opacityUp', 'Opacity up'], ['opacityDown', 'Opacity down']
  ];
  const DEFAULT_HK = { toggle: 'Ctrl+Alt+P', skip: 'Ctrl+Alt+S', reset: 'Ctrl+Alt+R', fullscreen: 'Ctrl+Alt+F', showHide: 'Ctrl+Alt+H', clickThrough: 'Ctrl+Alt+T', opacityUp: 'Ctrl+Alt+Up', opacityDown: 'Ctrl+Alt+Down' };
  $('hkList').innerHTML = HK.map(([k, l]) => `<div class="row"><div class="lbl"><div>${l}</div><div class="errtxt" id="err-${k}"></div></div><button class="hk" data-action="${k}"></button></div>`).join('');
  function renderAccel(a) {
    if (!a) return '<span class="none">Not set</span>';
    return a.split('+').map(k => `<kbd>${k === 'Up' ? '↑' : k === 'Down' ? '↓' : k === 'Left' ? '←' : k === 'Right' ? '→' : k === 'Super' ? 'Win' : U.esc(k)}</kbd>`).join('+');
  }
  function renderHotkeys() {
    $$('.hk').forEach(b => {
      if (b.classList.contains('capturing')) return;
      const a = b.dataset.action;
      b.innerHTML = renderAccel(settings.hotkeys[a]);
      const err = settings.hotkeyErrors && settings.hotkeyErrors[a];
      b.classList.toggle('err', !!err);
      $('err-' + a).textContent = err ? 'Another app already uses this shortcut — pick a different one.' : '';
    });
  }
  const CODE = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Backslash: '\\', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv' };
  function toAccel(e) {
    let key = null, m;
    if ((m = /^Key([A-Z])$/.exec(e.code))) key = m[1];
    else if ((m = /^Digit(\d)$/.exec(e.code))) key = m[1];
    else if ((m = /^Numpad(\d)$/.exec(e.code))) key = 'num' + m[1];
    else if ((m = /^F(\d{1,2})$/.exec(e.code))) key = 'F' + m[1];
    else if (CODE[e.code]) key = CODE[e.code];
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl'); if (e.altKey) mods.push('Alt'); if (e.shiftKey) mods.push('Shift'); if (e.metaKey) mods.push('Super');
    return { key, mods, accel: key ? [...mods, key].join('+') : null, isF: /^F\d+$/.test(key || '') };
  }
  let capturing = null;
  function stopCapture(newAccel) {
    if (!capturing) return;
    const b = capturing; capturing = null;
    b.classList.remove('capturing');
    if (newAccel !== undefined) {
      const hk = { ...settings.hotkeys };
      if (newAccel) for (const k of Object.keys(hk)) if (hk[k] === newAccel && k !== b.dataset.action) hk[k] = '';
      hk[b.dataset.action] = newAccel;
      save({ hotkeys: hk });
    } else {
      pomo.suspendHotkeys(false);
    }
    renderHotkeys();
  }
  $$('.hk').forEach(b => {
    b.onclick = () => {
      if (capturing === b) return;
      if (capturing) stopCapture();
      capturing = b; b.classList.add('capturing'); b.innerHTML = 'Press keys…';
      pomo.suspendHotkeys(true);
    };
    b.addEventListener('blur', () => { if (capturing === b) stopCapture(); });
    b.addEventListener('keydown', (e) => {
      if (capturing !== b) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') return stopCapture();
      if ((e.key === 'Backspace') && !e.ctrlKey && !e.altKey) return stopCapture('');
      const r = toAccel(e);
      if (!r.key) { b.innerHTML = r.mods.length ? renderAccel(r.mods.join('+')) + '<span class="none">+…</span>' : 'Press keys…'; return; }
      if (!r.mods.length && !r.isF) { b.innerHTML = '<span class="none">Add Ctrl, Alt, Shift or Win</span>'; return; }
      stopCapture(r.accel);
    });
  });
  $('hkDefaults').onclick = () => save({ hotkeys: DEFAULT_HK });

  // ---------- stats
  function renderStats() {
    const s = stats, t = s.today;
    $('kToday').innerHTML = `${t.count}<small> / ${t.goal}</small>`;
    $('kTodayK').innerHTML = `${ICONS.target} Pomodoros today`;
    $('kGoal').style.width = Math.min(100, (t.count / t.goal) * 100) + '%';
    $('kMin').textContent = U.fmtMinutes(t.minutes);
    $('kMinK').innerHTML = `${ICONS.clock} Focused today`;
    $('kStreak').innerHTML = `${s.streak}<small> day${s.streak === 1 ? '' : 's'}</small>`;
    $('kStreakK').innerHTML = `${ICONS.flame} Current streak`;
    $('kTotal').textContent = s.total;
    $('kTotalK').innerHTML = `${ICONS.leaf} All time (${U.fmtMinutes(s.totalMinutes)})`;
    const max = Math.max(1, ...s.last30.map(d => d.count));
    $('chart').innerHTML = s.last30.map((d, i) => {
      const dt = new Date(d.d + 'T12:00:00');
      const label = dt.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
      return `<div class="bar ${i === 29 ? 'today' : ''}"><i style="height:${(d.count / max) * 100}%"></i><span class="tip">${label}: ${d.count} · ${U.fmtMinutes(d.minutes)}</span></div>`;
    }).join('');
    const fmtD = (k) => new Date(k + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' });
    $('ax0').textContent = fmtD(s.last30[0].d); $('ax1').textContent = fmtD(s.last30[15].d);
    const tmax = Math.max(1, ...s.tasks.map(x => x.minutes));
    $('taskList').innerHTML = s.tasks.length ? s.tasks.map(x => `<div class="item"><span class="n">${U.esc(x.name)}</span><span class="meter"><i style="width:${(x.minutes / tmax) * 100}%"></i></span><span class="m">${x.count} · ${U.fmtMinutes(x.minutes)}</span></div>`).join('')
      : '<div class="empty">No pomodoros yet today. Your first one is the hardest — go!</div>';
    $('recentList').innerHTML = s.recent.length ? s.recent.map(x => {
      const d = new Date(x.t);
      return `<div class="item"><span class="m">${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><span class="n">${U.esc(x.task || '(no label)')}</span><span class="m">${x.m}m</span></div>`;
    }).join('') : '<div class="empty">Completed sessions will show up here.</div>';
  }
  let armTimer;
  $('resetStats').onclick = async () => {
    const b = $('resetStats');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed'); b.textContent = 'Click again to erase everything';
      clearTimeout(armTimer); armTimer = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Reset all stats'; }, 4000);
      return;
    }
    await pomo.resetStats();
    b.classList.remove('armed'); b.textContent = 'Reset all stats';
  };
  $('quitBtn').onclick = () => pomo.action('quit');

  // ---------- sync from settings
  async function save(patch) { settings = await pomo.updateSettings(patch); syncAll(); }
  function syncAll() {
    U.applyPalette(settings.theme, 'work');
    tbScene.setTheme(settings.theme);
    $$('.stepper').forEach(el => el._sync());
    $$('.switch input').forEach(inp => { inp.checked = !!settings[inp.dataset.key]; });
    if (document.activeElement !== $('opacity')) { $('opacity').value = Math.round(settings.opacity * 100); $('opacityVal').textContent = Math.round(settings.opacity * 100) + '%'; }
    if (document.activeElement !== $('scale')) { $('scale').value = Math.round(settings.pillScale * 100); $('scaleVal').textContent = Math.round(settings.pillScale * 100) + '%'; }
    $$('.theme').forEach(el => el.classList.toggle('active', el.dataset.id === settings.theme));
    renderHotkeys();
  }
  pomo.on('settings', (s) => { settings = s; syncAll(); });
  pomo.on('stats', (s) => { stats = s; renderStats(); });

  syncAll();
  renderStats();
  showTab(new URLSearchParams(location.search).get('tab') || 'timer');
})();
