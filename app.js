/* Ninas Gymlog ❤️ – single-file app, plain ES2019 for iOS 15 Safari */
(function () {
  'use strict';

  // ================================================================
  // Storage
  // ================================================================
  var KEY = 'ninas-gymlog-v1';
  var S = load();

  function blank() {
    return { version: 1, settings: { bodyweight: null }, exercises: [], plans: [], sessions: [], active: null, rewards: [], rewardIntroSeen: false };
  }
  function migrate(d) {
    var b = blank();
    Object.keys(b).forEach(function (k) { if (d[k] === undefined) d[k] = b[k]; });
    if (!d.settings) d.settings = b.settings;
    return d;
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { /* fall through to blank */ }
    return blank();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('Speichern fehlgeschlagen!'); }
  }

  // ================================================================
  // Helpers
  // ================================================================
  var WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  var LETTERS = 'ABCDEFGHIJ';

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim().replace(',', '.');
    if (s === '') return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }
  function roundTo(x, step) { return Math.round(x / step) * step; }
  function round05(x) { return Math.round(x * 2) / 2; }
  function fmtKg(n) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    return String(Math.round(n * 100) / 100).replace('.', ',');
  }
  function fmtNum(n) { return Math.round(n).toLocaleString('de-DE'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dstr(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
  function today() { return dstr(new Date()); }
  function pdate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function addDays(s, n) { var d = pdate(s); d.setDate(d.getDate() + n); return dstr(d); }
  function wd(s) { return (pdate(s).getDay() + 6) % 7; } // 0 = Montag
  function fmtDate(s, withYear) {
    var d = pdate(s);
    return WD[wd(s)] + ', ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + (withYear ? d.getFullYear() : '');
  }
  function relDate(s) {
    var t = today();
    if (s === t) return 'Heute';
    if (s === addDays(t, 1)) return 'Morgen';
    return fmtDate(s);
  }
  function hhmm(dt) { return pad(dt.getHours()) + ':' + pad(dt.getMinutes()); }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
  }
  function fmtMin(sec) {
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min';
  }
  function repUpper(text) {
    var m = String(text || '').match(/\d+/g);
    return m ? parseInt(m[m.length - 1], 10) : null;
  }
  function brzycki(kg, reps) {
    if (!kg || !reps || reps >= 37) return null;
    return kg * 36 / (37 - reps);
  }

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2200);
  }

  // ================================================================
  // Domain
  // ================================================================
  function exById(id) { for (var i = 0; i < S.exercises.length; i++) if (S.exercises[i].id === id) return S.exercises[i]; return null; }
  function planById(id) { for (var i = 0; i < S.plans.length; i++) if (S.plans[i].id === id) return S.plans[i]; return null; }
  function sessionById(id) { for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === id) return S.sessions[i]; return null; }
  function livePlans() { return S.plans.filter(function (p) { return !p.deletedAt; }); }
  function exName(id) { var e = exById(id); return e ? e.name : '(gelöscht)'; }

  function plannedKg(set, e) {
    if (set.mode === 'fixed') return num(set.value);
    if (set.mode === 'pct') {
      var pct = num(set.value);
      if (!e || pct === null) return null;
      return roundTo(e.benchmark * pct / 100, e.rounding || 2.5);
    }
    return null; // Körpergewicht
  }

  function currentDays(p) { return p.schedules.length ? p.schedules[p.schedules.length - 1].days : []; }
  function isScheduled(p, d) {
    if (p.deletedAt && d >= p.deletedAt) return false;
    var sc = null;
    for (var i = 0; i < p.schedules.length; i++) if (p.schedules[i].from <= d) sc = p.schedules[i];
    return !!sc && sc.days.indexOf(wd(d)) >= 0;
  }
  function sessionSortKey(se) { return se.date + ' ' + (se.start || '00:00'); }

  // x = Einheiten nach Plan, y = Soll bis heute, z = außerhalb des Plans
  function planStats() {
    var t = today(), used = {}, inPlan = {}, x = 0, y = 0;
    S.sessions.slice().sort(function (a, b) { return sessionSortKey(a) < sessionSortKey(b) ? -1 : 1; })
      .forEach(function (se) {
        var p = planById(se.planId);
        if (!p || se.date > t || !isScheduled(p, se.date)) return;
        var k = p.id + '|' + se.date;
        if (!used[k]) { used[k] = 1; inPlan[se.id] = 1; x++; }
      });
    S.plans.forEach(function (p) {
      if (!p.schedules.length) return;
      for (var d = p.schedules[0].from; d <= t; d = addDays(d, 1)) {
        if (p.deletedAt && d >= p.deletedAt) break;
        if (isScheduled(p, d) && (d < t || used[p.id + '|' + d])) y++;
      }
    });
    return { x: x, y: y, z: S.sessions.length - x, inPlan: inPlan };
  }

  function nextUp() {
    var t = today();
    for (var i = 0; i < 14; i++) {
      var d = addDays(t, i);
      var plans = livePlans();
      for (var j = 0; j < plans.length; j++) {
        var p = plans[j];
        if (currentDays(p).indexOf(wd(d)) < 0) continue;
        if (i === 0 && S.sessions.some(function (se) { return se.planId === p.id && se.date === t; })) continue;
        return { plan: p, date: d };
      }
    }
    return null;
  }

  function sessionVolume(se) {
    var v = 0;
    eachSet(se.blocks, function (s) {
      var kg = s.mode === 'bw' ? (se.bodyweight || 0) : (s.actualKg || 0);
      v += kg * (s.actualReps || 0);
    });
    return v;
  }
  function eachSet(blocks, fn) {
    blocks.forEach(function (b, bi) {
      b.rounds.forEach(function (r, ri) {
        r.sets.forEach(function (s, si) { fn(s, bi, ri, si, b); });
      });
    });
  }

  // Plan -> Trainingsblöcke mit Soll-Werten
  function instantiate(plan) {
    return plan.blocks.map(function (b) {
      var items = b.items.map(function (it) { return { exId: it.exId, name: exName(it.exId) }; });
      return {
        type: b.type,
        items: items,
        rounds: b.rounds.map(function (r) {
          return {
            sets: r.sets.map(function (st, i) {
              var e = exById(items[i].exId);
              return {
                exId: items[i].exId, name: items[i].name, mode: st.mode,
                pct: st.mode === 'pct' ? num(st.value) : null,
                plannedKg: plannedKg(st, e), reps: st.reps || '',
                actualReps: '', actualKg: ''
              };
            })
          };
        })
      };
    });
  }

  // Eingaben (Strings) -> gespeicherte Ist-Werte
  function finalizeBlocks(blocks) {
    eachSet(blocks, function (s) {
      var r = num(s.actualReps);
      s.actualReps = r === null ? 0 : Math.max(0, Math.round(r));
      if (s.mode === 'bw') s.actualKg = null;
      else {
        var kg = num(s.actualKg);
        s.actualKg = kg === null ? s.plannedKg : kg;
      }
    });
    return blocks;
  }
  // gespeicherte Ist-Werte -> Strings fürs Bearbeiten
  function toEditable(blocks) {
    eachSet(blocks, function (s) {
      s.actualReps = s.actualReps === null || s.actualReps === undefined ? '' : String(s.actualReps);
      s.actualKg = s.mode === 'bw' || s.actualKg === null || s.actualKg === s.plannedKg ? '' : fmtKg(s.actualKg);
    });
    return blocks;
  }

  // Progression: alle %-Sätze mit Zahl im Wdh.-Feld geschafft -> Benchmark + X %
  function applyProgression(blocks, date) {
    var groups = {};
    eachSet(blocks, function (s) {
      if (s.mode !== 'pct') return;
      var up = repUpper(s.reps);
      if (up === null) return;
      (groups[s.exId] = groups[s.exId] || []).push({ s: s, up: up });
    });
    var pbs = [];
    Object.keys(groups).forEach(function (id) {
      var e = exById(id);
      if (!e || !(e.benchmark > 0)) return;
      var ok = groups[id].every(function (g) {
        return g.s.actualReps >= g.up && g.s.plannedKg !== null && g.s.actualKg >= g.s.plannedKg - 1e-9;
      });
      if (!ok) return;
      var from = e.benchmark;
      var to = round05(from * (1 + (e.increment || 0) / 100));
      if (to <= from) to = from + 0.5;
      e.benchmark = to;
      e.history.push({ date: date, value: to, reason: 'auto' });
      pbs.push({ name: e.name, from: from, to: to });
    });
    return pbs;
  }

  // Belohnung: ein Gutschein pro Benchmark-Erhöhung
  var PRIZES = [
    { name: 'Datenight', p: 3 },
    { name: '1 Abendessen', p: 5 },
    { name: 'Eine 5-Minuten-Massage', p: 15 },
    { name: 'Ein Klaps auf den Po 😉', p: 20 },
    { name: 'Ein Kuss', p: 57 }
  ];
  function drawPrize() {
    var r = Math.random() * 100, acc = 0;
    for (var i = 0; i < PRIZES.length; i++) { acc += PRIZES[i].p; if (r < acc) return PRIZES[i].name; }
    return PRIZES[PRIZES.length - 1].name;
  }
  // Lost Gutscheine aus und merkt sich, ob das Belohnungssystem schon vorgestellt wurde
  function drawRewards(pbs, date) {
    if (!pbs.length) return false;
    var intro = !S.rewardIntroSeen;
    S.rewardIntroSeen = true;
    pbs.forEach(function (pb) {
      pb.prize = drawPrize();
      S.rewards.push({ date: date, prize: pb.prize, exercise: pb.name });
    });
    return intro;
  }

  // Layouts: id -> data-theme on <html>; sw = Vorschaufarben [Kopf, Hintergrund, Karte, Akzent]
  var THEMES = [
    { id: 'nina', name: 'Nina Rosa', desc: 'Pink-Lila, verspielt', heart: '❤️', meta: '#2a1027', sw: ['#3a1637', '#2a1027', '#3f1a3c', '#ec4899'] },
    { id: 'anime', name: 'Anime', desc: 'Manga-Look, hell', heart: '💖', meta: '#ff4f8b', sw: ['#ff4f8b', '#fff7fb', '#ffffff', '#4cc9f0'] },
    { id: 'depot', name: 'Depot', desc: 'Navy & Gold, edel', heart: '❤️', meta: '#0B1F33', sw: ['#0B1F33', '#F7F5F1', '#FFFFFF', '#B8912F'] },
    { id: 'hud', name: 'Gym-HUD', desc: 'Jarvis, Cyan-Glühen', heart: '💙', meta: '#04070b', sw: ['#04070b', '#061118', '#0a1a24', '#42e8ff'] },
    { id: 'mono', name: 'Schwarz-Weiß', desc: 'Schlicht, Anthrazit', heart: '🤍', meta: '#000000', sw: ['#000000', '#0d0d0d', '#1c1d1f', '#ffffff'] },
    { id: 'classic', name: 'Klassik Gym', desc: 'Sportlich, Rot', heart: '❤️', meta: '#0e0e10', sw: ['#0e0e10', '#18181b', '#1c1c1f', '#e30613'] },
    { id: 'jjk', name: 'Jujutsu', desc: 'Unendliche Leere, blaue Flammen', heart: '💜', meta: '#050816', sw: ['#050816', '#0b1028', '#161c44', '#4f8cff'] },
    { id: 'ds', name: 'Demon Slayer', desc: 'Flammen- & Wasseratmung', heart: '🔥', meta: '#0c0a0a', sw: ['#0c0a0a', '#161111', '#2a1d1a', '#ff5a1f'] },
    { id: 'sukuna', name: 'Sukuna', desc: 'Schrein, Blutrot, Feuer', heart: '👹', meta: '#0f0103', sw: ['#2a0306', '#5a0610', '#330609', '#ff2a2a'] }
  ];
  function theme() {
    var id = S.settings.theme;
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }
  function applyTheme() {
    var t = theme();
    document.documentElement.setAttribute('data-theme', t.id);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t.meta);
  }

  // ================================================================
  // Router & UI state
  // ================================================================
  var menuOpen = false;
  var chartPlan = 'all';
  var anaEx = null;
  var pdraft = null, pdraftKey = null;   // Plan-Editor
  var draft = null, draftKey = null;     // Nachtragen / Bearbeiten
  var modal = null;                      // { type, ... }

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    return h ? h.split('/') : [''];
  }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }

  window.addEventListener('hashchange', function () { menuOpen = false; window.scrollTo(0, 0); render(); });

  var app = document.getElementById('app');

  function render() {
    var r = route(), html;
    if (r[0] !== 'plan') { pdraft = null; pdraftKey = null; }
    if (r[0] !== 'log' && !(r[0] === 'session' && r[2] === 'edit')) { draft = null; draftKey = null; }
    switch (r[0]) {
      case 'plans': html = vPlans(); break;
      case 'plan': html = vPlanEdit(r[1]); break;
      case 'bench': html = vBench(); break;
      case 'go': html = S.active ? vGo() : (go('#/'), ''); break;
      case 'log': html = vDraft('log', r[1]); break;
      case 'sessions': html = vSessions(); break;
      case 'session': html = r[2] === 'edit' ? vDraft('edit', r[1]) : vSession(r[1]); break;
      case 'analyse': html = vAnalyse(); break;
      case 'settings': html = vSettings(); break;
      default: html = vDash();
    }
    app.innerHTML = html + (menuOpen ? vMenu() : '');
    renderModal();
    tick();
  }

  function header(title, opts) {
    opts = opts || {};
    var left = opts.back
      ? '<a class="iconbtn" href="' + opts.back + '" aria-label="Zurück">‹</a>'
      : '<button class="iconbtn" data-a="menu" aria-label="Menü">…</button>';
    return '<header class="bar">' + left +
      (opts.script
        ? '<h1 class="script"><span class="gradtext">' + title + '</span> <span class="heart">' + theme().heart + '</span></h1>'
        : '<h1>' + title + '</h1>') +
      (opts.right || '<span class="spacer"></span>') + '</header>';
  }
  function tabs(on) {
    function t(h, k, ic, label) {
      return '<a href="' + h + '" class="' + (on === k ? 'on' : '') + '"><span class="ic">' + ic + '</span>' + label + '</a>';
    }
    return '<nav class="tabs">' + t('#/', 'dash', '♡', 'Dashboard') + t('#/plans', 'plans', '☰', 'Trainings') +
      t('#/bench', 'bench', '★', 'Benchmarks') + '</nav>';
  }
  function vMenu() {
    var r = route()[0] || 'dash';
    var items = [['#/', 'dash', 'Dashboard'], ['#/plans', 'plans', 'Trainings'], ['#/bench', 'bench', 'Benchmarks'],
      ['#/analyse', 'analyse', 'Analyse'], ['#/sessions', 'sessions', 'Alle Trainings'], ['#/settings', 'settings', 'Einstellungen']];
    return '<div class="menu-back" data-a="menu-close"></div><div class="menu">' + items.map(function (i) {
      return '<a href="' + i[0] + '" class="' + ((r === i[1] || (r === '' && i[1] === 'dash')) ? 'on' : '') + '">' + i[2] + '</a>';
    }).join('') + '</div>';
  }

  // ================================================================
  // Views: Dashboard
  // ================================================================
  function vDash() {
    var h = header('Ninas Gymlog', { script: true });
    var out = '';
    if (S.active) {
      var ap = planById(S.active.planId);
      out += '<div class="banner"><div class="grow"><b>Training läuft</b><div class="small muted">' +
        esc(ap ? ap.name : '') + '</div></div><a class="btn primary sm" href="#/go">Fortsetzen</a></div>';
    }
    var n = nextUp();
    if (n) {
      var exs = [];
      n.plan.blocks.forEach(function (b) { b.items.forEach(function (it) { exs.push(exName(it.exId)); }); });
      out += '<div class="card hero"><div class="small" style="opacity:.9;font-weight:700">ALS NÄCHSTES · ' + esc(relDate(n.date)).toUpperCase() + '</div>' +
        '<div class="big" style="margin:4px 0 6px">' + esc(n.plan.name) + '</div>' +
        '<div class="small" style="opacity:.92">' + esc(exs.join(' · ') || 'Noch keine Übungen') + '</div>' +
        '<div class="btns"><button class="btn white go" data-a="go-start" data-plan="' + n.plan.id + '">GO</button></div></div>';
    } else {
      out += '<div class="card hero"><div class="big" style="font-size:24px">Kein Training geplant</div>' +
        '<div class="small" style="opacity:.9;margin-top:6px">Lege unter Trainings einen Plan mit Wochentagen an.</div>' +
        '<div class="btns"><a class="btn white" href="#/plans">Zu den Trainings</a></div></div>';
    }
    var st = planStats();
    out += '<div class="card"><div class="stat"><b>' + st.x + '</b><span class="muted">von ' + st.y + ' (Soll) erreicht</span></div>' +
      '<div class="muted" style="margin-top:4px">Außerhalb des Plans: <b style="color:var(--text)">' + st.z + '</b></div>' +
      '<a class="linkbtn" href="#/sessions" style="display:inline-block;margin-top:8px">Alle Trainings anzeigen</a></div>';

    out += '<div class="card"><h2>Bewegtes Gewicht</h2>' + planPills() +
      '<div class="chartwrap" data-a="open-analyse">' + volumeChart(180) + '<div class="hint center">Tippen für Analyse</div></div></div>';

    return h + '<div class="page">' + out + '</div>' + tabs('dash');
  }

  function chartPlans() {
    return S.plans.filter(function (p) {
      return !p.deletedAt || S.sessions.some(function (se) { return se.planId === p.id; });
    });
  }
  function planPills() {
    var ps = chartPlans();
    if (chartPlan !== 'all' && !planById(chartPlan)) chartPlan = 'all';
    return '<div class="pills">' + '<button class="pill ' + (chartPlan === 'all' ? 'on' : '') + '" data-a="chart-plan" data-p="all">Alle</button>' +
      ps.map(function (p) {
        return '<button class="pill ' + (chartPlan === p.id ? 'on' : '') + '" data-a="chart-plan" data-p="' + p.id + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>';
  }
  function sortedSessions(planId) {
    return S.sessions.filter(function (se) { return !planId || planId === 'all' || se.planId === planId; })
      .sort(function (a, b) { return sessionSortKey(a) < sessionSortKey(b) ? -1 : 1; });
  }
  function volumeChart(h) {
    var pts = sortedSessions(chartPlan).map(function (se) { return { label: fmtDate(se.date), y: sessionVolume(se) }; });
    return lineChart(pts, h, 'kg');
  }

  // Simple SVG line chart, x = index
  function lineChart(pts, h, unit) {
    if (!pts.length) return '<div class="empty">Noch keine Daten</div>';
    var W = 320, H = h, pl = 40, pr = 10, pt = 12, pb = 22;
    var max = Math.max.apply(null, pts.map(function (p) { return p.y; }));
    var min = Math.min.apply(null, pts.map(function (p) { return p.y; }));
    var lo = unit === 'kg' && min > 0 && pts.length > 1 && max > 0 ? Math.max(0, min - (max - min) * 0.3) : 0;
    if (unit !== 'kg') lo = 0;
    if (max <= lo) max = lo + 1;
    var hi = max + (max - lo) * 0.1;
    function X(i) { return pts.length === 1 ? (pl + W - pr) / 2 : pl + i * (W - pl - pr) / (pts.length - 1); }
    function Y(v) { return pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb); }
    var g = '';
    for (var k = 0; k <= 3; k++) {
      var v = lo + (hi - lo) * k / 3, y = Y(v);
      g += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke-dasharray="3 4"/>' +
        '<text x="' + (pl - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + shortNum(v) + '</text>';
    }
    var line = pts.map(function (p, i) { return X(i).toFixed(1) + ',' + Y(p.y).toFixed(1); }).join(' ');
    var area = 'M' + X(0) + ',' + Y(lo) + ' L' + line.split(' ').join(' L') + ' L' + X(pts.length - 1) + ',' + Y(lo) + ' Z';
    var dots = pts.map(function (p, i) {
      return '<circle cx="' + X(i) + '" cy="' + Y(p.y) + '" r="' + (pts.length > 30 ? 2 : 3.5) + '" class="dot" stroke-width="2"/>';
    }).join('');
    var lab = '<text x="' + X(0) + '" y="' + (H - 6) + '" text-anchor="' + (pts.length === 1 ? 'middle' : 'start') + '">' + esc(pts[0].label) + '</text>';
    if (pts.length > 1) lab += '<text x="' + X(pts.length - 1) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(pts[pts.length - 1].label) + '</text>';
    var gid = 'g' + Math.random().toString(36).slice(2, 7);
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="height:' + H + 'px">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop class="s1" offset="0" stop-opacity=".4"/>' +
      '<stop class="s2" offset="1" stop-opacity="0"/></linearGradient></defs>' + g +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<polyline class="ln" points="' + line + '" fill="none" stroke-width="2.5" stroke-linejoin="round"/>' + dots + lab + '</svg>';
  }
  function shortNum(v) {
    if (v >= 10000) return Math.round(v / 1000) + 'k';
    if (v >= 1000) return (Math.round(v / 100) / 10).toString().replace('.', ',') + 'k';
    if (v >= 100) return String(Math.round(v));
    return fmtKg(Math.round(v * 10) / 10);
  }

  // ================================================================
  // Views: Trainings
  // ================================================================
  function vPlans() {
    var ps = livePlans();
    var out = '<div class="btns" style="margin:0 0 14px"><a class="btn primary" href="#/plan/new">+ Neues Training</a></div>';
    if (!ps.length) out += '<div class="empty">Noch keine Trainings.<br>Lege dein erstes an!</div>';
    ps.forEach(function (p) {
      var days = currentDays(p).map(function (d) { return WD[d]; }).join(' · ') || 'keine festen Tage';
      var n = 0; p.blocks.forEach(function (b) { n += b.items.length; });
      out += '<div class="card"><a href="#/plan/' + p.id + '" style="text-decoration:none;color:inherit;display:block">' +
        '<div class="row"><div class="grow"><div style="font-size:20px;font-weight:800">' + esc(p.name) + '</div>' +
        '<div class="small muted">' + days + ' · ' + n + ' Übung' + (n === 1 ? '' : 'en') + '</div></div><span class="chev">›</span></div></a>' +
        '<div class="btns"><button class="btn primary sm" data-a="go-start" data-plan="' + p.id + '">GO</button>' +
        '<a class="btn sm" href="#/log/' + p.id + '">Nachtragen</a></div></div>';
    });
    return header('Trainings') + '<div class="page">' + out + '</div>' + tabs('plans');
  }

  function newSet() { return { mode: 'pct', value: '', reps: '' }; }

  function vPlanEdit(id) {
    var key = 'plan/' + id;
    if (pdraftKey !== key) {
      pdraftKey = key;
      if (id === 'new') pdraft = { id: null, name: '', days: [], blocks: [] };
      else {
        var p = planById(id);
        if (!p) { go('#/plans'); return ''; }
        pdraft = { id: p.id, name: p.name, days: currentDays(p).slice(), blocks: clone(p.blocks) };
      }
    }
    var d = pdraft;
    var out = '<label class="f"><span>Name</span><input class="inp" data-in="pe-name" value="' + esc(d.name) + '" placeholder="z. B. Unterkörper A"></label>' +
      '<div class="f" style="margin-bottom:16px"><span class="small muted" style="font-weight:700;margin-left:4px">Wochentage</span><div class="days" style="margin-top:5px">' +
      WD.map(function (w, i) {
        return '<button class="pill ' + (d.days.indexOf(i) >= 0 ? 'on' : '') + '" data-a="pe-day" data-d="' + i + '">' + w + '</button>';
      }).join('') + '</div></div>';

    d.blocks.forEach(function (b, bi) { out += peBlock(b, bi, d.blocks.length); });
    if (!d.blocks.length) out += '<div class="empty">Füge Übungen oder ein Multiset hinzu.</div>';

    out += '<div class="btns"><button class="btn" data-a="pe-add-single">+ Übung</button><button class="btn" data-a="pe-add-multi">+ Multiset</button></div>' +
      '<div class="btns" style="margin-top:22px"><button class="btn primary block" data-a="pe-save">Speichern</button></div>';
    if (d.id) out += '<div class="btns"><button class="btn danger block" data-a="pe-delete">Training löschen</button></div>';

    return header(d.id ? 'Training bearbeiten' : 'Neues Training', { back: '#/plans' }) + '<div class="page">' + out + '</div>';
  }

  function peBlock(b, bi, total) {
    var multi = b.type === 'multi';
    var ctrl = '<button class="mini" data-a="pe-up" data-b="' + bi + '"' + (bi === 0 ? ' style="opacity:.35"' : '') + '>▲</button>' +
      '<button class="mini" data-a="pe-down" data-b="' + bi + '"' + (bi === total - 1 ? ' style="opacity:.35"' : '') + '>▼</button>' +
      '<button class="mini del" data-a="pe-del" data-b="' + bi + '">✕</button>';
    var out = '<div class="block' + (multi ? ' multi' : '') + '"><div class="block-head"><div class="t">' +
      (multi ? '<span style="color:var(--lila)">Multiset</span>' : esc(exName(b.items[0].exId))) + '</div>' + ctrl + '</div>';
    if (multi) {
      out += b.items.map(function (it, ii) {
        return '<div class="row" style="margin-bottom:6px"><span class="letter">' + LETTERS[ii] + '</span><span class="grow" style="font-weight:700">' +
          esc(exName(it.exId)) + '</span><button class="mini del" data-a="pe-del-item" data-b="' + bi + '" data-i="' + ii + '">✕</button></div>';
      }).join('') + '<button class="linkbtn" data-a="pe-add-item" data-b="' + bi + '">+ Übung ins Multiset</button>';
    }
    out += '<div class="colhead" style="margin-top:8px"><span style="width:30px"></span><span style="flex:1.25">Gewicht</span><span style="flex:.8">Wert</span><span style="flex:.9">Soll-Wdh.</span><span style="width:34px"></span></div>';
    b.rounds.forEach(function (r, ri) {
      if (multi) {
        out += '<div class="round"><div class="round-h"><span>Runde ' + (ri + 1) + '</span><button class="mini del" data-a="pe-del-set" data-b="' + bi + '" data-r="' + ri + '">✕</button></div>';
        r.sets.forEach(function (s, si) {
          out += '<div class="exname">' + esc(exName(b.items[si].exId)) + '</div>' + peSetRow(b, bi, ri, si, s, LETTERS[si] + (ri + 1), false);
        });
        out += '</div>';
      } else {
        out += peSetRow(b, bi, ri, 0, r.sets[0], ri + 1, true);
      }
    });
    if (!b.rounds.length) out += '<div class="hint">Noch keine Sätze.</div>';
    out += '<button class="btn sm" style="margin-top:8px" data-a="pe-add-set" data-b="' + bi + '">' + (multi ? '+ Runde kopieren' : '+ Satz') + '</button></div>';
    return out;
  }

  function peSetRow(b, bi, ri, si, s, label, delBtn) {
    var k = 'data-b="' + bi + '" data-r="' + ri + '" data-s="' + si + '"';
    var e = exById(b.items[si].exId);
    var row = '<div class="setrow"><span class="lbl">' + label + '</span>' +
      '<select class="inp sm" data-in="pe-mode" ' + k + '>' +
      '<option value="pct"' + (s.mode === 'pct' ? ' selected' : '') + '>% Bench</option>' +
      '<option value="fixed"' + (s.mode === 'fixed' ? ' selected' : '') + '>Fest (kg)</option>' +
      '<option value="bw"' + (s.mode === 'bw' ? ' selected' : '') + '>Körpergew.</option></select>' +
      (s.mode === 'bw'
        ? '<span class="val faint small center">–</span>'
        : '<input class="inp sm val" inputmode="decimal" data-in="pe-val" ' + k + ' value="' + esc(s.value) + '" placeholder="' + (s.mode === 'pct' ? '%' : 'kg') + '">') +
      '<input class="inp sm reps" data-in="pe-reps" ' + k + ' value="' + esc(s.reps) + '" placeholder="8-12">' +
      (delBtn ? '<button class="mini del" data-a="pe-del-set" data-b="' + bi + '" data-r="' + ri + '">✕</button>' : '<span style="width:34px;flex:none"></span>') +
      '</div>';
    if (s.mode === 'pct') row += '<div class="calc" id="calc-' + bi + '-' + ri + '-' + si + '">' + calcText(s, e) + '</div>';
    return row;
  }
  function calcText(s, e) {
    var kg = plannedKg(s, e);
    if (kg === null) return e ? 'Benchmark ' + fmtKg(e.benchmark) + ' kg' : '';
    return '≈ ' + fmtKg(kg) + ' kg' + (e.perSide ? ' (je Seite ' + fmtKg(kg / 2) + ')' : '') + ' · von ' + fmtKg(e.benchmark) + ' kg, Rundung ' + fmtKg(e.rounding);
  }

  function savePlan() {
    var d = pdraft;
    if (!d.name.trim()) { toast('Bitte einen Namen eingeben'); return; }
    var blocks = d.blocks.filter(function (b) { return b.items.length; });
    blocks.forEach(function (b) {
      b.rounds.forEach(function (r) { r.sets.forEach(function (s) { if (s.mode === 'bw') s.value = ''; }); });
    });
    var days = d.days.slice().sort();
    var t = today(), p;
    if (d.id) p = planById(d.id);
    if (!p) { p = { id: uid(), schedules: [], deletedAt: null, created: t }; S.plans.push(p); }
    p.name = d.name.trim();
    p.blocks = blocks;
    var cur = p.schedules[p.schedules.length - 1];
    if (!cur) p.schedules.push({ from: t, days: days });
    else if (cur.days.join() !== days.join()) {
      if (cur.from === t) cur.days = days; else p.schedules.push({ from: t, days: days });
    }
    save();
    toast('Gespeichert');
    go('#/plans');
  }

  // ================================================================
  // Views: Benchmarks
  // ================================================================
  function vBench() {
    var list = S.exercises.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    var out = '<div class="btns" style="margin:0 0 14px"><button class="btn primary" data-a="ex-new">+ Neue Übung</button></div>';
    if (!list.length) out += '<div class="empty">Noch keine Übungen.<br>Jede Übung bekommt automatisch ihre eigene Benchmark.</div>';
    list.forEach(function (e) {
      out += '<button class="list-item" data-a="ex-edit" data-id="' + e.id + '"><div class="grow"><div class="t">' + esc(e.name) + '</div>' +
        '<div class="small muted">Rundung ' + fmtKg(e.rounding) + ' kg · +' + fmtKg(e.increment) + ' %' + (e.perSide ? ' · je Seite' : '') + '</div></div>' +
        '<div class="right"><div style="font-size:22px;font-weight:800">' + fmtKg(e.benchmark) + '</div><div class="small faint">kg</div></div></button>';
    });
    return header('Benchmarks') + '<div class="page">' + out + '</div>' + tabs('bench');
  }

  function exerciseInPlans(id) {
    return livePlans().some(function (p) { return p.blocks.some(function (b) { return b.items.some(function (it) { return it.exId === id; }); }); }) ||
      (pdraft && pdraft.blocks.some(function (b) { return b.items.some(function (it) { return it.exId === id; }); }));
  }

  // ================================================================
  // Modals
  // ================================================================
  function openModal(m) { modal = m; renderModal(); }
  function closeModal() { modal = null; renderModal(); }

  function renderModal() {
    var root = document.getElementById('modal-root');
    if (!modal) { root.innerHTML = ''; return; }
    var inner = '', mid = false;
    if (modal.type === 'ex') inner = mExercise();
    else if (modal.type === 'picker') inner = mPicker();
    else if (modal.type === 'done') { inner = mDone(); mid = true; }
    root.innerHTML = '<div class="modal-back' + (mid ? ' mid' : '') + '" data-a="modal-back"><div class="modal' + (mid ? ' center-m' : '') + '">' + inner + '</div></div>';
    if (modal.type === 'picker' && modal.focus) {
      modal.focus = false;
      var q = document.getElementById('pk-q');
      if (q) q.focus();
    }
  }

  function mExercise() {
    var e = modal.id ? exById(modal.id) : null;
    var f = modal.form;
    if (!f) {
      f = modal.form = e
        ? { name: e.name, benchmark: fmtKg(e.benchmark), rounding: e.rounding, increment: fmtKg(e.increment), perSide: !!e.perSide, bkg: '', breps: '' }
        : { name: modal.name || '', benchmark: '', rounding: 2.5, increment: '2,5', perSide: false, bkg: '', breps: '' };
    }
    var canDel = e && !exerciseInPlans(e.id);
    return '<h3>' + (e ? 'Übung bearbeiten' : 'Neue Übung') + '</h3>' +
      '<label class="f"><span>Name</span><input class="inp" id="exm-name" value="' + esc(f.name) + '" placeholder="z. B. Hip Thrust"></label>' +
      '<label class="f"><span>Benchmark (1RM, kg, genau auf 0,5)</span><input class="inp" id="exm-bench" inputmode="decimal" value="' + esc(f.benchmark) + '" placeholder="z. B. 60"></label>' +
      '<div class="card" style="background:var(--panel);padding:12px;box-shadow:none"><div class="small muted" style="font-weight:700;margin-bottom:6px">Benchmark ausrechnen (Brzycki)</div>' +
      '<div class="two"><input class="inp sm" id="exm-bkg" inputmode="decimal" placeholder="kg" value="' + esc(f.bkg) + '">' +
      '<input class="inp sm" id="exm-breps" inputmode="numeric" placeholder="Wdh." value="' + esc(f.breps) + '">' +
      '<button class="btn sm" data-a="exm-brz" style="flex:none">Rechnen</button></div>' +
      '<div class="hint">z. B. „40 kg × 8 geschafft“ → Benchmark wird eingetragen.</div></div>' +
      '<div class="f" style="margin-bottom:12px"><span class="small muted" style="font-weight:700;margin-left:4px">Rundung im Training</span><div class="pills" style="margin-top:5px">' +
      [1, 2.5, 5].map(function (v) {
        return '<button class="pill ' + (f.rounding === v ? 'on' : '') + '" data-a="exm-round" data-v="' + v + '">' + fmtKg(v) + ' kg</button>';
      }).join('') + '</div></div>' +
      '<label class="f"><span>Steigerung bei Progression (%)</span><input class="inp" id="exm-inc" inputmode="decimal" value="' + esc(f.increment) + '"></label>' +
      '<label class="check"><input type="checkbox" id="exm-side"' + (f.perSide ? ' checked' : '') + '><span>Im Training Gewicht je Seite anzeigen (÷ 2)</span></label>' +
      '<div class="btns"><button class="btn ghost" data-a="modal-close">Abbrechen</button><button class="btn primary" data-a="exm-save">Speichern</button></div>' +
      (e ? '<div class="btns"><button class="btn danger block" data-a="exm-del"' + (canDel ? '' : ' disabled style="opacity:.4"') + '>Übung löschen</button></div>' +
        (canDel ? '' : '<div class="hint center">Löschen geht erst, wenn die Übung in keinem Training mehr steckt.</div>') : '');
  }
  function readExForm() {
    var f = modal.form;
    f.name = document.getElementById('exm-name').value;
    f.benchmark = document.getElementById('exm-bench').value;
    f.increment = document.getElementById('exm-inc').value;
    f.bkg = document.getElementById('exm-bkg').value;
    f.breps = document.getElementById('exm-breps').value;
    f.perSide = document.getElementById('exm-side').checked;
  }
  function saveExercise() {
    readExForm();
    var f = modal.form;
    var name = f.name.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    var bench = num(f.benchmark);
    bench = bench === null ? 0 : round05(Math.max(0, bench));
    var inc = num(f.increment); inc = inc === null ? 0 : Math.max(0, inc);
    var e = modal.id ? exById(modal.id) : null;
    if (e) {
      if (e.benchmark !== bench) e.history.push({ date: today(), value: bench, reason: 'manual' });
      e.name = name; e.benchmark = bench; e.rounding = f.rounding; e.increment = inc; e.perSide = f.perSide;
    } else {
      e = { id: uid(), name: name, benchmark: bench, rounding: f.rounding, increment: inc, perSide: f.perSide, history: [{ date: today(), value: bench, reason: 'start' }] };
      S.exercises.push(e);
    }
    save();
    var cb = modal.onSave;
    closeModal();
    if (cb) cb(e.id); else render();
  }

  function mPicker() {
    return '<h3>Übung wählen</h3><input class="inp" id="pk-q" data-in="pk-q" placeholder="Suchen …" value="' + esc(modal.q) + '" autocomplete="off">' +
      '<div id="pk-list" style="margin-top:12px">' + pickerList() + '</div>' +
      '<div class="btns"><button class="btn ghost block" data-a="modal-close">Abbrechen</button></div>';
  }
  function pickerList() {
    var q = (modal.q || '').trim().toLowerCase();
    var list = S.exercises.filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    var out = list.map(function (e) {
      return '<button class="list-item" data-a="pk-pick" data-id="' + e.id + '"><div class="grow t">' + esc(e.name) + '</div><span class="small muted">' + fmtKg(e.benchmark) + ' kg</span></button>';
    }).join('');
    if (!list.length) out += '<div class="empty" style="padding:12px">Keine Übung gefunden.</div>';
    out += '<button class="btn primary block" data-a="pk-new">+ Übung hinzufügen' + (q ? ': „' + esc(modal.q.trim()) + '“' : '') + '</button>';
    return out;
  }

  function mDone() {
    var m = modal;
    var out = '<h3 class="center">Training gespeichert ' + theme().heart + '</h3>' +
      '<div class="center muted">' + esc(m.planName) + ' · ' + fmtMin(m.duration) + ' · ' + fmtNum(m.volume) + ' kg bewegt</div>';
    if (m.intro) {
      out += '<div class="voucher intro"><b>Belohnungssystem:</b> Gewinne bei jeder Benchmark-Erhöhung einen Preis. ' +
        'Mit etwas Glück knackst du den Hauptgewinn:<br><br><b>Datenight mit deinem Mausebär</b> ' +
        '(von dir oder von ihm geplant, deine Wahl ;))</div>';
    }
    if (m.pbs.length) {
      out += '<div style="margin-top:14px">' + m.pbs.map(function (p) {
        return '<div class="pb">Neuer Benchmark! ' + esc(p.name) + ': ' + fmtKg(p.from) + ' → ' + fmtKg(p.to) + ' kg</div>' +
          (p.prize ? '<div class="voucher"><span class="small">Gutschein erhalten:</span><br><b>' + esc(p.prize) + '</b></div>' : '');
      }).join('') + '</div>';
    }
    return out + '<div class="btns"><button class="btn primary block" data-a="done-ok">Super</button></div>';
  }

  // ================================================================
  // Views: Go-Modus
  // ================================================================
  function startTraining(planId) {
    if (S.active) {
      if (S.active.planId !== planId) toast('Es läuft schon ein Training');
      go('#/go');
      return;
    }
    var p = planById(planId);
    if (!p) return;
    if (!p.blocks.length) { toast('Dieses Training hat noch keine Übungen'); return; }
    S.active = { planId: p.id, startTs: Date.now(), blocks: instantiate(p), timer: { len: 90, endsAt: null, done: false } };
    save();
    go('#/go');
  }

  function setInputs(blocks, b, bi, ri, si, s, label, showName, isLive) {
    var k = 'data-b="' + bi + '" data-r="' + ri + '" data-s="' + si + '"';
    var out = showName ? '<div class="goex">' + esc(s.name) + '</div>' : '';
    out += '<div class="goset"><span class="lbl">' + label + '</span>';
    if (s.mode === 'bw') out += '<div class="w"><div class="bwbox">Körpergewicht</div></div>';
    else {
      out += '<div class="w"><input class="inp' + (s.actualKg !== '' ? ' filled' : '') + '" inputmode="decimal" data-in="g-kg" ' + k +
        ' value="' + esc(s.actualKg) + '" placeholder="' + (s.plannedKg === null ? '' : fmtKg(s.plannedKg)) + '"><span class="unit">kg</span></div>';
    }
    out += '<div class="r"><input class="inp' + (s.actualReps !== '' ? ' filled' : '') + '" inputmode="numeric" pattern="[0-9]*" data-in="g-reps" ' + k +
      ' value="' + esc(s.actualReps) + '" placeholder="' + esc(s.reps) + '"><span class="unit">Wdh</span></div>';
    out += '<button class="mini del" data-a="g-del-set" data-b="' + bi + '" data-r="' + ri + '">✕</button></div>';
    var ex = exById(s.exId);
    if (ex && ex.perSide && s.mode !== 'bw') out += '<div class="side" id="side-' + bi + '-' + ri + '-' + si + '">' + sideText(s) + '</div>';
    return out;
  }
  function sideText(s) {
    var kg = num(s.actualKg);
    if (kg === null) kg = s.plannedKg;
    return kg === null ? '' : 'je Seite ' + fmtKg(kg / 2) + ' kg';
  }

  function setsHtml(blocks) {
    return blocks.map(function (b, bi) {
      var multi = b.type === 'multi';
      var out = '<div class="block' + (multi ? ' multi' : '') + '"><div class="block-head"><div class="t">' +
        (multi ? '<span style="color:var(--lila)">Multiset</span> <span class="small muted">' + b.items.map(function (it, i) { return LETTERS[i] + ' ' + esc(it.name); }).join(' · ') + '</span>'
          : esc(b.items[0].name)) + '</div></div>';
      b.rounds.forEach(function (r, ri) {
        r.sets.forEach(function (s, si) {
          out += setInputs(blocks, b, bi, ri, si, s, multi ? LETTERS[si] + (ri + 1) : (ri + 1), multi);
        });
        if (multi && ri < b.rounds.length - 1) out += '<div style="border-top:1px dashed var(--line);margin:6px 0 10px"></div>';
      });
      if (!b.rounds.length) out += '<div class="hint">Keine Sätze.</div>';
      out += '<button class="btn sm" style="margin-top:4px" data-a="g-add-set" data-b="' + bi + '">' + (multi ? '+ Runde' : '+ Satz') + '</button></div>';
      return out;
    }).join('');
  }

  function vGo() {
    var a = S.active, p = planById(a.planId);
    var t = a.timer;
    var head = '<div class="gohead"><div class="top"><a class="iconbtn" href="#/" aria-label="Zurück">‹</a>' +
      '<div class="grow"><div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p ? p.name : 'Training') + '</div>' +
      '<div class="clock" id="clock">' + hhmm(new Date()) + ' Uhr</div></div>' +
      '<div class="dur" id="dur" style="flex:none">0:00</div></div>' +
      '<div class="timer" id="timer"><span class="tv" id="tv">' + fmtClock(t.len) + '</span>' +
      '<button class="q" data-a="t-adj" data-s="-15">−15</button><button class="q" data-a="t-adj" data-s="15">+15</button>' +
      '<button class="q" data-a="t-set" data-s="60">60</button><button class="q" data-a="t-set" data-s="90">90</button><button class="q" data-a="t-set" data-s="120">120</button>' +
      '<button class="ss" id="tss" data-a="t-toggle">Start</button></div></div>';
    var foot = '<div class="gofoot"><button class="btn danger" data-a="go-discard" style="flex:.6">Verwerfen</button>' +
      '<button class="btn primary" data-a="go-finish">Training beenden</button></div>';
    return head + '<div class="page go">' + setsHtml(a.blocks) + '</div>' + foot;
  }

  function finishTraining() {
    var a = S.active;
    var empty = 0;
    eachSet(a.blocks, function (s) { if (num(s.actualReps) === null) empty++; });
    var msg = 'Training beenden?' + (empty ? '\n\n' + empty + ' Satz/Sätze ohne Wdh. werden mit 0 gespeichert.' : '');
    if (!confirm(msg)) return;
    var p = planById(a.planId);
    var start = new Date(a.startTs);
    var blocks = finalizeBlocks(a.blocks);
    var se = {
      id: uid(), planId: a.planId, planName: p ? p.name : 'Training', date: dstr(start), start: hhmm(start),
      durationSec: Math.round((Date.now() - a.startTs) / 1000), bodyweight: S.settings.bodyweight, blocks: blocks
    };
    var pbs = applyProgression(blocks, se.date);
    var intro = drawRewards(pbs, se.date);
    S.sessions.push(se);
    S.active = null;
    save();
    location.hash = '#/';
    openModal({ type: 'done', planName: se.planName, duration: se.durationSec, volume: sessionVolume(se), pbs: pbs, intro: intro });
  }

  // ---------- Timer ----------
  var actx = null, beeped = false;
  function unlockAudio() {
    try {
      if (!actx) { var C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
      if (actx && actx.state === 'suspended') actx.resume();
    } catch (e) { /* kein Ton */ }
  }
  function beep() {
    if (!actx) return;
    try {
      [0, 0.35, 0.7].forEach(function (off) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, actx.currentTime + off);
        g.gain.exponentialRampToValueAtTime(0.5, actx.currentTime + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + off + 0.25);
        o.connect(g); g.connect(actx.destination);
        o.start(actx.currentTime + off); o.stop(actx.currentTime + off + 0.3);
      });
    } catch (e) { /* ignore */ }
  }

  function tick() {
    if (route()[0] !== 'go' || !S.active) return;
    var a = S.active, now = Date.now();
    var c = document.getElementById('clock'); if (c) c.textContent = hhmm(new Date()) + ' Uhr';
    var d = document.getElementById('dur'); if (d) d.textContent = fmtClock((now - a.startTs) / 1000);
    var t = a.timer, tv = document.getElementById('tv'), box = document.getElementById('timer'), ss = document.getElementById('tss');
    if (!tv) return;
    if (t.endsAt) {
      var left = (t.endsAt - now) / 1000;
      if (left <= 0) {
        t.endsAt = null; t.done = true; save();
        if (!beeped) { beeped = true; beep(); }
      } else {
        tv.textContent = fmtClock(Math.ceil(left));
        box.className = 'timer run'; ss.textContent = 'Stopp';
        return;
      }
    }
    tv.textContent = t.done ? '0:00' : fmtClock(t.len);
    box.className = 'timer' + (t.done ? ' done' : '');
    ss.textContent = 'Start';
  }
  setInterval(tick, 500);

  // ================================================================
  // Views: Nachtragen / Bearbeiten
  // ================================================================
  function vDraft(mode, id) {
    var key = mode + '/' + id;
    if (draftKey !== key) {
      draftKey = key;
      if (mode === 'log') {
        var p = planById(id);
        if (!p) { go('#/plans'); return ''; }
        if (!p.blocks.length) { toast('Dieses Training hat noch keine Übungen'); go('#/plans'); return ''; }
        draft = { mode: 'log', planId: p.id, planName: p.name, date: today(), start: '18:00', durMin: '60', blocks: instantiate(p) };
      } else {
        var se = sessionById(id);
        if (!se) { go('#/sessions'); return ''; }
        draft = { mode: 'edit', id: se.id, planName: se.planName, date: se.date, start: se.start, durMin: String(Math.round(se.durationSec / 60)), blocks: toEditable(clone(se.blocks)) };
      }
    }
    var d = draft;
    var out = '<div class="card"><div style="font-size:20px;font-weight:800;margin-bottom:10px">' + esc(d.planName) + '</div>' +
      '<label class="f"><span>Datum</span><input class="inp" type="date" data-in="d-date" value="' + d.date + '" max="' + today() + '"></label>' +
      '<div class="two"><label class="f"><span>Startzeit</span><input class="inp" type="time" data-in="d-start" value="' + esc(d.start) + '"></label>' +
      '<label class="f"><span>Dauer (min)</span><input class="inp" inputmode="numeric" data-in="d-dur" value="' + esc(d.durMin) + '"></label></div>' +
      (mode === 'edit' ? '<div class="hint">Änderungen hier passen keine Benchmarks an.</div>' : '<div class="hint">Leere Wdh. zählen als 0, leeres Gewicht als Soll.</div>') +
      '</div>' + setsHtml(d.blocks) +
      '<div class="btns" style="margin-top:18px"><button class="btn primary block" data-a="d-save">Speichern</button></div>';
    var back = mode === 'log' ? '#/plans' : '#/session/' + d.id;
    return header(mode === 'log' ? 'Nachtragen' : 'Bearbeiten', { back: back }) + '<div class="page">' + out + '</div>';
  }

  function saveDraft() {
    var d = draft;
    if (!d.date || d.date > today()) { toast('Bitte ein gültiges Datum wählen'); return; }
    var dur = num(d.durMin); dur = dur === null ? 0 : Math.max(0, dur);
    var blocks = finalizeBlocks(d.blocks);
    if (d.mode === 'log') {
      if (!confirm('Training speichern?')) { toEditable(blocks); return; }
      var se = { id: uid(), planId: d.planId, planName: d.planName, date: d.date, start: d.start || '00:00',
        durationSec: Math.round(dur * 60), bodyweight: S.settings.bodyweight, blocks: blocks };
      var pbs = applyProgression(blocks, d.date);
      var intro = drawRewards(pbs, d.date);
      S.sessions.push(se);
      save();
      location.hash = '#/';
      openModal({ type: 'done', planName: se.planName, duration: se.durationSec, volume: sessionVolume(se), pbs: pbs, intro: intro });
    } else {
      var s = sessionById(d.id);
      s.date = d.date; s.start = d.start || s.start; s.durationSec = Math.round(dur * 60); s.blocks = blocks;
      save();
      toast('Gespeichert');
      location.hash = '#/session/' + s.id;
    }
  }

  // ================================================================
  // Views: Alle Trainings / Detail
  // ================================================================
  function vSessions() {
    var st = planStats();
    var list = S.sessions.slice().sort(function (a, b) { return sessionSortKey(a) < sessionSortKey(b) ? 1 : -1; });
    var out = '<div class="small muted" style="margin:0 4px 12px">' + list.length + ' Trainings · ' + st.x + ' von ' + st.y + ' nach Plan · ' + st.z + ' außerhalb</div>';
    if (!list.length) out += '<div class="empty">Noch keine Trainings absolviert.</div>';
    list.forEach(function (se) {
      out += '<a class="list-item" href="#/session/' + se.id + '" style="text-decoration:none;color:inherit"><div class="grow">' +
        '<div class="small muted">' + fmtDate(se.date, true) + ' · ' + esc(se.start) + '</div>' +
        '<div class="t">' + esc(se.planName) + (st.inPlan[se.id] ? '' : ' <span class="tag extra">außerhalb Plan</span>') + '</div>' +
        '<div class="small muted">' + fmtMin(se.durationSec) + ' · ' + fmtNum(sessionVolume(se)) + ' kg</div></div><span class="chev">›</span></a>';
    });
    return header('Alle Trainings') + '<div class="page">' + out + '</div>' + tabs('');
  }

  function vSession(id) {
    var se = sessionById(id);
    if (!se) { go('#/sessions'); return ''; }
    var st = planStats();
    var out = '<div class="card"><div class="small muted">' + fmtDate(se.date, true) + ' · ' + esc(se.start) + ' Uhr</div>' +
      '<div style="font-size:22px;font-weight:800;margin:2px 0 6px">' + esc(se.planName) + '</div>' +
      '<div class="row wrap"><span class="tag">' + fmtMin(se.durationSec) + '</span><span class="tag">' + fmtNum(sessionVolume(se)) + ' kg</span>' +
      (st.inPlan[se.id] ? '<span class="tag">nach Plan</span>' : '<span class="tag extra">außerhalb Plan</span>') + '</div></div>';
    se.blocks.forEach(function (b) {
      var multi = b.type === 'multi';
      out += '<div class="block' + (multi ? ' multi' : '') + '"><div class="block-head"><div class="t">' +
        (multi ? '<span style="color:var(--lila)">Multiset</span>' : esc(b.items[0].name)) + '</div></div>';
      b.rounds.forEach(function (r, ri) {
        r.sets.forEach(function (s, si) {
          var w = s.mode === 'bw' ? 'Körpergewicht' : fmtKg(s.actualKg) + ' kg';
          out += '<div class="row" style="padding:5px 0;border-bottom:1px dashed var(--line)"><span class="lbl" style="width:34px;font-weight:800;color:var(--soft)">' +
            (multi ? LETTERS[si] + (ri + 1) : ri + 1) + '</span><span class="grow">' + (multi ? '<span class="small muted">' + esc(s.name) + '</span><br>' : '') +
            '<b>' + w + ' × ' + s.actualReps + '</b></span><span class="small faint">Soll ' + (s.plannedKg !== null ? fmtKg(s.plannedKg) + ' kg × ' : '') + esc(s.reps || '–') + '</span></div>';
        });
      });
      out += '</div>';
    });
    out += '<div class="btns"><a class="btn" href="#/session/' + se.id + '/edit">Bearbeiten</a><button class="btn danger" data-a="ses-del" data-id="' + se.id + '">Löschen</button></div>';
    return header('Training', { back: '#/sessions' }) + '<div class="page">' + out + '</div>';
  }

  // ================================================================
  // Views: Analyse
  // ================================================================
  function vAnalyse() {
    var out = '<div class="card"><h2>Bewegtes Gewicht pro Einheit</h2>' + planPills() + volumeChart(200) + '</div>';

    var groups = {};
    S.sessions.forEach(function (se) {
      var g = groups[se.planId] = groups[se.planId] || { name: se.planName, sum: 0, n: 0 };
      g.sum += se.durationSec; g.n++;
      var p = planById(se.planId); if (p) g.name = p.name;
    });
    var keys = Object.keys(groups);
    var maxAvg = 1;
    keys.forEach(function (k) { groups[k].avg = groups[k].sum / groups[k].n; maxAvg = Math.max(maxAvg, groups[k].avg); });
    out += '<div class="card"><h2>Ø Trainingsdauer</h2>' + (keys.length ? keys.map(function (k) {
      var g = groups[k];
      return '<div class="bar-row"><span class="n">' + esc(g.name) + '</span><span class="b"><i style="width:' + Math.round(g.avg / maxAvg * 100) + '%"></i></span><span class="v">' + Math.round(g.avg / 60) + ' min</span></div>';
    }).join('') : '<div class="empty">Noch keine Daten</div>') + '</div>';

    var exs = S.exercises.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    if (!anaEx || !exById(anaEx)) anaEx = exs.length ? exs[0].id : null;
    out += '<div class="card"><h2>Benchmark-Verlauf</h2>';
    if (anaEx) {
      var e = exById(anaEx);
      out += '<div class="pills">' + exs.map(function (x) {
        return '<button class="pill ' + (x.id === anaEx ? 'on' : '') + '" data-a="ana-ex" data-id="' + x.id + '">' + esc(x.name) + '</button>';
      }).join('') + '</div>';
      // pro Tag letzter Wert
      var byDay = [];
      e.history.forEach(function (h) {
        if (byDay.length && byDay[byDay.length - 1].date === h.date) byDay[byDay.length - 1] = h; else byDay.push(h);
      });
      out += lineChart(byDay.map(function (h) { return { label: fmtDate(h.date), y: h.value }; }), 190, 'bm');
      var first = e.history[0] ? e.history[0].value : e.benchmark;
      out += '<div class="row" style="margin-top:8px"><span class="muted grow">Start ' + fmtKg(first) + ' kg</span><b>Jetzt ' + fmtKg(e.benchmark) + ' kg</b>' +
        (first > 0 ? '<span class="tag">+' + fmtKg(Math.round((e.benchmark / first - 1) * 1000) / 10) + ' %</span>' : '') + '</div>';
    } else out += '<div class="empty">Noch keine Übungen</div>';
    out += '</div>';
    return header('Analyse', { back: '#/' }) + '<div class="page">' + out + '</div>';
  }

  // ================================================================
  // Views: Einstellungen
  // ================================================================
  function vSettings() {
    var bytes = (localStorage.getItem(KEY) || '').length * 2;
    var cur = theme().id;
    var out = '<div class="card"><h2>Layout</h2><div class="themes">' + THEMES.map(function (t) {
      return '<button class="theme-tile' + (t.id === cur ? ' on' : '') + '" data-a="theme" data-id="' + t.id + '">' +
        '<span class="pv" style="background:' + t.sw[1] + '"><span class="h" style="background:' + t.sw[0] + '"></span>' +
        '<span class="b"><span class="c" style="background:' + t.sw[2] + '"></span><span class="a" style="background:' + t.sw[3] + '"></span></span></span>' +
        '<span class="nm">' + esc(t.name) + '</span><span class="ds">' + esc(t.desc) + '</span></button>';
    }).join('') + '</div></div>' +
      '<div class="card"><h2>Körpergewicht</h2><label class="f" style="margin:0"><span>Für Körpergewicht-Sätze im Volumen (kg)</span>' +
      '<input class="inp" inputmode="decimal" data-in="bw" value="' + esc(S.settings.bodyweight === null ? '' : fmtKg(S.settings.bodyweight)) + '" placeholder="z. B. 60"></label></div>' +
      '<div class="card"><h2>Backup</h2><div class="small muted" style="margin-bottom:10px">Alle Daten liegen nur auf diesem Handy. Ab und zu ein Backup machen und z. B. in iCloud oder per Nachricht sichern.</div>' +
      '<div class="btns"><button class="btn primary" data-a="export">Backup exportieren</button><button class="btn" data-a="import">Backup laden</button></div>' +
      '<input type="file" id="import-file" accept=".json,application/json" style="display:none"></div>' +
      '<div class="card"><h2>Speicher</h2><div class="muted">Daten: ' + (bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (Math.round(bytes / 1024 / 102.4) / 10).toString().replace('.', ',') + ' MB') +
      ' · ' + S.exercises.length + ' Übungen · ' + S.sessions.length + ' Trainings</div></div>';
    return header('Einstellungen') + '<div class="page">' + out + '</div>' + tabs('');
  }

  function exportData() {
    var data = JSON.stringify(S);
    var name = 'ninas-gymlog-backup-' + today() + '.json';
    var file = null;
    try { file = new File([data], name, { type: 'application/json' }); } catch (e) { /* alt */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Ninas Gymlog Backup' }).catch(function () { /* abgebrochen */ });
      return;
    }
    var url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var d;
      try { d = JSON.parse(fr.result); } catch (e) { toast('Datei ist kein gültiges Backup'); return; }
      if (!d || !Array.isArray(d.exercises) || !Array.isArray(d.sessions)) { toast('Datei ist kein gültiges Backup'); return; }
      if (!confirm('Backup laden?\n\nDas überschreibt ALLE aktuellen Daten auf diesem Handy.')) return;
      S = migrate(d);
      save();
      applyTheme();
      toast('Backup geladen');
      go('#/');
    };
    fr.readAsText(file);
  }

  // ================================================================
  // Events
  // ================================================================
  function curBlocks() { return route()[0] === 'go' ? S.active.blocks : draft.blocks; }
  function persistBlocks() { if (route()[0] === 'go') save(); }

  function openPicker(onPick) {
    openModal({ type: 'picker', q: '', focus: false, onPick: onPick });
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-a]');
    if (!el) return;
    var a = el.getAttribute('data-a');
    var ds = el.dataset;
    var bi = +ds.b, ri = +ds.r;

    switch (a) {
      case 'menu': menuOpen = !menuOpen; render(); break;
      case 'menu-close': menuOpen = false; render(); break;
      case 'modal-back': if (ev.target === el && modal && modal.type !== 'done') closeModal(); break;
      case 'modal-close': closeModal(); break;
      case 'open-analyse': go('#/analyse'); break;
      case 'chart-plan': chartPlan = ds.p; render(); break;
      case 'ana-ex': anaEx = ds.id; render(); break;

      // Trainings
      case 'go-start': unlockAudio(); startTraining(ds.plan); break;
      case 'pe-day': {
        var dd = +ds.d, ix = pdraft.days.indexOf(dd);
        if (ix >= 0) pdraft.days.splice(ix, 1); else pdraft.days.push(dd);
        render(); break;
      }
      case 'pe-add-single':
        openPicker(function (id) {
          pdraft.blocks.push({ id: uid(), type: 'single', items: [{ exId: id }], rounds: [{ sets: [newSet()] }] });
          render();
        });
        break;
      case 'pe-add-multi':
        openPicker(function (id) {
          pdraft.blocks.push({ id: uid(), type: 'multi', items: [{ exId: id }], rounds: [{ sets: [newSet()] }] });
          render();
          toast('Jetzt weitere Übung ins Multiset');
        });
        break;
      case 'pe-add-item':
        openPicker(function (id) {
          var b = pdraft.blocks[bi];
          b.items.push({ exId: id });
          b.rounds.forEach(function (r) { r.sets.push(newSet()); });
          render();
        });
        break;
      case 'pe-del-item': {
        var b1 = pdraft.blocks[bi], ii = +ds.i;
        b1.items.splice(ii, 1);
        b1.rounds.forEach(function (r) { r.sets.splice(ii, 1); });
        if (!b1.items.length) pdraft.blocks.splice(bi, 1);
        render(); break;
      }
      case 'pe-up': if (bi > 0) { var t1 = pdraft.blocks[bi]; pdraft.blocks[bi] = pdraft.blocks[bi - 1]; pdraft.blocks[bi - 1] = t1; render(); } break;
      case 'pe-down': if (bi < pdraft.blocks.length - 1) { var t2 = pdraft.blocks[bi]; pdraft.blocks[bi] = pdraft.blocks[bi + 1]; pdraft.blocks[bi + 1] = t2; render(); } break;
      case 'pe-del': if (confirm('Block entfernen?')) { pdraft.blocks.splice(bi, 1); render(); } break;
      case 'pe-add-set': {
        var b2 = pdraft.blocks[bi];
        var last = b2.rounds[b2.rounds.length - 1];
        b2.rounds.push(last ? clone(last) : { sets: b2.items.map(newSet) });
        render(); break;
      }
      case 'pe-del-set': pdraft.blocks[bi].rounds.splice(ri, 1); render(); break;
      case 'pe-save': savePlan(); break;
      case 'pe-delete': {
        if (!confirm('Training „' + pdraft.name + '“ löschen?\n\nAbsolvierte Einheiten und die bisherige Soll-Zählung bleiben erhalten.')) break;
        var p = planById(pdraft.id);
        if (p) p.deletedAt = today();
        if (S.active && S.active.planId === pdraft.id) S.active = null;
        save(); go('#/plans'); break;
      }

      // Benchmarks
      case 'ex-new': openModal({ type: 'ex', id: null }); break;
      case 'ex-edit': openModal({ type: 'ex', id: ds.id }); break;
      case 'exm-round': readExForm(); modal.form.rounding = +ds.v; renderModal(); break;
      case 'exm-brz': {
        readExForm();
        var r1 = brzycki(num(modal.form.bkg), num(modal.form.breps));
        if (r1 === null) { toast('kg und Wdh. (1–36) eingeben'); break; }
        modal.form.benchmark = fmtKg(round05(r1));
        renderModal(); toast('Benchmark: ' + fmtKg(round05(r1)) + ' kg'); break;
      }
      case 'exm-save': saveExercise(); break;
      case 'exm-del': {
        var e = exById(modal.id);
        if (!e || exerciseInPlans(e.id)) break;
        if (!confirm('Übung „' + e.name + '“ löschen?')) break;
        S.exercises = S.exercises.filter(function (x) { return x.id !== e.id; });
        save(); closeModal(); render(); break;
      }
      case 'pk-pick': { var cb = modal.onPick; closeModal(); cb(ds.id); break; }
      case 'pk-new': {
        var cb2 = modal.onPick, nm = (modal.q || '').trim();
        openModal({ type: 'ex', id: null, name: nm, onSave: cb2 });
        break;
      }

      // Go
      case 't-set': {
        var tm = S.active.timer; tm.len = +ds.s; tm.done = false;
        if (tm.endsAt) tm.endsAt = Date.now() + tm.len * 1000;
        save(); tick(); break;
      }
      case 't-adj': {
        var tm2 = S.active.timer, delta = +ds.s;
        tm2.len = Math.max(15, tm2.len + delta); tm2.done = false;
        if (tm2.endsAt) tm2.endsAt = Math.max(Date.now() + 1000, tm2.endsAt + delta * 1000);
        save(); tick(); break;
      }
      case 't-toggle': {
        unlockAudio();
        var tm3 = S.active.timer;
        if (tm3.endsAt) tm3.endsAt = null;
        else { tm3.endsAt = Date.now() + tm3.len * 1000; beeped = false; }
        tm3.done = false;
        save(); tick(); break;
      }
      case 'g-add-set': {
        var bl = curBlocks()[bi];
        var lr = bl.rounds[bl.rounds.length - 1];
        var nr;
        if (lr) { nr = clone(lr); nr.sets.forEach(function (s) { s.actualReps = ''; s.actualKg = ''; }); }
        else nr = { sets: bl.items.map(function (it) { return { exId: it.exId, name: it.name, mode: 'fixed', pct: null, plannedKg: null, reps: '', actualReps: '', actualKg: '' }; }) };
        bl.rounds.push(nr);
        persistBlocks(); render(); break;
      }
      case 'g-del-set': {
        if (!confirm('Satz entfernen?')) break;
        curBlocks()[bi].rounds.splice(ri, 1);
        persistBlocks(); render(); break;
      }
      case 'go-finish': finishTraining(); break;
      case 'go-discard':
        if (confirm('Training verwerfen?\n\nAlle Eingaben dieses Trainings gehen verloren.')) { S.active = null; save(); go('#/'); }
        break;
      case 'done-ok': closeModal(); render(); break;

      // Entwürfe
      case 'd-save': saveDraft(); break;
      case 'ses-del':
        if (confirm('Dieses Training löschen?\n\nBenchmarks bleiben unverändert.')) {
          S.sessions = S.sessions.filter(function (x) { return x.id !== ds.id; });
          save(); go('#/sessions');
        }
        break;

      // Einstellungen
      case 'theme': S.settings.theme = ds.id; save(); applyTheme(); render(); break;
      case 'export': exportData(); break;
      case 'import': document.getElementById('import-file').click(); break;
    }
  });

  document.addEventListener('input', function (ev) {
    var el = ev.target, k = el.getAttribute('data-in');
    if (!k) return;
    var ds = el.dataset, bi = +ds.b, ri = +ds.r, si = +ds.s, v = el.value;
    switch (k) {
      case 'pe-name': pdraft.name = v; break;
      case 'pe-val': {
        var s = pdraft.blocks[bi].rounds[ri].sets[si];
        s.value = v;
        var c = document.getElementById('calc-' + bi + '-' + ri + '-' + si);
        if (c) c.textContent = calcText(s, exById(pdraft.blocks[bi].items[si].exId));
        break;
      }
      case 'pe-reps': pdraft.blocks[bi].rounds[ri].sets[si].reps = v; break;
      case 'g-kg': case 'g-reps': {
        var st = curBlocks()[bi].rounds[ri].sets[si];
        if (k === 'g-kg') st.actualKg = v; else st.actualReps = v;
        el.className = 'inp' + (v !== '' ? ' filled' : '');
        var sd = document.getElementById('side-' + bi + '-' + ri + '-' + si);
        if (sd) sd.textContent = sideText(st);
        persistBlocks(); break;
      }
      case 'd-date': draft.date = v; break;
      case 'd-start': draft.start = v; break;
      case 'd-dur': draft.durMin = v; break;
      case 'pk-q': modal.q = v; document.getElementById('pk-list').innerHTML = pickerList(); break;
      case 'bw': { var n = num(v); S.settings.bodyweight = n === null ? null : n; save(); break; }
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.getAttribute('data-in') === 'pe-mode') {
      var s = pdraft.blocks[+el.dataset.b].rounds[+el.dataset.r].sets[+el.dataset.s];
      s.mode = el.value;
      if (s.mode === 'bw') s.value = '';
      render();
    } else if (el.id === 'import-file' && el.files && el.files[0]) {
      importFile(el.files[0]);
      el.value = '';
    }
  });

  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  // ================================================================
  // Start
  // ================================================================
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline-Cache optional */ });
  }
  applyTheme();
  render();
})();
