// Helpers shared by all renderer windows
window.U = {
  remaining(st) {
    if (!st) return 0;
    return st.running ? Math.max(0, st.endAt - Date.now()) : st.remaining;
  },
  fmt(ms) {
    const t = Math.ceil(ms / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  },
  fmtMinutes(min) {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  },
  applyPalette(themeId, mode, el = document.documentElement) {
    const p = NatureScene.palette(themeId);
    el.style.setProperty('--accent', mode && mode !== 'work' ? p.accentBreak : p.accent);
    el.style.setProperty('--accent-work', p.accent);
    el.style.setProperty('--accent-break', p.accentBreak);
    el.style.setProperty('--text', p.text);
    el.style.setProperty('--sub', p.sub);
    el.style.setProperty('--shade', p.shade);
    el.classList.toggle('light', !!p.light);
    return p;
  },
  chime() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const now = ac.currentTime;
      [[880, 0], [1318.5, 0.18], [1760, 0.36]].forEach(([f, d]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + d);
        g.gain.exponentialRampToValueAtTime(0.18, now + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + d + 1.6);
        o.connect(g).connect(ac.destination); o.start(now + d); o.stop(now + d + 1.7);
      });
      setTimeout(() => ac.close(), 2600);
    } catch (e) { /* audio unavailable */ }
  },
  esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
};
