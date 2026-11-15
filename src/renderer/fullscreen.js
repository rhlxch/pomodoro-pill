(async function () {
  const $ = (id) => document.getElementById(id);
  const role = new URLSearchParams(location.search).get('role') || 'main';
  const isMain = role === 'main';
  document.body.classList.toggle('secondary', !isMain);

  const R = 96, CIRC = 2 * Math.PI * R;
  const arc = $('arc'), knob = $('knob');
  arc.style.strokeDasharray = CIRC;

  $('bReset').innerHTML = ICONS.reset; $('bSkip').innerHTML = ICONS.skip;
  $('bPrev').innerHTML = ICONS.left; $('bNext').innerHTML = ICONS.right;
  $('bSettings').innerHTML = ICONS.gear; $('bExit').innerHTML = ICONS.shrink;

  const init = await pomo.init();
  let state = init.state, settings = init.settings, stats = init.stats;
  const themes = settings.themes;

  const scene = new NatureScene($('scene'), { theme: settings.theme, fps: isMain ? 60 : 30, density: isMain ? 1 : 0.6 });
  scene.start();

  function applySettings() {
    U.applyPalette(settings.theme, state.mode);
    scene.setTheme(settings.theme);
    const t = themes.find(x => x.id === settings.theme);
    $('themeName').textContent = t ? t.name : settings.theme;
    document.body.classList.toggle('hidecursor', settings.hideCursorInFullscreen !== false);
    $('recent').innerHTML = (settings.recentTasks || []).map(t => `<option value="${U.esc(t)}">`).join('');
  }

  function renderState() {
    U.applyPalette(settings.theme, state.mode);
    $('bToggle').innerHTML = state.running ? ICONS.pause : ICONS.play;
    $('modeText').textContent = state.modeLabel;
    $('modeIcon').innerHTML = state.mode === 'work' ? ICONS.leaf : ICONS.cup;
    const task = (state.task || '').trim();
    const taskEl = $('task');
    taskEl.textContent = task || (state.mode === 'work' ? 'What are you focusing on?' : 'Breathe. Stretch. Look far away.');
    taskEl.classList.toggle('empty', !task);
    const n = Math.min(state.cycleLength, 12);
    const done = state.mode === 'long' && state.cycleDone > 0 && state.cycleDone % state.cycleLength === 0 ? n : state.cycleDone % state.cycleLength;
    $('dots').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
    renderStats();
    tick();
  }

  function renderStats() {
    const today = stats.today;
    $('cToday').innerHTML = `${ICONS.target}<b>${today.count}</b> / ${today.goal} today`;
    $('cMinutes').innerHTML = `${ICONS.clock}<b>${U.fmtMinutes(today.minutes)}</b> focused`;
    $('cStreak').innerHTML = `${ICONS.flame}<b>${stats.streak}</b> day streak`;
  }

  let lastText = '';
  function tick() {
    const rem = U.remaining(state);
    const txt = U.fmt(rem);
    if (txt !== lastText) { $('time').textContent = txt; $('mini').textContent = txt; lastText = txt; document.title = `${txt} · ${state.modeLabel}`; }
    const p = state.duration ? Math.min(1, Math.max(0, 1 - rem / state.duration)) : 0;
    arc.style.strokeDashoffset = CIRC * (1 - p);
    const a = p * Math.PI * 2;
    knob.setAttribute('cx', 100 + R * Math.cos(a)); knob.setAttribute('cy', 100 + R * Math.sin(a));
  }
  (function raf() { tick(); requestAnimationFrame(raf); })();

  function clock() {
    const d = new Date();
    $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('date').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }
  clock(); setInterval(clock, 5000);

  pomo.on('state', (s) => { state = s; renderState(); });
  pomo.on('settings', (s) => { settings = s; applySettings(); renderState(); });
  pomo.on('stats', (s) => { stats = s; renderStats(); });
  pomo.on('complete', ({ from, to }) => {
    if (!isMain) return;
    const msg = from === 'work'
      ? (to === 'long' ? 'Cycle complete — enjoy a long break' : 'Nice focus — time for a short break')
      : 'Break over — ready to focus?';
    const b = $('banner'); b.textContent = msg; b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), 5000);
    wake();
    if (settings.chime) U.chime();
  });

  // ---- controls
  $('bToggle').onclick = () => pomo.action('toggle');
  $('bReset').onclick = () => pomo.action('reset');
  $('bSkip').onclick = () => pomo.action('skip');
  $('bExit').onclick = () => pomo.action('fullscreen-exit');
  $('bSettings').onclick = () => pomo.action('open-settings', 'settings');
  function cycleTheme(dir) {
    const i = themes.findIndex(t => t.id === settings.theme);
    const next = themes[(i + dir + themes.length) % themes.length];
    pomo.updateSettings({ theme: next.id });
  }
  $('bPrev').onclick = () => cycleTheme(-1);
  $('bNext').onclick = () => cycleTheme(1);

  // ---- task editing
  const input = $('taskInput');
  function editTask() {
    document.body.classList.add('editing');
    input.value = state.task || '';
    setTimeout(() => { input.focus(); input.select(); }, 20);
  }
  function commitTask(save) {
    if (!document.body.classList.contains('editing')) return;
    document.body.classList.remove('editing');
    if (save) pomo.action('set-task', input.value);
  }
  $('task').onclick = editTask;
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitTask(true);
    if (e.key === 'Escape') commitTask(false);
  });
  input.addEventListener('blur', () => commitTask(true));

  // ---- keyboard
  window.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('editing')) return;
    wake();
    switch (e.key) {
      case 'Escape': pomo.action('fullscreen-exit'); break;
      case ' ': e.preventDefault(); pomo.action('toggle'); break;
      case 's': case 'S': pomo.action('skip'); break;
      case 'r': case 'R': pomo.action('reset'); break;
      case 't': case 'T': if (isMain) { e.preventDefault(); editTask(); } break;
      case 'ArrowLeft': cycleTheme(-1); break;
      case 'ArrowRight': cycleTheme(1); break;
    }
  });
  if (!isMain) document.addEventListener('click', () => pomo.action('focus-self'));

  // ---- idle: hide controls and cursor after 3 s without mouse movement
  let idleTimer;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!document.body.classList.contains('editing')) document.body.classList.add('idle'); }, 3000);
  }
  let lastMove = '';
  window.addEventListener('mousemove', (e) => { const k = e.screenX + ',' + e.screenY; if (k !== lastMove) { lastMove = k; wake(); } });
  window.addEventListener('mousedown', wake);
  wake();

  applySettings();
  renderState();
})();
