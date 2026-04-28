'use strict';

// ── Data parsing ──────────────────────────────────────────────────────────────

/**
 * Parse the period_culture_style field.
 * LEFT  (before first ';') = AP content area (11 unique values)
 * RIGHT (after first ';')  = culture/style label for mosaic sub-headings
 */
function parsePCS(art) {
  const raw = art.period_culture_style || '';
  const idx  = raw.indexOf(';');
  const left  = idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
  const right = idx >= 0 ? raw.slice(idx + 1).trim() : '';
  return { left, right };
}

/**
 * Build a lookup of content-area key → { label, artworks: [id, …] }.
 * Called once at init time.
 */
function buildPeriodsData() {
  const periods = {};
  for (const art of ART_DATA) {
    const { left } = parsePCS(art);
    if (!left) continue;
    if (!periods[left]) periods[left] = { label: left, artworks: [] };
    periods[left].artworks.push(art.id);
  }
  return periods;
}

// ── Title fuzzy matcher (same logic as themes_app.js) ─────────────────────────

const PCS_STOP = new Set(['the','a','an','of','and','or','in','on','at','to','for',
  'with','by','from','is','are','was','were','its','it','this','that','as',
  'de','des','du','la','le','les','el','los','las']);

function pcsNormTitle(s) {
  return s.toLowerCase()
    .replace(/[''"""]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pcsTitleWords(s) {
  return pcsNormTitle(s).split(' ').filter(w => w.length >= 2 && !PCS_STOP.has(w));
}

function pcsTitleMatchScore(userInput, artTitle) {
  const uWords = pcsTitleWords(userInput);
  const tWords = pcsTitleWords(artTitle);
  if (!uWords.length || !tWords.length) return 0;
  let hits = 0;
  for (const uw of uWords) {
    if (tWords.some(tw => tw === uw || tw.startsWith(uw) || uw.startsWith(tw))) hits++;
  }
  return hits / Math.max(uWords.length, Math.ceil(tWords.length * 0.4));
}

function pcsBestRawScore(userText, artworks, usedIds) {
  if (!userText.trim()) return 0;
  let best = 0;
  for (const art of artworks) {
    if (usedIds.has(art.id)) continue;
    const s = pcsTitleMatchScore(userText, art.title);
    if (s > best) best = s;
  }
  return best;
}

function pcsIsSubstringClose(userText, artworks, usedIds) {
  const q = pcsNormTitle(userText.trim());
  if (q.length < 3) return false;
  return artworks.some(art => !usedIds.has(art.id) && pcsNormTitle(art.title).includes(q));
}

function pcsFindBestMatch(userText, artworks, usedIds) {
  if (!userText.trim()) return null;
  let best = null, bestScore = 0;
  for (const art of artworks) {
    if (usedIds.has(art.id)) continue;
    const score = pcsTitleMatchScore(userText, art.title);
    if (score > bestScore) { bestScore = score; best = art; }
  }
  if (bestScore >= 0.5 && best) {
    usedIds.add(best.id);
    return best;
  }
  return null;
}

// ── Main app ──────────────────────────────────────────────────────────────────

const PCSApp = {
  deck:             null,
  sessionScore:     0,

  _periodsData:     {},
  _filterThemeKeys: new Set(),
  _currentKey:      null,
  _representativeId: null,
  _poolArts:        [],      // artworks available for recall (all minus representative)
  _results:         [],
  _liveDebounceTimer: null,
  _reviewKey:       null,

  // ── Init ─────────────────────────────────────────────────────

  init() {
    this._periodsData = buildPeriodsData();
    this._rebuildDeck();
    this._bindEvents();
    this._initTooltip();
    this._initModal();

    FilterBar.init('filter-bar', keys => this._onFilterChange(keys));

    this._showQuestion();
  },

  _onFilterChange(keys) {
    this._filterThemeKeys = keys;
    this._rebuildDeck();
    this._showQuestion();
  },

  _rebuildDeck() {
    let keys = Object.keys(this._periodsData);

    if (this._filterThemeKeys.size > 0) {
      // Build set of artwork IDs that belong to any active theme
      const allowedIds = new Set();
      for (const k of this._filterThemeKeys) {
        for (const id of (THEMES_DATA[k]?.artworks || [])) allowedIds.add(id);
      }
      // Keep only content areas that have at least one artwork in the active themes
      keys = keys.filter(k =>
        this._periodsData[k].artworks.some(id => allowedIds.has(id))
      );
    }

    if (keys.length === 0) {
      this._showFilterWarning(true);
      return;
    }
    this._showFilterWarning(false);

    this.deck = new Deck(keys.map(k => ({ id: k, title: k })));
  },

  _showFilterWarning(show) {
    const el = document.getElementById('filter-warn');
    if (!el) return;
    if (show) {
      el.textContent = 'No content areas match that filter — showing all areas.';
      el.classList.add('filter-warn--visible');
      // Fall back to full deck
      const allKeys = Object.keys(this._periodsData);
      this.deck = new Deck(allKeys.map(k => ({ id: k, title: k })));
    } else {
      el.classList.remove('filter-warn--visible');
    }
  },

  // ── Modal ──────────────────────────────────────────────────────

  _initModal() {
    const modal = document.getElementById('pcs-artwork-modal');
    document.getElementById('pcs-artwork-modal-close')
      .addEventListener('click', () => this._closeModal());
    modal.querySelector('.artwork-modal-backdrop')
      .addEventListener('click', () => this._closeModal());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._closeModal();
    });
  },

  _openModal(art) {
    const modal = document.getElementById('pcs-artwork-modal');
    document.getElementById('pcs-artwork-modal-img').src = art.image_url;
    document.getElementById('pcs-artwork-modal-img').alt = art.title;
    document.getElementById('pcs-artwork-modal-title').textContent = art.title;

    const badge = document.getElementById('pcs-artwork-modal-period-badge');
    badge.textContent = this._reviewKey || '';

    const meta = document.getElementById('pcs-artwork-modal-meta');
    meta.innerHTML = '';
    const fields = [
      ['Artist', art.artist],
      ['Date',   art.dates],
      ['Place',  art.place],
      ['Period', art.period_culture_style],
    ];
    fields.forEach(([label, val]) => {
      if (!val || val.toLowerCase() === 'unknown') return;
      meta.innerHTML +=
        `<dt>${this._esc(label)}</dt><dd>${this._esc(val)}</dd>`;
    });

    document.getElementById('pcs-artwork-modal-significance').textContent =
      art.significance || '';

    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('pcs-artwork-modal-close').focus();
  },

  _closeModal() {
    document.getElementById('pcs-artwork-modal').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  },

  // ── Tooltip ────────────────────────────────────────────────────

  _initTooltip() {
    const tooltip = document.getElementById('pcs-mosaic-tooltip');
    const MARGIN  = 12;
    const mosaic  = document.getElementById('pcs-mosaic');

    mosaic.addEventListener('mouseover', e => {
      const item = e.target.closest('.mosaic-item');
      if (!item) return;
      const card = item.querySelector('.mosaic-hover-card');
      if (!card) return;
      tooltip.innerHTML = card.innerHTML;
      tooltip.classList.add('is-visible');
    });

    mosaic.addEventListener('mousemove', e => {
      if (!tooltip.classList.contains('is-visible')) return;
      const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
      let x = e.clientX + MARGIN, y = e.clientY - th - MARGIN;
      if (x + tw > window.innerWidth) x = e.clientX - tw - MARGIN;
      if (y < 0)                       y = e.clientY + MARGIN;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = y + 'px';
    });

    mosaic.addEventListener('mouseout', e => {
      if (e.target.closest('.mosaic-item')) tooltip.classList.remove('is-visible');
    });
  },

  // ── Event binding ──────────────────────────────────────────────

  _bindEvents() {
    document.getElementById('btn-pcs-check')
      .addEventListener('click', () => this._checkAnswers());
    document.getElementById('btn-pcs-learn')
      .addEventListener('click', () => this._learnThis());
    document.getElementById('btn-pcs-next')
      .addEventListener('click', () => this._nextArea());
  },

  _bindLiveFeedback() {
    document.querySelectorAll('.pcs-input').forEach(inp => {
      inp.addEventListener('input', () => {
        clearTimeout(this._liveDebounceTimer);
        this._liveDebounceTimer = setTimeout(() => this._updateLiveFeedback(), 300);
      });
    });
  },

  _bindEnterKey() {
    const inputs = Array.from(document.querySelectorAll('.pcs-input'));
    inputs.forEach((input, i, all) => {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i < all.length - 1) all[i + 1].focus();
        else document.getElementById('btn-pcs-check').click();
      });
    });
  },

  // ── Live feedback ──────────────────────────────────────────────

  _updateLiveFeedback() {
    const inputs = Array.from(document.querySelectorAll('.pcs-input'));
    const usedIds = new Set();

    inputs.forEach((inp, i) => {
      const val     = inp.value.trim();
      const matched = pcsFindBestMatch(val, this._poolArts, usedIds);
      const num     = inp.closest('.theme-input-row').querySelector('.theme-input-num');
      const hasText = val.length > 0;

      const isClose = !matched && hasText &&
        (pcsBestRawScore(val, this._poolArts, usedIds) >= 0.2 ||
         pcsIsSubstringClose(val, this._poolArts, usedIds));

      inp.classList.toggle('live-match',    !!matched);
      inp.classList.toggle('live-close',    isClose);
      inp.classList.toggle('live-no-match', !matched && !isClose && hasText);

      num.classList.toggle('live-match', !!matched);
      num.classList.toggle('live-close', isClose);

      if (matched) {
        num.classList.remove('live-essential');
        num.textContent = '✓';
      } else if (isClose) {
        num.classList.remove('live-essential');
        num.textContent = '~';
      } else {
        num.classList.remove('live-essential');
        num.textContent = String(i + 1);
      }
    });
  },

  // ── Question screen ────────────────────────────────────────────

  _showQuestion() {
    if (!this.deck || !this.deck.current) return;

    const key  = this.deck.current.id;
    this._currentKey = key;
    const data = this._periodsData[key];
    const allArts = data.artworks.map(id => ART_DATA.find(a => a.id === id)).filter(Boolean);

    // Representative: random artwork, preferring ones that appear in any theme
    const themed = allArts.filter(a =>
      Object.values(THEMES_DATA).some(t => (t.artworks || []).includes(a.id))
    );
    const repPool = themed.length > 0 ? themed : allArts;
    const rep = repPool[Math.floor(Math.random() * repPool.length)];
    this._representativeId = rep.id;

    // Pool for recall = ALL artworks (rep is includable as an answer)
    this._poolArts = [...allArts];

    // Update UI
    document.getElementById('pcs-period-name').textContent = key;
    document.getElementById('pcs-r-period-name').textContent = key;

    // Clear the description (no curated definition — just the period name is the prompt)
    document.getElementById('pcs-period-desc').textContent = '';

    const img = document.getElementById('pcs-representative-img');
    img.src = rep.image_url;
    img.alt = rep.title;

    // Hide the title — student should try to name this work
    document.getElementById('pcs-featured-caption').textContent = 'Can you name this work?';

    // Count hint (N = total including the representative)
    document.getElementById('pcs-count-hint').innerHTML =
      `There are <strong>${allArts.length} works</strong> in this content area — name as many as you can.`;

    // Render inputs
    const inputCount = Math.min(8, allArts.length);
    this._renderInputs(inputCount);
    this._bindLiveFeedback();
    this._bindEnterKey();
    clearTimeout(this._liveDebounceTimer);

    // Reset buttons
    document.getElementById('btn-pcs-learn').textContent = 'Learn this';
    document.getElementById('btn-pcs-check').textContent = 'Check Answers';

    // Switch screen
    document.getElementById('screen-pcs-question').classList.add('active');
    document.getElementById('screen-pcs-review').classList.remove('active');

    const firstInput = document.querySelector('.pcs-input');
    if (firstInput) firstInput.focus();
  },

  _renderInputs(n) {
    const container = document.getElementById('pcs-inputs-container');
    container.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'theme-input-row';

      const num = document.createElement('span');
      num.className = 'theme-input-num';
      num.textContent = String(i + 1);

      const input = document.createElement('input');
      input.type        = 'text';
      input.className   = 'field-input theme-input pcs-input';
      input.dataset.index = String(i);
      input.placeholder = 'Artwork title…';
      input.autocomplete = 'off';
      input.spellcheck  = false;

      row.appendChild(num);
      row.appendChild(input);
      container.appendChild(row);
    }
  },

  // ── Learn mode ─────────────────────────────────────────────────

  _learnThis() {
    const learnKey  = this._currentKey;
    const learnPool = this._poolArts;
    this._results   = [];
    this.deck.advanceLearn();
    this._updateHeader();
    this._showReview(0, 0, learnKey, learnPool, true);
  },

  // ── Check answers ──────────────────────────────────────────────

  _checkAnswers() {
    const usedIds = new Set();
    this._results = [];

    document.querySelectorAll('.pcs-input').forEach(inp => {
      const userText = inp.value.trim();
      const matched  = pcsFindBestMatch(userText, this._poolArts, usedIds);
      this._results.push({ userText, matched, isCorrect: !!matched });
    });

    const maxScore = Math.min(8, this._poolArts.length);
    const correct  = this._results.filter(r => r.isCorrect).length;
    const score21  = Math.round((correct / maxScore) * 21);

    this.sessionScore += score21;
    this.deck.advance(score21);
    this._updateHeader();

    this._showReview(correct, score21, this._currentKey, this._poolArts);
  },

  // ── Review screen ──────────────────────────────────────────────

  _showReview(correct, score21, key, poolArts, isLearn = false) {
    this._reviewKey = key;
    const data = this._periodsData[key];
    const allArts = data.artworks.map(id => ART_DATA.find(a => a.id === id)).filter(Boolean);

    // Sidebar learn-mode toggle
    document.querySelector('.theme-review-sidebar')
      .classList.toggle('is-learn-mode', isLearn);

    // Badge
    document.getElementById('pcs-r-period-name').textContent = key;

    // Scores
    const maxScore = Math.min(8, poolArts.length);
    document.getElementById('pcs-r-correct-count').textContent =
      `${correct} / ${maxScore}`;
    document.getElementById('pcs-review-session-score').textContent =
      `${this.sessionScore} pts`;
    document.getElementById('pcs-r-total').textContent = `${allArts.length} works`;

    // Score bar
    const pct = Math.round((score21 / 21) * 100);
    const bar = document.getElementById('pcs-score-bar-fill');
    bar.style.width = pct + '%';
    bar.style.background = pct >= 80 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626';

    this._renderAnswerList();
    this._renderMosaic(key, allArts);

    document.getElementById('screen-pcs-question').classList.remove('active');
    document.getElementById('screen-pcs-review').classList.add('active');
  },

  _renderAnswerList() {
    const container = document.getElementById('pcs-answer-list');
    container.innerHTML = '';

    this._results.forEach(r => {
      const row = document.createElement('div');
      row.className = 'theme-answer-row ' +
        (r.isCorrect ? 'answer-correct' : r.userText ? 'answer-wrong' : 'answer-blank');

      const icon  = r.isCorrect ? '✓' : r.userText ? '✗' : '–';
      const label = r.isCorrect
        ? this._esc(r.matched.title)
        : r.userText
          ? `<span class="answer-user-text">${this._esc(r.userText)}</span>`
          : '<span class="answer-blank-text">—</span>';

      row.innerHTML =
        `<span class="answer-icon">${icon}</span>` +
        `<span class="answer-label">${label}</span>`;
      container.appendChild(row);
    });
  },

  // ── Mosaic with RIGHT-side sub-headings ─────────────────────────

  _renderMosaic(key, allArts) {
    const mosaic = document.getElementById('pcs-mosaic');
    mosaic.innerHTML = '';

    const correctIds = new Set(
      this._results.filter(r => r.isCorrect && r.matched).map(r => r.matched.id)
    );

    // Group by normalised right side
    const groups = {};
    for (const art of allArts) {
      const { right } = parsePCS(art);
      // Normalise: strip parentheticals for grouping key, keep original for display label
      const normRight = right.replace(/\s*\(.*?\)/g, '').trim() || '—';
      if (!groups[normRight]) groups[normRight] = { label: right || '—', items: [] };
      groups[normRight].items.push(art);
    }

    // Sort groups alphabetically by normalised key
    const sortedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    const isFlat = sortedGroups.length === 1 && sortedGroups[0][0] === '—';

    for (const [normKey, { label, items }] of sortedGroups) {
      // Sub-heading (skip if Global Contemporary flat grid or only one group with no label)
      if (!isFlat) {
        const header = document.createElement('div');
        header.className = 'pcs-section-header';
        header.textContent = label;
        mosaic.appendChild(header);
      }

      for (const art of items) {
        const item = document.createElement('div');
        item.className = 'mosaic-item' + (correctIds.has(art.id) ? ' mosaic-item--found' : '');

        if (correctIds.has(art.id)) {
          const badge = document.createElement('div');
          badge.className = 'mosaic-found-badge';
          badge.textContent = '✓';
          item.appendChild(badge);
        } else if (art.id === this._representativeId) {
          const badge = document.createElement('div');
          badge.className = 'mosaic-found-badge mosaic-rep-badge';
          badge.textContent = '👁';
          item.appendChild(badge);
        }

        const img = document.createElement('img');
        img.className = 'mosaic-thumb';
        img.src       = art.image_url;
        img.alt       = art.title;
        img.loading   = 'lazy';
        item.appendChild(img);

        const card = document.createElement('div');
        card.className = 'mosaic-hover-card';
        const artistStr = art.artist && art.artist.toLowerCase() !== 'unknown'
          ? art.artist : 'Unknown artist';
        card.innerHTML =
          `<div class="mosaic-card-title">${this._esc(art.title)}</div>` +
          `<div class="mosaic-card-meta">${this._esc(artistStr)}</div>` +
          (art.dates
            ? `<div class="mosaic-card-meta">${this._esc(art.dates)}</div>` : '') +
          (art.period_culture_style
            ? `<div class="mosaic-card-period">${this._esc(art.period_culture_style)}</div>`
            : '');
        item.appendChild(card);

        item.style.cursor = 'pointer';
        item.addEventListener('click', () => this._openModal(art));
        mosaic.appendChild(item);
      }
    }
  },

  // ── Next area ──────────────────────────────────────────────────

  _nextArea() {
    this._showQuestion();
  },

  // ── Utilities ──────────────────────────────────────────────────

  _updateHeader() {
    document.getElementById('pcs-hdr-score').textContent   = this.sessionScore;
    document.getElementById('pcs-hdr-studied').textContent = this.deck.studiedCount;
  },

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

PCSApp.init();
