(async function () {
  const $ = (id) => document.getElementById(id);
  const pillEl = $('pill'), timeEl = $('time'), subEl = $('sub'), arc = $('arc');
  const CIRC = 2 * Math.PI * 22;
  arc.style.strokeDasharray = CIRC;

  $('bSkip').innerHTML = ICONS.skip;
  $('bFull').innerHTML = ICONS.expand;
  $('bMore').innerHTML = ICONS.more;
  $('ghost').innerHTML = ICONS.ghost;

  const init = await pomo.init();
  let state = init.state, settings = init.settings;

  const scene = new NatureScene($('scene'), { theme: settings.theme, fps: 24, density: 1 });

  function applySettings() {
    document.documentElement.style.setProperty('--scale', settings.pillScale || 1);
    U.applyPalette(settings.theme, state.mode);
    scene.setTheme(settings.theme);
    if (settings.animatePill) scene.start(); else { scene.stop(); scene.renderOnce(); }
    document.body.classList.toggle('clickthrough', !!settings.clickThrough);
    $('recent').innerHTML = (settings.recentTasks || []).map(t => `<option value="${U.esc(t)}">`).join('');
  }

  function renderState() {
    U.applyPalette(settings.theme, state.mode);
    $('playIcon').innerHTML = state.running ? ICONS.pause : ICONS.play;
    document.body.classList.toggle('paused', !state.running);
    const task = (state.task || '').trim();
    subEl.innerHTML = `<b>${state.modeLabel}</b>${task ? ' · ' + U.esc(task) : (state.mode === 'work' ? ' · <span style="opacity:.7">click to add a task</span>' : '')}`;
    // cycle dots: filled = completed focus sessions in this cycle
    const n = state.cycleLength, done = state.cycleDone % n === 0 && state.cycleDone > 0 && state.mode === 'long' ? n : state.cycleDone % n;
    const dots = n <= 8 ? n : 8;
    $('dots').innerHTML = Array.from({ length: dots }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
    tick();
  }

  let lastText = '';
  function tick() {
    const rem = U.remaining(state);
    const txt = U.fmt(rem);
    if (txt !== lastText) { timeEl.textContent = txt; lastText = txt; }
    const p = state.duration ? 1 - rem / state.duration : 0;
    arc.style.strokeDashoffset = CIRC * (1 - p);
  }
  setInterval(tick, 200);

  pomo.on('state', (s) => { state = s; renderState(); });
  pomo.on('settings', (s) => { settings = s; applySettings(); renderState(); });
  pomo.on('complete', () => {
    pillEl.classList.remove('pulse'); void pillEl.offsetWidth; pillEl.classList.add('pulse');
    if (settings.chime) U.chime();
  });
  let toastTimer;
  pomo.on('toast', (text) => {
    const t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  });

  // ---- buttons
  $('ring').addEventListener('click', (e) => { e.stopPropagation(); pomo.action('toggle'); });
  $('bSkip').addEventListener('click', (e) => { e.stopPropagation(); pomo.action('skip'); });
  $('bFull').addEventListener('click', (e) => { e.stopPropagation(); pomo.action('fullscreen-enter'); });
  $('bMore').addEventListener('click', (e) => { e.stopPropagation(); pomo.action('pill-menu'); });
  pillEl.addEventListener('contextmenu', (e) => { e.preventDefault(); pomo.action('pill-menu'); });
  timeEl.addEventListener('dblclick', () => pomo.action('fullscreen-enter'));

  // ---- task editing
  const input = $('taskInput');
  subEl.addEventListener('click', (e) => {
    e.stopPropagation();
    pomo.action('focus-self');
    document.body.classList.add('editing');
    input.value = state.task || '';
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
  function commitTask(save) {
    if (!document.body.classList.contains('editing')) return;
    document.body.classList.remove('editing');
    if (save) pomo.action('set-task', input.value);
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitTask(true);
    if (e.key === 'Escape') commitTask(false);
  });
  input.addEventListener('blur', () => commitTask(true));
  input.addEventListener('pointerdown', (e) => e.stopPropagation());

  // ---- opacity with mouse wheel
  let wheelAcc = 0;
  pillEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) >= 60) { pomo.action('nudge-opacity', wheelAcc < 0 ? 0.05 : -0.05); wheelAcc = 0; }
  }, { passive: false });

  // ---- dragging (main process follows the cursor; renderer only reports start/end)
  let down = null, dragging = false;
  pillEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || document.body.classList.contains('editing')) return;
    down = { x: e.screenX, y: e.screenY, ox: e.screenX - window.screenX, oy: e.screenY - window.screenY, id: e.pointerId };
  });
  pillEl.addEventListener('pointermove', (e) => {
    if (!down || dragging) return;
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      dragging = true; pillEl.classList.add('dragging');
      try { pillEl.setPointerCapture(down.id); } catch {}
      pomo.action('drag-start', { offsetX: down.ox, offsetY: down.oy });
    }
  });
  function endDrag(e) {
    if (dragging) pomo.action('drag-end');
    dragging = false; down = null; pillEl.classList.remove('dragging');
  }
  pillEl.addEventListener('pointerup', endDrag);
  pillEl.addEventListener('lostpointercapture', endDrag);
  window.addEventListener('blur', () => { if (dragging) endDrag(); });

  applySettings();
  renderState();
})();
