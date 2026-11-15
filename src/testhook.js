// Development-only: drives the app and saves screenshots. Not packaged.
const fs = require('fs');
const path = require('path');
module.exports = function (h) {
  const out = process.env.POMO_TEST_OUT || '/tmp/shots';
  fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const errors = [];
  const { app } = h;
  const dataDir = '/tmp/pomo-test-data';
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.mkdirSync(dataDir, { recursive: true });
  app.setPath('userData', dataDir);
  // seed 30 days of fake sessions for the stats screen
  const sessions = []; const tasks = ['Revision: OS scheduling', 'Writing the report', 'Reading papers', 'Side project'];
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(9, 0, 0, 0);
    const n = i > 12 && i % 5 === 0 ? 0 : Math.floor(2 + Math.random() * 8);
    for (let k = 0; k < n; k++) sessions.push({ d: key(d), t: d.getTime() + k * 1800e3, m: 25, task: tasks[(i + k) % 4] });
  }
  fs.writeFileSync(path.join(dataDir, 'stats.json'), JSON.stringify({ sessions }));
  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (...args) => {
      const ev = args[0];
      const level = ev.level ?? args[1]; const msg = ev.message ?? args[2];
      if (level === 'error' || level === 3 || /error/i.test(String(msg))) errors.push(String(msg));
      console.log('[renderer]', msg);
    });
    wc.on('render-process-gone', (_e, d) => errors.push('render gone ' + JSON.stringify(d)));
  });
  async function shot(win, name) {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
    console.log('shot', name, img.getSize());
  }
  const setS = (patch) => { Object.assign(h.S(), patch); };
  app.whenReady().then(async () => {
    await wait(2500);
    const { ipcMain, BrowserWindow } = require('electron');
    const sendSettings = () => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings', { ...h.S(), themes: [
      { id: 'forest', name: 'Forest Fireflies' }, { id: 'ocean', name: 'Ocean Dusk' }, { id: 'monsoon', name: 'Monsoon Rain' },
      { id: 'sakura', name: 'Sakura Drift' }, { id: 'aurora', name: 'Aurora Night' }, { id: 'snow', name: 'Snowfall' }, { id: 'meadow', name: 'Sunny Meadow' }], hotkeyErrors: {} }); };
    // pill in every theme
    h.S().task = 'Revision: OS scheduling';
    h.start();
    for (const t of ['forest', 'ocean', 'monsoon', 'sakura', 'aurora', 'snow', 'meadow']) {
      setS({ theme: t }); sendSettings(); await wait(900);
      await shot(h.pill, 'pill-' + t);
    }
    // hover state not capturable reliably; force controls visible
    await h.pill.webContents.executeJavaScript(`document.querySelector('#ctrls').style.opacity=1; document.querySelector('#dots').style.opacity=0; document.querySelector('#ctrls').style.transform='none'; document.querySelector('#sub').style.webkitMaskImage='linear-gradient(90deg, #000 35%, transparent 62%)';`);
    await wait(500);
    await shot(h.pill, 'pill-hover');
    await h.pill.webContents.executeJavaScript(`document.querySelector('#ctrls').style.opacity=''; document.querySelector('#dots').style.opacity='';`);

    // fullscreen in a few themes
    setS({ theme: 'forest' }); sendSettings();
    h.enterFullscreen();
    await wait(2500);
    for (const t of ['forest', 'ocean', 'monsoon', 'sakura', 'aurora', 'snow', 'meadow']) {
      setS({ theme: t }); sendSettings(); await wait(1200);
      await shot(h.fsWins[0], 'fs-' + t);
    }
    // simulate session complete to see banner
    h.timer.endAt = Date.now() - 1;
    await wait(900);
    await shot(h.fsWins[0], 'fs-after-complete');
    h.exitFullscreen();
    await wait(800);
    console.log('pill visible after exit:', h.pill.isVisible());

    // settings tabs
    setS({ theme: 'aurora' }); sendSettings();
    h.openSettings('timer'); await wait(2000);
    for (const tab of ['timer', 'appearance', 'hotkeys', 'stats', 'general']) {
      h.settingsWin.webContents.send('open-tab', tab); await wait(1200);
      await shot(h.settingsWin, 'settings-' + tab);
    }
    // ---- cycle logic test
    h.settingsWin.close(); await wait(300);
    Object.assign(h.S(), { autoStartBreaks: true, autoStartWork: false, cycleLength: 4 });
    h.timer.cycleDone = 0; h.timer.mode = 'work'; h.timer.running = false; h.timer.remaining = h.timer.duration = 25 * 60e3;
    const before = require('fs').readFileSync('/tmp/pomo-test-data/stats.json', 'utf8').length;
    const seq = [];
    for (let i = 0; i < 9; i++) {
      if (!h.timer.running) h.start();
      seq.push(h.timer.mode + (h.timer.running ? '' : '(paused)'));
      h.timer.endAt = Date.now() - 1; await wait(400);
    }
    seq.push(h.timer.mode + (h.timer.running ? '' : '(paused)'));
    console.log('SEQUENCE:', seq.join(' -> '));
    const st = JSON.parse(require('fs').readFileSync('/tmp/pomo-test-data/stats.json', 'utf8'));
    console.log('sessions today:', st.sessions.filter(x => x.d === new Date().toLocaleDateString('en-CA')).length);
    console.log('ERRORS:', JSON.stringify(errors));
    fs.writeFileSync(path.join(out, 'errors.json'), JSON.stringify(errors, null, 2));
    app.exit(0);
  });
};
