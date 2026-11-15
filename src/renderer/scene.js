// Animated nature scenes drawn on a <canvas>. Shared by the pill, full screen and settings previews.
// Usage: const s = new NatureScene(canvas, { theme: 'forest', fps: 30, density: 1 }); s.start();
(function () {
  'use strict';

  const PALETTES = {
    forest:  { name: 'Forest Fireflies', accent: '#b8f27c', accentBreak: '#7fd6ff', text: '#effff2', sub: '#b9d8c4', light: false, shade: 'rgba(3,14,12,0.45)' },
    ocean:   { name: 'Ocean Dusk',       accent: '#ffb26b', accentBreak: '#86e6ff', text: '#fff6ee', sub: '#ffd9c2', light: false, shade: 'rgba(20,16,36,0.42)' },
    monsoon: { name: 'Monsoon Rain',     accent: '#8fd3ff', accentBreak: '#b6f5c8', text: '#eaf4ff', sub: '#a9bfd4', light: false, shade: 'rgba(8,14,22,0.40)' },
    sakura:  { name: 'Sakura Drift',     accent: '#d9466f', accentBreak: '#3f9c92', text: '#47202f', sub: '#86566a', light: true,  shade: 'rgba(255,240,245,0.50)' },
    aurora:  { name: 'Aurora Night',     accent: '#6dffb3', accentBreak: '#c0a8ff', text: '#ecfff7', sub: '#a9c9d6', light: false, shade: 'rgba(2,6,14,0.40)' },
    snow:    { name: 'Snowfall',         accent: '#cfe9ff', accentBreak: '#ffd59e', text: '#f6faff', sub: '#dbe6f5', light: false, shade: 'rgba(14,24,46,0.55)' },
    meadow:  { name: 'Sunny Meadow',     accent: '#ffd84d', accentBreak: '#ff9fb2', text: '#ffffff', sub: '#eefaff', light: false, shade: 'rgba(16,60,90,0.38)' }
  };

  // ---------- helpers
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = Math.random;
  const rand = (a, b) => a + R() * (b - a);
  const TAU = Math.PI * 2;

  const glowCache = new Map();
  function glow(color, size = 64) {
    const key = color + size;
    if (glowCache.has(key)) return glowCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, color); gr.addColorStop(0.18, color);
    gr.addColorStop(0.45, hexA(color, 0.35)); gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    glowCache.set(key, c);
    return c;
  }
  function hexA(hex, a) {
    if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function vgrad(ctx, h, stops, y0 = 0) {
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  }
  function offscreen(w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * dpr)); c.height = Math.max(1, Math.ceil(h * dpr));
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    return { c, g };
  }
  // Ridge line (mountains / hills): smooth random heights
  function ridge(g, w, h, baseY, amp, seed, color, roughness = 6, tileable = true) {
    const r = rng(seed);
    const n = roughness + 2;
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(baseY - r() * amp);
    if (tileable) pts[n] = pts[0];
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, h);
    g.lineTo(0, pts[0]);
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w, x1 = ((i + 1) / n) * w;
      const xm = (x0 + x1) / 2;
      g.quadraticCurveTo(x0 + (x1 - x0) * 0.25, pts[i], xm, (pts[i] + pts[i + 1]) / 2);
      g.quadraticCurveTo(x0 + (x1 - x0) * 0.75, pts[i + 1], x1, pts[i + 1]);
    }
    g.lineTo(w, h); g.closePath(); g.fill();
  }
  function pine(g, x, baseY, height, color) {
    const w = height * 0.36;
    g.fillStyle = color;
    g.beginPath();
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const ty = baseY - height * (i / tiers) * 0.85;
      const tw = w * (1 - i / (tiers + 0.6));
      g.moveTo(x - tw, ty);
      g.lineTo(x, ty - height * 0.42);
      g.lineTo(x + tw, ty);
    }
    g.fill();
    g.fillRect(x - height * 0.025, baseY - 2, height * 0.05, height * 0.1 + 2);
  }
  // Pine that wraps around the tile edges so scrolling layers stay seamless
  function pineW(g, lw, x, baseY, height, color) {
    pine(g, x, baseY, height, color);
    if (x < height) pine(g, x + lw, baseY, height, color);
    if (x > lw - height) pine(g, x - lw, baseY, height, color);
  }
  // Draw an offscreen layer scrolled horizontally (seamless tile)
  function drawScroll(ctx, layer, offset, w, y = 0) {
    const ow = layer.c.width / layer.dpr;
    const oh = layer.c.height / layer.dpr;
    let x = -((offset % ow) + ow) % ow;
    for (; x < w; x += ow) ctx.drawImage(layer.c, x, y, ow, oh);
  }
  function makeLayer(w, h, dpr, painter) {
    const o = offscreen(w, h, dpr);
    painter(o.g, w, h);
    return { c: o.c, dpr };
  }

  // ---------- themes
  const THEMES = {};

  // 1. Forest with fireflies
  THEMES.forest = {
    init(s) {
      const { w, h, dpr } = s;
      s.bg = null;
      s.layers = [
        { speed: 2, layer: makeLayer(w * 1.5, h, dpr, (g, lw, lh) => {
          ridge(g, lw, lh, lh * 0.62, lh * 0.12, 11, '#0f3b36', 5);
          const r = rng(5);
          for (let x = 0; x < lw; x += lh * 0.05 + r() * lh * 0.05) pineW(g, lw, x, lh * 0.66 - r() * lh * 0.06, lh * (0.16 + r() * 0.1), '#0f3b36');
        }) },
        { speed: 5, layer: makeLayer(w * 1.5, h, dpr, (g, lw, lh) => {
          ridge(g, lw, lh, lh * 0.76, lh * 0.08, 23, '#0a2b27', 4);
          const r = rng(9);
          for (let x = 0; x < lw; x += lh * 0.07 + r() * lh * 0.07) pineW(g, lw, x, lh * 0.8 - r() * lh * 0.04, lh * (0.22 + r() * 0.14), '#0a2b27');
        }) },
        { speed: 9, layer: makeLayer(w * 1.5, h, dpr, (g, lw, lh) => {
          ridge(g, lw, lh, lh * 0.92, lh * 0.06, 37, '#04171a', 4);
          const r = rng(17);
          for (let x = 0; x < lw; x += lh * 0.12 + r() * lh * 0.12) pineW(g, lw, x, lh * 0.97, lh * (0.32 + r() * 0.2), '#04171a');
        }) }
      ];
      const n = Math.round(s.count(40, 6));
      s.flies = Array.from({ length: n }, () => ({
        x: R() * w, y: h * rand(0.35, 0.98), vx: rand(-8, 8), vy: rand(-6, 6),
        ph: R() * TAU, sp: rand(0.6, 1.6), size: rand(0.6, 1.2) * s.unit, seed: R() * 100
      }));
    },
    draw(ctx, s, t, dt) {
      const { w, h } = s;
      if (!s.bg) s.bg = vgrad(ctx, h, [[0, '#06141c'], [0.45, '#0b2a2e'], [1, '#0e3a30']]);
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h);
      // moon glow
      ctx.globalAlpha = 0.55;
      const m = glow('#d8f4ff', 128);
      const mr = Math.max(w, h) * 0.22;
      ctx.drawImage(m, w * 0.78 - mr, h * 0.16 - mr, mr * 2, mr * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e9fbff';
      ctx.beginPath(); ctx.arc(w * 0.78, h * 0.16, Math.max(3, s.unit * 9), 0, TAU); ctx.fill();
      s.layers.forEach((L, i) => {
        drawScroll(ctx, L.layer, t * L.speed * s.unit * 0.25, w);
        if (i === 1) { // drifting fog between layers
          const fy = h * 0.72 + Math.sin(t * 0.1) * h * 0.02;
          ctx.fillStyle = vgrad(ctx, h * 0.2, [[0, 'rgba(160,220,200,0)'], [0.5, 'rgba(160,220,200,0.08)'], [1, 'rgba(160,220,200,0)']], fy);
          ctx.fillRect(0, fy, w, h * 0.2);
        }
      });
      ctx.globalCompositeOperation = 'lighter';
      const sprite = glow('#e4ff8a', 64);
      for (const f of s.flies) {
        f.vx += Math.sin(t * 0.7 + f.seed) * 6 * dt; f.vy += Math.cos(t * 0.9 + f.seed * 1.3) * 6 * dt;
        f.vx *= 0.99; f.vy *= 0.99;
        f.x += f.vx * dt * s.unit * 0.5; f.y += f.vy * dt * s.unit * 0.5;
        if (f.x < -20) f.x = w + 20; if (f.x > w + 20) f.x = -20;
        if (f.y < h * 0.3) f.vy += 4 * dt * 10; if (f.y > h) f.vy -= 4 * dt * 10;
        const b = Math.max(0, Math.sin(t * f.sp + f.ph));
        const a = 0.15 + 0.85 * b * b;
        const r = (8 + 10 * b) * f.size;
        ctx.globalAlpha = a;
        ctx.drawImage(sprite, f.x - r, f.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  // 2. Ocean at dusk
  THEMES.ocean = {
    init(s) {
      const { w, h } = s;
      s.bg = null;
      s.waves = [
        { y: 0.60, amp: 0.010, len: 0.9, sp: 0.25, c1: '#5b4a7a', c2: '#3c3a66' },
        { y: 0.67, amp: 0.014, len: 0.7, sp: 0.35, c1: '#3d4c80', c2: '#2a3766' },
        { y: 0.76, amp: 0.020, len: 0.55, sp: 0.5, c1: '#25407a', c2: '#1a2c5c' },
        { y: 0.87, amp: 0.026, len: 0.42, sp: 0.7, c1: '#163262', c2: '#0e1f44' }
      ];
      s.sparks = Array.from({ length: Math.round(s.count(60, 8)) }, () => ({ x: R() * w, y: h * rand(0.6, 1), ph: R() * TAU, sp: rand(1, 3) }));
      s.birds = Array.from({ length: s.small ? 0 : 3 }, (_, i) => ({ x: R() * w, y: h * rand(0.15, 0.35), sp: rand(10, 18), ph: R() * TAU, sc: rand(0.7, 1.2) }));
    },
    draw(ctx, s, t, dt) {
      const { w, h, unit } = s;
      if (!s.bg) s.bg = vgrad(ctx, h * 0.62, [[0, '#1f2350'], [0.45, '#7a4a78'], [0.8, '#e07b6a'], [1, '#ffbf7a']]);
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h);
      // sun
      const sx = w * 0.5, sy = h * 0.6, sr = Math.max(6, Math.min(w, h * 2) * 0.06);
      ctx.globalAlpha = 0.7; const gs = glow('#ffd29a', 128);
      ctx.drawImage(gs, sx - sr * 5, sy - sr * 5, sr * 10, sr * 10); ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffe2b0'; ctx.beginPath(); ctx.arc(sx, sy, sr, Math.PI, 0); ctx.fill();
      // birds
      ctx.strokeStyle = 'rgba(40,24,50,0.7)'; ctx.lineWidth = Math.max(1, unit * 1.4); ctx.lineCap = 'round';
      for (const b of s.birds) {
        b.x += b.sp * dt * unit * 0.4; if (b.x > w + 40) b.x = -40;
        const f = Math.sin(t * 6 + b.ph) * 4 * unit * b.sc, bw = 8 * unit * b.sc;
        ctx.beginPath(); ctx.moveTo(b.x - bw, b.y + f * 0.4); ctx.quadraticCurveTo(b.x - bw / 2, b.y - f, b.x, b.y);
        ctx.quadraticCurveTo(b.x + bw / 2, b.y - f, b.x + bw, b.y + f * 0.4); ctx.stroke();
      }
      // waves
      const step = Math.max(4, w / 120);
      for (const wv of s.waves) {
        const base = h * wv.y;
        ctx.fillStyle = vgrad(ctx, h - base, [[0, wv.c1], [1, wv.c2]], base);
        ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w + step; x += step) {
          const k = x / (w * wv.len);
          const y = base + Math.sin(k * TAU + t * wv.sp) * h * wv.amp + Math.sin(k * TAU * 2.3 - t * wv.sp * 1.4) * h * wv.amp * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      }
      // sun reflection + sparkles
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const yy = h * 0.62 + i * h * 0.026;
        const ww = sr * (2.6 - i * 0.12) * (0.75 + 0.25 * Math.sin(t * 2 + i));
        ctx.fillStyle = `rgba(255,200,140,${0.22 - i * 0.013})`;
        ctx.fillRect(sx - ww / 2 + Math.sin(t * 1.3 + i * 1.7) * sr * 0.3, yy, ww, Math.max(1, h * 0.006));
      }
      const sp = glow('#ffe7c4', 32);
      for (const p of s.sparks) {
        const a = Math.max(0, Math.sin(t * p.sp + p.ph));
        if (a < 0.05) continue;
        ctx.globalAlpha = a * 0.8; const r = 3 * unit * a + 1;
        ctx.drawImage(sp, p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };

  // 3. Monsoon rain over misty hills
  THEMES.monsoon = {
    init(s) {
      const { w, h, dpr } = s;
      s.bg = null;
      s.hills = makeLayer(w * 1.6, h, dpr, (g, lw, lh) => {
        ridge(g, lw, lh, lh * 0.58, lh * 0.16, 41, 'rgba(70,92,110,0.75)', 6);
        ridge(g, lw, lh, lh * 0.72, lh * 0.12, 43, 'rgba(46,66,80,0.9)', 5);
        ridge(g, lw, lh, lh * 0.88, lh * 0.08, 47, '#17242e', 4);
      });
      const n = Math.round(s.count(260, 30));
      s.drops = Array.from({ length: n }, () => newDrop(s, true));
      s.ripples = [];
    },
    draw(ctx, s, t, dt) {
      const { w, h, unit } = s;
      if (!s.bg) s.bg = vgrad(ctx, h, [[0, '#24303d'], [0.55, '#3d5162'], [1, '#2a3a46']]);
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h);
      drawScroll(ctx, s.hills, t * 1.2 * unit, w);
      // mist
      for (let i = 0; i < 3; i++) {
        const y = h * (0.55 + i * 0.12) + Math.sin(t * 0.15 + i) * h * 0.02;
        ctx.fillStyle = vgrad(ctx, h * 0.18, [[0, 'rgba(200,220,235,0)'], [0.5, 'rgba(200,220,235,0.07)'], [1, 'rgba(200,220,235,0)']], y);
        ctx.fillRect(0, y, w, h * 0.18);
      }
      ctx.lineCap = 'round';
      const slant = 0.18;
      for (const d of s.drops) {
        d.y += d.v * dt; d.x += d.v * slant * dt;
        if (d.y > d.floor) {
          if (d.z > 0.6 && s.ripples.length < 80) s.ripples.push({ x: d.x, y: d.floor, r: 0, a: 0.5 * d.z });
          Object.assign(d, newDrop(s, false));
        }
        ctx.strokeStyle = `rgba(200,225,245,${0.18 + d.z * 0.45})`;
        ctx.lineWidth = Math.max(0.6, d.z * 1.4 * unit);
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * slant, d.y - d.len); ctx.stroke();
      }
      ctx.lineWidth = Math.max(0.6, unit);
      for (let i = s.ripples.length - 1; i >= 0; i--) {
        const r = s.ripples[i];
        r.r += 26 * dt * unit; r.a -= 0.7 * dt;
        if (r.a <= 0) { s.ripples.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(200,225,245,${r.a})`;
        ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.28, 0, 0, TAU); ctx.stroke();
      }
    }
  };
  function newDrop(s, anywhere) {
    const z = R();
    return {
      z, x: rand(-s.w * 0.2, s.w), y: anywhere ? R() * s.h : rand(-s.h * 0.3, -10),
      v: (380 + z * 520) * s.unit * (s.small ? 0.5 : 1),
      len: (8 + z * 22) * s.unit,
      floor: s.h * (0.86 + z * 0.14)
    };
  }

  // 4. Sakura petals at dawn
  THEMES.sakura = {
    init(s) {
      const { w, h, dpr } = s;
      s.bg = null;
      s.mount = makeLayer(w, h, dpr, (g, lw, lh) => {
        // soft distant mountain
        g.fillStyle = 'rgba(232,170,190,0.55)';
        g.beginPath(); g.moveTo(lw * 0.35, lh); g.quadraticCurveTo(lw * 0.58, lh * 0.5, lw * 0.66, lh * 0.52);
        g.quadraticCurveTo(lw * 0.74, lh * 0.5, lw * 1.0, lh * 0.92); g.lineTo(lw, lh); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,250,252,0.85)';
        g.beginPath(); g.moveTo(lw * 0.6, lh * 0.56); g.quadraticCurveTo(lw * 0.64, lh * 0.51, lw * 0.66, lh * 0.52);
        g.quadraticCurveTo(lw * 0.69, lh * 0.51, lw * 0.72, lh * 0.56); g.quadraticCurveTo(lw * 0.66, lh * 0.58, lw * 0.6, lh * 0.56); g.fill();
        ridge(g, lw, lh, lh * 0.9, lh * 0.06, 61, 'rgba(214,140,165,0.55)', 5, false);
        // branch from the top-left
        const r = rng(7);
        const unit = Math.min(lw, lh * 1.8) / 900;
        const blossoms = [];
        function branch(x, y, ang, len, wdt, depth) {
          const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
          g.strokeStyle = '#4b2a33'; g.lineWidth = wdt; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y);
          g.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * len * 0.3, (y + y2) / 2 + (r() - 0.5) * len * 0.3, x2, y2); g.stroke();
          if (depth <= 0 || len < 12 * unit) { blossoms.push([x2, y2]); return; }
          const n = 2 + (r() < 0.4 ? 1 : 0);
          for (let i = 0; i < n; i++) branch(x2, y2, ang + (r() - 0.5) * 1.3, len * (0.62 + r() * 0.2), wdt * 0.62, depth - 1);
          if (depth < 3) blossoms.push([x2, y2]);
        }
        branch(-20 * unit, lh * 0.02, 0.22, Math.min(150 * unit, lw * 0.12), 14 * unit, 5);
        for (const [bx, by] of blossoms) {
          for (let k = 0; k < 5; k++) {
            const ox = (r() - 0.5) * 26 * unit, oy = (r() - 0.5) * 26 * unit, rr = (4 + r() * 6) * unit;
            g.fillStyle = ['#ffc1d3', '#ffd6e2', '#f7a8c0', '#fff0f5'][Math.floor(r() * 4)];
            g.beginPath(); g.arc(bx + ox, by + oy, rr, 0, TAU); g.fill();
          }
        }
      });
      const n = Math.round(s.count(70, 8));
      s.petals = Array.from({ length: n }, () => newPetal(s, true));
    },
    draw(ctx, s, t, dt) {
      const { w, h, unit } = s;
      if (!s.bg) s.bg = vgrad(ctx, h, [[0, '#ffd3e1'], [0.5, '#ffe9ee'], [1, '#fff4ea']]);
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.6; const sg = glow('#fff8e8', 128);
      const r = Math.max(w, h) * 0.3; ctx.drawImage(sg, w * 0.82 - r, h * 0.2 - r, r * 2, r * 2); ctx.globalAlpha = 1;
      ctx.drawImage(s.mount.c, 0, 0, w, h);
      for (const p of s.petals) {
        p.y += p.vy * dt; p.x += (p.vx + Math.sin(t * p.sw + p.ph) * 24 * unit) * dt;
        p.rot += p.vr * dt; p.flip += p.vf * dt;
        if (p.y > h + 20 || p.x > w + 40) Object.assign(p, newPetal(s, false));
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.flip)) * 0.8 + 0.2);
        ctx.fillStyle = p.c; ctx.globalAlpha = p.a;
        ctx.beginPath(); ctx.moveTo(0, -p.s); ctx.quadraticCurveTo(p.s * 0.9, -p.s * 0.2, 0, p.s);
        ctx.quadraticCurveTo(-p.s * 0.9, -p.s * 0.2, 0, -p.s); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  };
  function newPetal(s, anywhere) {
    const z = rand(0.5, 1.2);
    return {
      x: anywhere ? R() * s.w : rand(-s.w * 0.3, s.w * 0.7), y: anywhere ? R() * s.h : rand(-40, -10),
      vy: rand(18, 40) * z * s.unit, vx: rand(10, 30) * z * s.unit, sw: rand(0.6, 1.4), ph: R() * TAU,
      rot: R() * TAU, vr: rand(-1.5, 1.5), flip: R() * TAU, vf: rand(1, 3),
      s: rand(3, 6) * z * s.unit, a: rand(0.7, 1),
      c: ['#ffb7cb', '#ffc9d8', '#f59ab6', '#ffe1ea'][Math.floor(R() * 4)]
    };
  }

  // 5. Aurora night over mountains
  THEMES.aurora = {
    init(s) {
      const { w, h, dpr } = s;
      s.bg = null; s.grads = null;
      s.stars = Array.from({ length: Math.round(s.count(260, 25)) }, () => ({ x: R() * w, y: R() * h * 0.75, r: rand(0.3, 1.3) * s.unit, ph: R() * TAU, sp: rand(0.5, 2) }));
      s.mounts = makeLayer(w * 1.4, h, dpr, (g, lw, lh) => {
        ridge(g, lw, lh, lh * 0.72, lh * 0.22, 71, '#0d1a2b', 7);
        ridge(g, lw, lh, lh * 0.86, lh * 0.12, 73, '#060d18', 6);
        const r = rng(3);
        for (let x = 0; x < lw; x += lh * 0.025 + r() * lh * 0.03) pineW(g, lw, x, lh * 0.99, lh * (0.06 + r() * 0.07), '#03070e');
      });
      s.ribbons = [
        { y: 0.22, amp: 0.06, h: 0.32, sp: 0.12, k: 1.3, c: [109, 255, 179], a: 0.55 },
        { y: 0.30, amp: 0.05, h: 0.26, sp: -0.09, k: 1.9, c: [120, 220, 255], a: 0.35 },
        { y: 0.18, amp: 0.04, h: 0.22, sp: 0.07, k: 2.6, c: [190, 150, 255], a: 0.3 }
      ];
      s.shoot = null;
    },
    draw(ctx, s, t, dt) {
      const { w, h, unit } = s;
      if (!s.bg) s.bg = vgrad(ctx, h, [[0, '#01040b'], [0.6, '#071528'], [1, '#0b1f33']]);
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h);
      for (const st of s.stars) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * st.sp + st.ph));
        ctx.fillStyle = `rgba(230,240,255,${a})`; ctx.fillRect(st.x, st.y, st.r * 1.6, st.r * 1.6);
      }
      // aurora ribbons
      ctx.globalCompositeOperation = 'lighter';
      const cols = 150, step = w / cols;
      for (const rb of s.ribbons) {
        const rh = h * rb.h;
        const g = ctx.createLinearGradient(0, 0, 0, rh);
        const [r, gg, b] = rb.c;
        g.addColorStop(0, `rgba(${r},${gg},${b},0)`);
        g.addColorStop(0.55, `rgba(${r},${gg},${b},${rb.a * 0.35})`);
        g.addColorStop(0.85, `rgba(${r},${gg},${b},${rb.a})`);
        g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        ctx.fillStyle = g;
        for (let i = 0; i <= cols; i++) {
          const x = i * step, k = x / w;
          const y = h * rb.y + Math.sin(k * TAU * rb.k + t * rb.sp * 6) * h * rb.amp + Math.sin(k * TAU * rb.k * 2.7 - t * rb.sp * 4) * h * rb.amp * 0.4;
          const flick = 0.75 + 0.25 * Math.sin(k * 40 + t * 1.5);
          ctx.globalAlpha = flick;
          ctx.setTransform(s.dpr, 0, 0, s.dpr * (0.85 + 0.3 * Math.sin(k * 9 + t * 0.6)), x * s.dpr, y * s.dpr);
          ctx.fillRect(0, 0, step + 1, rh);
        }
        ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      }
      ctx.globalAlpha = 1;
      // shooting star
      if (!s.small) {
        if (!s.shoot && R() < dt * 0.04) s.shoot = { x: rand(w * 0.1, w * 0.8), y: rand(0, h * 0.3), vx: rand(500, 800) * unit, vy: rand(150, 300) * unit, life: 1 };
        if (s.shoot) {
          const sh = s.shoot; sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.life -= dt * 1.4;
          ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, sh.life)})`; ctx.lineWidth = 1.5 * unit;
          ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - sh.vx * 0.08, sh.y - sh.vy * 0.08); ctx.stroke();
          if (sh.life <= 0) s.shoot = null;
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      drawScroll(ctx, s.mounts, t * 0.8 * unit, w);
    }
  };

  // 6. Snowfall over winter hills
  THEMES.snow = {
    init(s) {
      const { w, h, dpr } = s;
      s.bg = null;
      s.hills = makeLayer(w * 1.5, h, dpr, (g, lw, lh) => {
        ridge(g, lw, lh, lh * 0.66, lh * 0.18, 81, '#8fa9cc', 6);
        ridge(g, lw, lh, lh * 0.78, lh * 0.1, 83, '#b9cde6', 5);
        const r = rng(13);
        for (let x = 0; x < lw; x += lh * 0.04 + r() * lh * 0.08) pineW(g, lw, x, lh * 0.82 - r() * lh * 0.03, lh * (0.08 + r() * 0.08), '#2c4566');
        ridge(g, lw, lh, lh * 0.92, lh * 0.06, 87, '#e8f1fb', 4);
      });
      s.flakes = Array.from({ length: Math.round(s.count(220, 24)) }, () => newFlake(s, true));
    },
    draw(ctx, s, t, dt) {
      const { w, h, unit } = s;
      if (!s.bg) s.bg = vgrad(ctx, h, [[0, '#1b2846'], [0.5, '#3e5a88'], [1, '#93acd0']]);
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 0.35; const mg = glow('#eaf3ff', 128); const r = Math.max(w, h) * 0.18;
      ctx.drawImage(mg, w * 0.2 - r, h * 0.2 - r, r * 2, r * 2); ctx.globalAlpha = 1;
      drawScroll(ctx, s.hills, t * 1.5 * unit, w);
      const sp = glow('#ffffff', 32);
      for (const f of s.flakes) {
        f.y += f.vy * dt; f.x += (f.vx + Math.sin(t * f.sw + f.ph) * 14 * unit * f.z) * dt;
        if (f.y > h + 10) Object.assign(f, newFlake(s, false));
        if (f.x > w + 10) f.x = -10; if (f.x < -10) f.x = w + 10;
        const rr = f.r;
        ctx.globalAlpha = 0.5 + f.z * 0.5;
        ctx.drawImage(sp, f.x - rr * 2, f.y - rr * 2, rr * 4, rr * 4);
      }
      ctx.globalAlpha = 1;
    }
  };
  function newFlake(s, anywhere) {
    const z = R();
    return {
      z, x: R() * s.w, y: anywhere ? R() * s.h : rand(-30, -5),
      vy: (14 + z * 40) * s.unit * (s.small ? 0.7 : 1), vx: rand(-4, 8) * s.unit, sw: rand(0.4, 1.2), ph: R() * TAU,
      r: (0.8 + z * 2.4) * s.unit
    };
  }

  // 7. Sunny meadow: clouds, swaying grass, drifting dandelion seeds
  THEMES.meadow = {
    init(s) {
      const { w, h, dpr } = s;
      s.bg = null;
      s.hills = makeLayer(w * 1.5, h, dpr, (g, lw, lh) => {
        ridge(g, lw, lh, lh * 0.66, lh * 0.1, 91, '#7fcf7a', 4);
        ridge(g, lw, lh, lh * 0.78, lh * 0.08, 93, '#5cb85c', 4);
        ridge(g, lw, lh, lh * 0.9, lh * 0.05, 97, '#3f9e4a', 4);
      });
      s.clouds = Array.from({ length: s.small ? 2 : 5 }, (_, i) => {
        const cw = rand(0.12, 0.24) * Math.max(w, 300);
        return { x: R() * w, y: h * rand(0.03, 0.2), sp: rand(4, 10), layer: makeLayer(cw, cw * 0.5, dpr, (g, lw, lh) => {
          g.fillStyle = 'rgba(255,255,255,0.92)';
          const r = rng(100 + i);
          for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(lw * (0.28 + r() * 0.44), lh * (0.42 + r() * 0.16), lh * (0.2 + r() * 0.14), 0, TAU); g.fill(); }
          for (let k = 0; k <= 6; k++) { g.beginPath(); g.arc(lw * (0.18 + k * 0.107), lh * 0.66, lh * 0.15, 0, TAU); g.fill(); }
        }), cw };
      });
      const nb = Math.round(Math.min(420, s.count(260, 40)));
      s.blades = Array.from({ length: nb }, () => ({ x: R() * w, hgt: rand(0.04, 0.12) * h, ph: R() * TAU, c: ['#2f8f3e', '#3fa34d', '#56b85a', '#2b7d36'][Math.floor(R() * 4)] }));
      s.blades.sort((a, b) => a.hgt - b.hgt);
      s.seeds = Array.from({ length: Math.round(s.count(30, 4)) }, () => ({ x: R() * w, y: rand(0.2, 0.8) * h, vx: rand(8, 20), ph: R() * TAU, s: rand(0.7, 1.3) }));
    },
    draw(ctx, s, t, dt) {
      const { w, h, unit } = s;
      if (!s.bg) s.bg = vgrad(ctx, h, [[0, '#4aa8e6'], [0.6, '#a9dcf7'], [1, '#e7f7ff']]);
      ctx.fillStyle = s.bg; ctx.fillRect(0, 0, w, h);
      // sun with slowly rotating rays
      const sx = w * 0.84, sy = h * 0.16, sr = Math.max(8, Math.min(w, h * 1.8) * 0.05);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 0.05);
      ctx.fillStyle = 'rgba(255,245,200,0.18)';
      for (let i = 0; i < 12; i++) { ctx.rotate(TAU / 12); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sr * 6, -sr * 0.5); ctx.lineTo(sr * 6, sr * 0.5); ctx.fill(); }
      ctx.restore();
      ctx.globalAlpha = 0.9; const sg = glow('#fff6c8', 128); ctx.drawImage(sg, sx - sr * 3, sy - sr * 3, sr * 6, sr * 6); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();
      for (const c of s.clouds) {
        c.x += c.sp * dt * unit; if (c.x > w + 20) c.x = -c.cw - 20;
        ctx.drawImage(c.layer.c, c.x, c.y, c.cw, c.cw * 0.5);
      }
      drawScroll(ctx, s.hills, t * 2 * unit, w);
      // grass
      ctx.lineCap = 'round';
      for (const b of s.blades) {
        const sway = Math.sin(t * 1.6 + b.x * 0.01 + b.ph * 0.3) * b.hgt * 0.22;
        ctx.strokeStyle = b.c; ctx.lineWidth = Math.max(1, unit * 2.2);
        ctx.beginPath(); ctx.moveTo(b.x, h + 2); ctx.quadraticCurveTo(b.x + sway * 0.3, h - b.hgt * 0.5, b.x + sway, h - b.hgt); ctx.stroke();
      }
      // dandelion seeds
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(0.5, unit * 0.8);
      for (const d of s.seeds) {
        d.x += d.vx * dt * unit; d.y += Math.sin(t * 0.8 + d.ph) * 10 * dt * unit;
        if (d.x > w + 20) { d.x = -20; d.y = rand(0.2, 0.8) * h; }
        const r = 5 * unit * d.s;
        ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.sin(t + d.ph) * 0.4);
        ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = -Math.PI / 2 + (k - 3.5) * 0.28; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, r * 1.2); ctx.stroke();
        ctx.restore();
      }
    }
  };

  // ---------- engine
  class NatureScene {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.fps = opts.fps || 60;
      this.density = opts.density ?? 1;
      this.themeId = THEMES[opts.theme] ? opts.theme : 'forest';
      this.running = false;
      this.t = Math.random() * 100;
      this._last = 0; this._acc = 0;
      this._loop = this._loop.bind(this);
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      this.resize();
    }
    static palette(id) { return PALETTES[id] || PALETTES.forest; }
    static get themes() { return Object.keys(PALETTES).map(id => ({ id, ...PALETTES[id] })); }
    setTheme(id) { if (!THEMES[id] || id === this.themeId) return; this.themeId = id; this._init(); if (!this.running) this.renderOnce(); }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      if (this.w === w && this.h === h && this.dpr === dpr) return;
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this._init();
      if (!this.running) this.renderOnce();
    }
    _init() {
      const s = this.state = {
        w: this.w, h: this.h, dpr: this.dpr,
        unit: Math.max(0.35, Math.min(this.w, this.h * 1.78) / 1280),
        small: this.h < 160,
        count: (base, min) => Math.max(min, base * this.density * Math.min(2.2, (this.w * this.h) / (1920 * 1080)))
      };
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      THEMES[this.themeId].init(s);
    }
    renderOnce() {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      THEMES[this.themeId].draw(this.ctx, this.state, this.t, 0);
    }
    start() { if (this.running) return; this.running = true; this._last = performance.now(); requestAnimationFrame(this._loop); }
    stop() { this.running = false; }
    _loop(now) {
      if (!this.running) return;
      requestAnimationFrame(this._loop);
      const minDt = 1000 / this.fps;
      const el = now - this._last;
      if (el < minDt - 1) return;
      this._last = now;
      const dt = Math.min(0.1, el / 1000);
      this.t += dt;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      THEMES[this.themeId].draw(this.ctx, this.state, this.t, dt);
    }
  }

  window.NatureScene = NatureScene;
})();
