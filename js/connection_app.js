'use strict';

// ── Link type registry ─────────────────────────────────────────────────────────

const LINK_TYPES = {
  theme:    { key: 'theme',    label: 'Theme',    icon: '🎨' },
  period:   { key: 'period',   label: 'Period',   icon: '⏳' },
  place:    { key: 'place',    label: 'Place',    icon: '📍' },
  material: { key: 'material', label: 'Material', icon: '🧱' },
  date:     { key: 'date',     label: 'Date',     icon: '📅' },
};
const LINK_TYPE_ORDER = ['theme', 'period', 'place', 'material', 'date'];

// ── Title fuzzy matching (same algorithm as themes_app.js) ─────────────────────

const CONN_STOP = new Set([
  'the','a','an','of','and','or','in','on','at','to','for','with','by','from',
  'is','are','was','were','its','it','this','that','as',
  'de','des','du','la','le','les','el','los','las',
]);

function connNorm(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics (ö→o, à→a)
    .replace(/[''"""]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function connWords(s) {
  return connNorm(s).split(' ').filter(w => w.length >= 2 && !CONN_STOP.has(w));
}
function _connScoreRaw(userInput, title) {
  const uw = connWords(userInput);
  const tw = connWords(title);
  if (!uw.length || !tw.length) return 0;
  let hits = 0;
  for (const u of uw) {
    if (tw.some(t => t === u || t.startsWith(u) || u.startsWith(t))) hits++;
  }
  return hits / Math.max(uw.length, Math.ceil(tw.length * 0.4));
}
function connMatchScore(userInput, artTitle) {
  // Also score against the title with parenthetical subtitle stripped,
  // so "The Oxbow" matches "The Oxbow (View from Mount Holyoke, ...)"
  const short = artTitle.replace(/\s*\(.*?\)/g, '').trim();
  const s1 = _connScoreRaw(userInput, artTitle);
  return short === artTitle ? s1 : Math.max(s1, _connScoreRaw(userInput, short));
}
function connBestRaw(userText, artworks, usedIds) {
  if (!userText.trim()) return 0;
  let best = 0;
  for (const a of artworks) {
    if (usedIds.has(a.id)) continue;
    const s = connMatchScore(userText, a.title);
    if (s > best) best = s;
  }
  return best;
}
function connSubClose(userText, artworks, usedIds) {
  const q = connNorm(userText.trim());
  if (q.length < 3) return false;
  return artworks.some(a => !usedIds.has(a.id) && connNorm(a.title).includes(q));
}
function connFindBest(userText, artworks, usedIds) {
  if (!userText.trim()) return null;
  let best = null, bestScore = 0;
  for (const a of artworks) {
    if (usedIds.has(a.id)) continue;
    const s = connMatchScore(userText, a.title);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  if (bestScore >= 0.5 && best) { usedIds.add(best.id); return best; }
  return null;
}

// ── Data parsers ───────────────────────────────────────────────────────────────

const MAT_STOP = new Set(['and','or','with','on','in','the','a','an','of','from','by','its','as','into']);
const PLACE_SKIP = new Set([
  // Temporal qualifiers
  'near', 'modern', 'formerly', 'now', 'ancient', 'currently', 'once', 'former',
  // Generic place-type words (cause cross-region false positives)
  'city', 'province', 'valley', 'region', 'district', 'county', 'town', 'village',
  // Articles / conjunctions that slip through comma-splitting
  'the', 'and', 'between', 'from', 'for', 'with',
  // Cardinal directions (too generic without their accompanying proper noun)
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'central',
  // Common adjectives that modify but don't identify location
  'new', 'great', 'upper', 'lower', 'old', 'minor',
  // Institution words (Global Contemporary works list museum names as their place)
  'museum', 'art', 'national', 'gallery', 'institute', 'collection', 'collections',
  'park', 'memorial', 'studio',
]);

// Terms that all represent the same material family; any one of them adds 'ceramic'
const CERAMIC_TOKENS = new Set(['clay','cotta','porcelain','stoneware','earthenware','faience','ceramic']);

function parseMaterials(str) {
  if (!str) return [];
  const tokens = str
    .replace(/\(.*?\)/g, '')
    .split(/[;,]/)
    .flatMap(s => s.trim().split(/\s+/))
    .map(w => w.toLowerCase().replace(/[^a-z]/g, ''))
    .filter(w => w.length > 2 && !MAT_STOP.has(w));
  // Add shared 'ceramic' token so terra-cotta, clay, porcelain, etc. all connect
  if (tokens.some(w => CERAMIC_TOKENS.has(w)) && !tokens.includes('ceramic')) {
    tokens.push('ceramic');
  }
  return tokens;
}

function parsePlaceNouns(str) {
  if (!str) return [];
  return str
    .replace(/\s*\(.*?\)/g, '')
    .split(',')
    .flatMap(s => s.trim().split(/\s+/))
    .map(w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, ''))
    .filter(w => w.length > 2 && !PLACE_SKIP.has(w));
}

// ── Geographic region overlay ──────────────────────────────────────────────────
// Some content areas contain isolated artworks whose specific place nouns
// don't overlap with any other artwork (e.g., Rapa Nui, Zimbabwe, Mali).
// We inject a shared region token so these artworks can still connect via Place.

const AREA_REGION_TOKEN = {
  'Africa':  'africa',
  'Pacific': 'pacific',
};

function getRegionToken(art) {
  return AREA_REGION_TOKEN[getPeriodLeft(art)] || null;
}

function getPeriodLeft(art) {
  return (art.period_culture_style || '').split(';')[0].trim();
}

function formatYear(y) {
  if (y < 0) return `${Math.abs(y).toLocaleString()} B.C.E.`;
  return `${y.toLocaleString()} C.E.`;
}

// ── Theme membership ───────────────────────────────────────────────────────────

function buildThemeMembership() {
  const map = {};
  for (const [key, theme] of Object.entries(THEMES_DATA)) {
    for (const id of (theme.artworks || [])) {
      if (!map[id]) map[id] = [];
      map[id].push(key);
    }
  }
  return map;
}

// ── Pool builders ──────────────────────────────────────────────────────────────

function getThemePool(art, themeKey, visitedIds) {
  return (THEMES_DATA[themeKey]?.artworks || [])
    .filter(id => !visitedIds.has(id))
    .map(id => ART_DATA.find(a => a.id === id))
    .filter(Boolean);
}

function getPeriodPool(art, visitedIds) {
  const period = getPeriodLeft(art);
  return ART_DATA.filter(a =>
    !visitedIds.has(a.id) && getPeriodLeft(a) === period
  );
}

function getPlacePool(art, visitedIds) {
  const nouns  = parsePlaceNouns(art.place || '');
  const region = getRegionToken(art);
  const augNouns = region ? [...nouns, region] : nouns;
  if (!augNouns.length) return [];
  return ART_DATA.filter(a => {
    if (visitedIds.has(a.id)) return false;
    const anouns  = parsePlaceNouns(a.place || '');
    const aregion = getRegionToken(a);
    const aAug    = aregion ? [...anouns, aregion] : anouns;
    return augNouns.some(n => aAug.includes(n));
  });
}

function getMaterialPool(art, visitedIds) {
  const mats = parseMaterials(art.material || '');
  if (!mats.length) return [];
  return ART_DATA.filter(a =>
    !visitedIds.has(a.id) &&
    parseMaterials(a.material || '').some(m => mats.includes(m))
  );
}

// Scale fallback expansion windows by era — older works need wider windows
// because chronological precision matters less for prehistoric / ancient art.
function _dateFallbackWindows(mid) {
  if (mid < -5000) return [1000, 3000, 10000];  // Deep prehistory
  if (mid <     0) return [300,   700,  2000];   // Ancient world (BCE)
  if (mid <  1000) return [150,   400,  1000];   // Early CE
  return [100, 200, 500];                        // Modern era (default)
}

function getDatePool(art, visitedIds) {
  // Primary window: the source artwork's own date range (overlap check)
  const lo0 = art.date_start, hi0 = art.date_end;
  let pool = ART_DATA.filter(a =>
    !visitedIds.has(a.id) &&
    a.date_end >= lo0 && a.date_start <= hi0
  );
  if (pool.length >= 3) return { pool, lo: lo0, hi: hi0 };

  // Fallback: expand outward from midpoint with era-scaled windows
  const mid = Math.round((art.date_start + art.date_end) / 2);
  for (const win of _dateFallbackWindows(mid)) {
    const lo = mid - win, hi = mid + win;
    pool = ART_DATA.filter(a =>
      !visitedIds.has(a.id) &&
      a.date_end >= lo && a.date_start <= hi
    );
    if (pool.length >= 3) return { pool, lo, hi };
  }
  return { pool: [], lo: lo0, hi: hi0 };
}

// ── Starting artwork (weighted toward essentials & top picks) ──────────────────

function pickStartArt() {
  const essentials = new Set(), topPicks = new Set();
  for (const t of Object.values(THEMES_DATA)) {
    (t.essential  || []).forEach(id => essentials.add(id));
    (t.top_picks  || []).forEach(id => topPicks.add(id));
  }
  const weighted = [];
  for (const art of ART_DATA) {
    const w = essentials.has(art.id) ? 4 : topPicks.has(art.id) ? 2 : 1;
    for (let i = 0; i < w; i++) weighted.push(art);
  }
  return weighted[Math.floor(Math.random() * weighted.length)];
}

// ── Main app ───────────────────────────────────────────────────────────────────

const ConnectionApp = {

  // ── State ──────────────────────────────────────────────────

  _chain:            [],      // [{art, linkType, linkLabel, themeKey, pts}]
  _visitedIds:       new Set(),
  _usedTypes:        new Set(),
  _cycleCount:       0,
  _score:            0,
  _currentArt:       null,
  _selectedType:     null,
  _selectedThemeKey: null,
  _currentPool:      [],
  _dateRange:        null,    // {lo, hi} when date type selected
  _themeMembership:  {},
  _liveTimer:        null,

  // ── Init ───────────────────────────────────────────────────

  init() {
    this._themeMembership = buildThemeMembership();
    this._bindEvents();
    this._initModal();
    this._startChain();
  },

  _startChain() {
    const start = pickStartArt();
    this._chain           = [{ art: start, linkType: null, linkLabel: null, themeKey: null, pts: 0 }];
    this._visitedIds      = new Set([start.id]);
    this._usedTypes       = new Set();
    this._cycleCount      = 0;
    this._score           = 0;
    this._currentArt      = start;
    this._selectedType    = null;
    this._selectedThemeKey = null;
    this._currentPool     = [];
    this._dateRange       = null;
    this._hintLevel       = 0;   // 0=none, 1=metadata shown, 2=gallery shown

    document.getElementById('screen-conn-play').classList.add('active');
    document.getElementById('screen-conn-end').classList.remove('active');

    this._renderChainBar();
    this._renderCurrentWork();
    this._renderTypeChips();
    this._updateHeader();
    this._hideChallengeArea();
  },

  // ── Event binding ──────────────────────────────────────────

  _bindEvents() {
    document.getElementById('btn-conn-link')
      .addEventListener('click', () => this._submitLink());
    document.getElementById('btn-conn-give-up')
      .addEventListener('click', () => this._endGame());
    document.getElementById('btn-conn-restart')
      .addEventListener('click', () => this._startChain());
    document.getElementById('btn-conn-hint-meta')
      .addEventListener('click', () => this._showHint(1));
    document.getElementById('btn-conn-hint-gallery')
      .addEventListener('click', () => this._showHint(2));

    const inp = document.getElementById('conn-input');
    inp.addEventListener('input', () => {
      clearTimeout(this._liveTimer);
      this._liveTimer = setTimeout(() => this._updateLive(), 280);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._submitLink(); }
    });
  },

  // ── Modal ──────────────────────────────────────────────────

  _initModal() {
    const modal = document.getElementById('conn-modal');
    document.getElementById('conn-modal-close')
      .addEventListener('click', () => this._closeModal());
    modal.querySelector('.artwork-modal-backdrop')
      .addEventListener('click', () => this._closeModal());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._closeModal();
    });
  },

  _openModal(art) {
    const modal = document.getElementById('conn-modal');
    document.getElementById('conn-modal-img').src = art.image_url;
    document.getElementById('conn-modal-img').alt = art.title;
    document.getElementById('conn-modal-title').textContent = art.title;
    document.getElementById('conn-modal-badge').textContent = getPeriodLeft(art);

    const meta = document.getElementById('conn-modal-meta');
    meta.innerHTML = '';
    [['Artist', art.artist], ['Date', art.dates], ['Place', art.place],
     ['Period', art.period_culture_style], ['Material', art.material]].forEach(([l, v]) => {
      if (!v || v.toLowerCase() === 'unknown') return;
      meta.innerHTML += `<dt>${this._esc(l)}</dt><dd>${this._esc(v)}</dd>`;
    });
    document.getElementById('conn-modal-sig').textContent = art.significance || '';

    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('conn-modal-close').focus();
  },

  _closeModal() {
    document.getElementById('conn-modal').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  },

  // ── Chain bar ──────────────────────────────────────────────

  _renderChainBar() {
    const track = document.getElementById('conn-chain-track');
    track.innerHTML = '';

    this._chain.forEach((entry, i) => {
      // Arrow between nodes
      if (i > 0) {
        const arrow = document.createElement('div');
        arrow.className = 'conn-chain-arrow';
        const lt = LINK_TYPES[entry.linkType];
        arrow.innerHTML = `<span>${lt.icon}</span><span class="conn-arrow-label">${lt.label}</span>`;
        track.appendChild(arrow);
      }

      // Node
      const node = document.createElement('div');
      node.className = 'conn-chain-node' + (i === this._chain.length - 1 ? ' conn-chain-node--current' : '');
      node.title = entry.art.title;

      const img = document.createElement('img');
      img.className = 'conn-chain-thumb';
      img.src = entry.art.image_url;
      img.alt = entry.art.title;
      img.loading = 'lazy';

      const lbl = document.createElement('div');
      lbl.className = 'conn-chain-label';
      lbl.textContent = entry.art.title;

      node.appendChild(img);
      node.appendChild(lbl);
      node.addEventListener('click', () => this._openModal(entry.art));
      track.appendChild(node);
    });

    // Scroll to end
    const bar = document.getElementById('conn-chain-bar');
    requestAnimationFrame(() => { bar.scrollLeft = bar.scrollWidth; });
  },

  // ── Current work panel ─────────────────────────────────────

  _renderCurrentWork() {
    const art = this._currentArt;
    document.getElementById('conn-artwork-img').src   = art.image_url;
    document.getElementById('conn-artwork-img').alt   = art.title;
    document.getElementById('conn-artwork-title').textContent = art.title;

    const meta = document.getElementById('conn-artwork-meta');
    meta.innerHTML = '';
    const fields = [
      ['Artist',   art.artist],
      ['Date',     art.dates],
      ['Place',    art.place],
      ['Period',   getPeriodLeft(art)],
      ['Material', art.material],
    ];
    fields.forEach(([label, val]) => {
      if (!val || val.toLowerCase() === 'unknown') return;
      meta.innerHTML +=
        `<dt class="conn-meta-label">${this._esc(label)}</dt>` +
        `<dd class="conn-meta-value">${this._esc(val)}</dd>`;
    });
  },

  // ── Type chips ─────────────────────────────────────────────

  _renderTypeChips() {
    const row = document.getElementById('conn-type-row');
    row.innerHTML = '';

    LINK_TYPE_ORDER.forEach(typeKey => {
      const lt      = LINK_TYPES[typeKey];
      const isUsed  = this._usedTypes.has(typeKey);
      const pool    = isUsed ? [] : this._computePoolForChip(typeKey);
      const isEmpty = pool.length === 0;

      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'conn-type-btn';
      btn.dataset.type = typeKey;
      btn.innerHTML = `${lt.icon} ${lt.label}`;

      if (isUsed) {
        btn.classList.add('conn-type-btn--used');
        btn.disabled = true;
        btn.title = 'Already used this cycle';
      } else if (isEmpty) {
        btn.classList.add('conn-type-btn--empty');
        btn.disabled = true;
        btn.title = 'No works available';
      } else {
        btn.addEventListener('click', () => this._selectType(typeKey));
        if (typeKey === this._selectedType) btn.classList.add('conn-type-btn--active');
      }

      row.appendChild(btn);
    });

    this._renderCycleDots();
    this._renderThemeSubRow();
  },

  _computePoolForChip(typeKey) {
    if (typeKey === 'theme') {
      const themes = this._themeMembership[this._currentArt.id] || [];
      // Return non-empty if ANY theme has valid works
      for (const k of themes) {
        if (getThemePool(this._currentArt, k, this._visitedIds).length > 0) return [{}];
      }
      return [];
    }
    return this._getPool(typeKey, null);
  },

  _getPool(typeKey, themeKey) {
    const art = this._currentArt;
    const vis = this._visitedIds;
    switch (typeKey) {
      case 'theme':    return themeKey ? getThemePool(art, themeKey, vis) : [];
      case 'period':   return getPeriodPool(art, vis);
      case 'place':    return getPlacePool(art, vis);
      case 'material': return getMaterialPool(art, vis);
      case 'date':     return getDatePool(art, vis).pool;
    }
    return [];
  },

  // ── Cycle dots ─────────────────────────────────────────────

  _renderCycleDots() {
    const el = document.getElementById('conn-cycle-dots');
    el.innerHTML = '';
    LINK_TYPE_ORDER.forEach(typeKey => {
      const dot = document.createElement('span');
      dot.className = 'conn-cycle-dot' +
        (this._usedTypes.has(typeKey) ? ' conn-cycle-dot--used' : '');
      const lt = LINK_TYPES[typeKey];
      dot.title = lt.label;
      el.appendChild(dot);
    });
    const lbl = document.createElement('span');
    lbl.className = 'conn-cycle-label';
    const remaining = 5 - this._usedTypes.size;
    lbl.textContent = remaining === 5
      ? 'Use all 5 types for a cycle bonus!'
      : remaining === 0
        ? '✓ Cycle complete! +25 pts'
        : `${remaining} type${remaining !== 1 ? 's' : ''} left in cycle`;
    el.appendChild(lbl);
  },

  // ── Theme sub-row ──────────────────────────────────────────

  _renderThemeSubRow() {
    const row = document.getElementById('conn-theme-sub-row');
    row.innerHTML = '';

    if (this._selectedType !== 'theme') {
      row.hidden = true;
      return;
    }

    const themes = (this._themeMembership[this._currentArt.id] || [])
      .filter(k => getThemePool(this._currentArt, k, this._visitedIds).length > 0);

    if (themes.length === 0) { row.hidden = true; return; }

    if (themes.length === 1) {
      // Auto-select the only theme — guard prevents re-entrant loop
      row.hidden = true;
      if (this._selectedThemeKey !== themes[0]) {
        this._selectTheme(themes[0]);
      }
      return;
    }

    row.hidden = false;
    const lbl = document.createElement('p');
    lbl.className = 'conn-sub-prompt';
    lbl.textContent = 'Which theme?';
    row.appendChild(lbl);

    const btnRow = document.createElement('div');
    btnRow.className = 'conn-theme-btn-row';
    themes.forEach(k => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'conn-theme-btn' + (k === this._selectedThemeKey ? ' conn-theme-btn--active' : '');
      btn.textContent = THEMES_DATA[k].label;
      btn.addEventListener('click', () => this._selectTheme(k));
      btnRow.appendChild(btn);
    });
    row.appendChild(btnRow);
  },

  // ── Type selection ─────────────────────────────────────────

  _selectType(typeKey) {
    this._selectedType    = typeKey;
    this._selectedThemeKey = null;
    this._currentPool     = [];
    this._dateRange       = null;
    this._hideChallengeArea();  // hide first, before chips render (prevents stale text flash-then-hide)
    this._renderTypeChips();   // may auto-resolve theme → _selectTheme → _renderChallenge

    if (typeKey !== 'theme') {
      // Compute pool immediately
      if (typeKey === 'date') {
        const { pool, lo, hi } = getDatePool(this._currentArt, this._visitedIds);
        this._currentPool = pool;
        this._dateRange   = { lo, hi };
      } else {
        this._currentPool = this._getPool(typeKey, null);
      }
      this._renderChallenge();
    }
    // Theme: wait for sub-selection (handled in _renderThemeSubRow → _selectTheme)
  },

  _selectTheme(themeKey) {
    this._selectedThemeKey = themeKey;
    this._currentPool      = getThemePool(this._currentArt, themeKey, this._visitedIds);
    this._renderTypeChips();  // re-render to highlight active theme btn
    this._renderChallenge();
  },

  // ── Auto-advance ───────────────────────────────────────────

  _autoSelectFirstType() {
    for (const typeKey of LINK_TYPE_ORDER) {
      if (!this._usedTypes.has(typeKey) && this._computePoolForChip(typeKey).length > 0) {
        this._selectType(typeKey); // renders chips + challenge (or theme sub-row)
        return;
      }
    }
    // All pools empty — _checkGameOver() already handled end-game;
    // just render chips so disabled state is visible.
    this._renderTypeChips();
  },

  // ── Challenge area ─────────────────────────────────────────

  _hideChallengeArea() {
    document.getElementById('conn-challenge-area').hidden = true;
    document.getElementById('conn-input').value = '';
    document.getElementById('conn-feedback').textContent = '';
    // Reset hint state so it's fresh for the next type selection
    this._hintLevel = 0;
    const hintWrap = document.getElementById('conn-hint-wrap');
    if (hintWrap) {
      hintWrap.hidden = true;
      document.getElementById('conn-hint-panel').innerHTML = '';
      const btnMeta = document.getElementById('btn-conn-hint-meta');
      btnMeta.textContent = '💡 Metadata hint';
      btnMeta.disabled = false;
      const btnGal = document.getElementById('btn-conn-hint-gallery');
      btnGal.hidden = true;
      btnGal.textContent = '🖼 Show images';
      btnGal.disabled = false;
    }
  },

  _renderChallenge() {
    const area = document.getElementById('conn-challenge-area');
    area.hidden = false;

    const art    = this._currentArt;
    const type   = this._selectedType;
    const pool   = this._currentPool;

    let challengeHTML = '';
    switch (type) {
      case 'theme':
        challengeHTML = `Enter a work with <strong>${this._esc(THEMES_DATA[this._selectedThemeKey].label)}</strong> as a central theme.`;
        break;
      case 'period':
        challengeHTML = `Enter a work from <strong>${this._esc(getPeriodLeft(art))}</strong>.`;
        break;
      case 'place': {
        const nouns  = parsePlaceNouns(art.place || '');
        const region = getRegionToken(art);
        let placeLabel;
        if (nouns.length) {
          placeLabel = nouns.join(', ');
          if (region && !nouns.includes(region)) placeLabel += `, or anywhere in ${region.charAt(0).toUpperCase() + region.slice(1)}`;
        } else if (region) {
          placeLabel = region.charAt(0).toUpperCase() + region.slice(1);
        } else {
          placeLabel = art.place || '';
        }
        challengeHTML = `Enter a work from one of the following places: <strong>${this._esc(placeLabel)}</strong>.`;
        break;
      }
      case 'material': {
        const mats = parseMaterials(art.material || '').join(', ');
        challengeHTML = `Enter a work made from one of the following: <strong>${this._esc(mats || art.material)}</strong>.`;
        break;
      }
      case 'date':
        challengeHTML = `Enter a work made between <strong>${this._esc(formatYear(this._dateRange.lo))}</strong> and <strong>${this._esc(formatYear(this._dateRange.hi))}</strong>.`;
        break;
    }

    document.getElementById('conn-challenge').innerHTML = challengeHTML;
    document.getElementById('conn-pool-hint').textContent =
      `${pool.length} work${pool.length !== 1 ? 's' : ''} qualify (not yet in your chain).`;

    // Hint availability: show button when pool is small (≤ 10)
    this._hintLevel = 0;
    const hintWrap = document.getElementById('conn-hint-wrap');
    const hintPanel = document.getElementById('conn-hint-panel');
    const btnGallery = document.getElementById('btn-conn-hint-gallery');
    hintWrap.hidden = pool.length > 10 || pool.length === 0;
    hintPanel.innerHTML = '';
    btnGallery.hidden = true;

    document.getElementById('conn-input').value = '';
    document.getElementById('conn-feedback').textContent = '';
    document.getElementById('conn-input').focus();
  },

  // ── Hint system ────────────────────────────────────────────

  _showHint(level) {
    if (level <= this._hintLevel) return;
    this._hintLevel = level;
    const panel    = document.getElementById('conn-hint-panel');
    const btnMeta  = document.getElementById('btn-conn-hint-meta');
    const btnGal   = document.getElementById('btn-conn-hint-gallery');

    if (level === 1) {
      // Metadata hint: show artist, date, and period of up to 3 random pool works
      // (titles and images deliberately withheld)
      const picks = [...this._currentPool].sort(() => Math.random() - 0.5).slice(0, 3);
      panel.innerHTML = '';
      const intro = document.createElement('p');
      intro.className = 'conn-hint-intro';
      intro.textContent = `Showing metadata for ${picks.length} matching work${picks.length > 1 ? 's' : ''} (no titles):`;
      panel.appendChild(intro);
      picks.forEach(a => {
        const card = document.createElement('div');
        card.className = 'conn-hint-card';
        card.innerHTML = `
          <dl class="conn-hint-meta">
            <dt>Artist</dt><dd>${this._esc(a.artist || 'Unknown')}</dd>
            <dt>Date</dt><dd>${this._esc(a.dates || '')}</dd>
            <dt>Period</dt><dd>${this._esc(getPeriodLeft(a))}</dd>
          </dl>`;
        panel.appendChild(card);
      });
      btnMeta.textContent = '💡 Hint shown';
      btnMeta.disabled = true;
      btnGal.hidden = false;

    } else if (level === 2) {
      // Gallery hint: show thumbnail images of all pool works (no titles)
      const intro = document.createElement('p');
      intro.className = 'conn-hint-intro';
      intro.textContent = `Visual gallery — ${this._currentPool.length} qualifying work${this._currentPool.length > 1 ? 's' : ''}:`;
      panel.appendChild(intro);
      const grid = document.createElement('div');
      grid.className = 'conn-hint-gallery';
      this._currentPool.forEach(a => {
        const img = document.createElement('img');
        img.src = a.image_url;
        img.alt = '';   // intentionally blank — title is the puzzle
        img.className = 'conn-hint-thumb';
        img.title = '';
        grid.appendChild(img);
      });
      panel.appendChild(grid);
      btnGal.textContent = '🖼 Images shown';
      btnGal.disabled = true;
    }
  },

  // ── Live feedback ──────────────────────────────────────────

  _updateLive() {
    const val     = document.getElementById('conn-input').value.trim();
    const fb      = document.getElementById('conn-feedback');
    const usedIds = new Set();  // don't consume matches in live mode

    if (!val) { fb.textContent = ''; fb.className = 'conn-feedback'; return; }

    const matched = connFindBest(val, this._currentPool, usedIds);
    if (matched) {
      fb.textContent = `✓ ${matched.title}`;
      fb.className   = 'conn-feedback conn-feedback--match';
    } else {
      const close = connBestRaw(val, this._currentPool, new Set()) >= 0.2 ||
                    connSubClose(val, this._currentPool, new Set());
      fb.textContent = close ? '~ Getting close…' : '✗ No match yet';
      fb.className   = `conn-feedback ${close ? 'conn-feedback--close' : 'conn-feedback--miss'}`;
    }
  },

  // ── Submit link ────────────────────────────────────────────

  _submitLink() {
    if (!this._selectedType) return;
    if (this._selectedType === 'theme' && !this._selectedThemeKey) return;

    const val     = document.getElementById('conn-input').value.trim();
    const usedIds = new Set();
    const matched = connFindBest(val, this._currentPool, usedIds);

    if (!matched) {
      this._shakeInput();
      document.getElementById('conn-feedback').textContent = 'No match — try another title.';
      document.getElementById('conn-feedback').className   = 'conn-feedback conn-feedback--miss';
      return;
    }

    // Calculate points
    let pts = 10;
    if (this._selectedType === 'theme' && this._selectedThemeKey) {
      const theme = THEMES_DATA[this._selectedThemeKey];
      if ((theme.essential || []).includes(matched.id))   pts += 15;
      else if ((theme.top_picks || []).includes(matched.id)) pts += 5;
    }

    // Record link
    this._chain.push({
      art:       matched,
      linkType:  this._selectedType,
      linkLabel: this._buildLinkLabel(),
      themeKey:  this._selectedThemeKey,
      pts,
    });
    this._visitedIds.add(matched.id);
    this._usedTypes.add(this._selectedType);
    this._score += pts;

    // Check cycle reset
    let cycleBonus = 0;
    if (this._usedTypes.size === 5) {
      this._usedTypes.clear();
      this._cycleCount++;
      cycleBonus = 25;
      this._score += cycleBonus;
      this._showToast(`Cycle complete! +25 pts 🎉`);
    }

    // Advance to next work
    this._currentArt       = matched;
    this._selectedType     = null;
    this._selectedThemeKey = null;
    this._currentPool      = [];
    this._dateRange        = null;

    this._updateHeader();
    this._renderChainBar();
    this._renderCurrentWork();
    this._hideChallengeArea();  // clear stale challenge instantly

    // Check game over AFTER rendering, to avoid flicker
    if (!this._checkGameOver()) {
      this._autoSelectFirstType(); // renders chips + shows fresh challenge
    }
  },

  _buildLinkLabel() {
    const type = this._selectedType;
    const art  = this._currentArt;
    switch (type) {
      case 'theme':    return THEMES_DATA[this._selectedThemeKey].label;
      case 'period':   return getPeriodLeft(art);
      case 'place': {
        const nouns  = parsePlaceNouns(art.place || '');
        const region = getRegionToken(art);
        if (nouns.length) return nouns.slice(0, 2).join(', ');
        if (region) return region.charAt(0).toUpperCase() + region.slice(1);
        return (art.place || '').replace(/\s*\(.*?\)/g, '').trim();
      }
      case 'material': return parseMaterials(art.material || '').slice(0, 2).join(', ');
      case 'date':     return `${formatYear(this._dateRange.lo)}–${formatYear(this._dateRange.hi)}`;
    }
    return '';
  },

  _shakeInput() {
    const inp = document.getElementById('conn-input');
    inp.classList.remove('conn-input--shake');
    void inp.offsetWidth;  // reflow to restart animation
    inp.classList.add('conn-input--shake');
  },

  _showToast(msg) {
    let toast = document.getElementById('conn-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'conn-toast';
      toast.className = 'conn-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('conn-toast--visible');
    setTimeout(() => toast.classList.remove('conn-toast--visible'), 2500);
  },

  // ── Game over check ────────────────────────────────────────

  _checkGameOver() {
    const availTypes = LINK_TYPE_ORDER.filter(t => !this._usedTypes.has(t));
    const anyValid = availTypes.some(t => this._computePoolForChip(t).length > 0);
    if (!anyValid) {
      this._endGame();
      return true;
    }
    return false;
  },

  // ── End game ───────────────────────────────────────────────

  _endGame() {
    const links = this._chain.length - 1;

    // Achievements
    const achievements = this._calcAchievements(links);
    const achPts       = achievements.reduce((s, a) => s + a.pts, 0);
    this._score       += achPts;

    // Render end screen
    document.getElementById('conn-end-links').textContent =
      `Chain of ${links} link${links !== 1 ? 's' : ''}`;
    document.getElementById('conn-end-score').textContent = this._score;
    document.getElementById('conn-end-cycles').textContent =
      `${this._cycleCount} cycle${this._cycleCount !== 1 ? 's' : ''} completed`;

    // Achievement list
    const achList = document.getElementById('conn-achievement-list');
    achList.innerHTML = '';
    if (achievements.length === 0) {
      achList.innerHTML = '<p class="conn-no-achievements">No achievements this time — keep chaining!</p>';
    } else {
      achievements.forEach(a => {
        const el = document.createElement('div');
        el.className = 'conn-achievement';
        el.innerHTML = `<span class="conn-ach-label">${this._esc(a.label)}</span>` +
                       `<span class="conn-ach-pts">+${a.pts} pts</span>`;
        achList.appendChild(el);
      });
    }

    // Chain replay
    this._renderChainReplay();

    document.getElementById('screen-conn-play').classList.remove('active');
    document.getElementById('screen-conn-end').classList.add('active');
  },

  _calcAchievements(links) {
    const ach = [];

    // Themes touched via theme links
    const themesUsed = new Set(
      this._chain.filter(c => c.themeKey).map(c => c.themeKey)
    );
    if (themesUsed.size >= 11) ach.push({ label: 'All 11 themes connected!', pts: 50 });

    // Content areas touched
    const periods = new Set(
      this._chain.map(c => getPeriodLeft(c.art))
    );
    if (periods.size >= 11) ach.push({ label: 'All 11 content areas!', pts: 50 });

    // Chain length
    if (links >= 30)      ach.push({ label: '30+ link chain!', pts: 100 });
    else if (links >= 20) ach.push({ label: '20+ link chain!', pts: 50 });
    else if (links >= 10) ach.push({ label: '10+ link chain!', pts: 25 });

    return ach;
  },

  _renderChainReplay() {
    const track = document.getElementById('conn-replay-track');
    track.innerHTML = '';

    this._chain.forEach((entry, i) => {
      if (i > 0) {
        const arrow = document.createElement('div');
        arrow.className = 'conn-chain-arrow conn-chain-arrow--replay';
        const lt = LINK_TYPES[entry.linkType];
        arrow.innerHTML =
          `<span class="conn-arrow-icon">${lt.icon}</span>` +
          `<span class="conn-arrow-label">${this._esc(entry.linkLabel || lt.label)}</span>`;
        track.appendChild(arrow);
      }

      const node = document.createElement('div');
      node.className = 'conn-chain-node conn-chain-node--replay';
      node.title = entry.art.title;

      const img = document.createElement('img');
      img.className = 'conn-chain-thumb conn-chain-thumb--lg';
      img.src = entry.art.image_url;
      img.alt = entry.art.title;
      img.loading = 'lazy';

      const lbl = document.createElement('div');
      lbl.className = 'conn-chain-label';
      lbl.textContent = entry.art.title;

      if (entry.pts > 10) {
        const bonus = document.createElement('div');
        bonus.className = 'conn-node-bonus';
        bonus.textContent = `+${entry.pts}`;
        node.appendChild(bonus);
      }

      node.appendChild(img);
      node.appendChild(lbl);
      node.addEventListener('click', () => this._openModal(entry.art));
      track.appendChild(node);
    });
  },

  // ── Header ─────────────────────────────────────────────────

  _updateHeader() {
    document.getElementById('conn-hdr-score').textContent = this._score;
    document.getElementById('conn-hdr-chain').textContent = this._chain.length - 1;
    document.getElementById('conn-hdr-cycles').textContent = this._cycleCount;
  },

  // ── Utility ────────────────────────────────────────────────

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

ConnectionApp.init();
