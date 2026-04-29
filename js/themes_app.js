'use strict';

// ── Title fuzzy matcher ───────────────────────────────────────────────────────

const STOP = new Set(['the','a','an','of','and','or','in','on','at','to','for',
  'with','by','from','is','are','was','were','its','it','this','that','as',
  'de','des','du','la','le','les','el','los','las']);

function normTitle(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[''"""]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleWords(s) {
  return normTitle(s).split(' ').filter(w => w.length >= 2 && !STOP.has(w));
}

/**
 * Returns a match score 0–1 between a user-typed string and an artwork title.
 * Threshold for acceptance: >= 0.5.
 */
function titleMatchScore(userInput, artTitle) {
  const uWords = titleWords(userInput);
  const tWords = titleWords(artTitle);
  if (!uWords.length || !tWords.length) return 0;

  let hits = 0;
  for (const uw of uWords) {
    if (tWords.some(tw => tw === uw || tw.startsWith(uw) || uw.startsWith(tw))) hits++;
  }

  return hits / Math.max(uWords.length, Math.ceil(tWords.length * 0.4));
}

/**
 * Returns the highest raw match score for userText against unmatched artworks,
 * without applying the 0.5 acceptance threshold. Used for "getting close" UI.
 */
function bestRawScore(userText, artworks, usedIds) {
  if (!userText.trim()) return 0;
  let best = 0;
  for (const art of artworks) {
    if (usedIds.has(art.id)) continue;
    const s = titleMatchScore(userText, art.title);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Returns true if userText (≥3 chars) appears as a substring in any
 * unmatched artwork's normalized title — used for "getting close" state.
 */
function isSubstringClose(userText, artworks, usedIds) {
  const q = normTitle(userText.trim());
  if (q.length < 3) return false;
  return artworks.some(art => !usedIds.has(art.id) && normTitle(art.title).includes(q));
}

/**
 * Given user text and an artwork array, return the best-matching artwork
 * (score >= 0.5) or null. Adds matched id to usedIds to prevent double-match.
 */
function findBestMatch(userText, artworks, usedIds) {
  if (!userText.trim()) return null;
  let best = null;
  let bestScore = 0;
  for (const art of artworks) {
    if (usedIds.has(art.id)) continue;
    const score = titleMatchScore(userText, art.title);
    if (score > bestScore) { bestScore = score; best = art; }
  }
  if (bestScore >= 0.5 && best) {
    usedIds.add(best.id);
    return best;
  }
  return null;
}

// ── Theme colour palette ──────────────────────────────────────────────────────

const THEME_COLORS = {
  power_authority:         { bg: '#1e3f70', text: '#dbeafe' },
  religion_ritual:         { bg: '#5b21b6', text: '#ede9fe' },
  human_experience:        { bg: '#065f46', text: '#d1fae5' },
  identity:                { bg: '#92400e', text: '#fef3c7' },
  architecture_space:      { bg: '#1f2937', text: '#f3f4f6' },
  trade_exchange:          { bg: '#164e63', text: '#cffafe' },
  death_afterlife:         { bg: '#3b0764', text: '#f3e8ff' },
  art_innovation_materials:{ bg: '#7f1d1d', text: '#fee2e2' },
  nature_body:             { bg: '#14532d', text: '#dcfce7' },
  conflict_resistance:     { bg: '#7c2d12', text: '#ffedd5' },
  narrative_storytelling:  { bg: '#1e3a5f', text: '#dbeafe' },
};

function applyThemeColor(el, themeKey) {
  const c = THEME_COLORS[themeKey] || { bg: '#1c1c1e', text: '#ffffff' };
  el.style.background = c.bg;
  el.style.color = c.text;
}

// ── Main app ──────────────────────────────────────────────────────────────────

const ThemesApp = {
  deck: null,
  sessionScore: 0,

  // State for the card currently being reviewed
  _themeKey: null,
  _themeArtworks: [],
  _featuredId: null,
  _essentialIds: new Set(),
  _topPickIds: new Set(),
  _results: [],
  _liveDebounceTimer: null,
  _reviewThemeKey: null,

  init() {
    this.deck = new Deck(Object.keys(THEMES_DATA));
    this._bindEvents();
    this._initTooltip();
    this._initModal();
    this._showQuestion();
  },

  // ── Modal ──────────────────────────────────────────────────────

  _initModal() {
    const modal = document.getElementById('artwork-modal');
    document.getElementById('artwork-modal-close')
      .addEventListener('click', () => this._closeModal());
    modal.querySelector('.artwork-modal-backdrop')
      .addEventListener('click', () => this._closeModal());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._closeModal();
    });
  },

  _openModal(art, themeKey) {
    const modal = document.getElementById('artwork-modal');
    document.getElementById('artwork-modal-img').src = art.image_url;
    document.getElementById('artwork-modal-img').alt = art.title;
    document.getElementById('artwork-modal-title').textContent = art.title;

    const badge = document.getElementById('artwork-modal-theme-badge');
    badge.textContent = THEMES_DATA[themeKey].label;
    applyThemeColor(badge, themeKey);

    const meta = document.getElementById('artwork-modal-meta');
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

    const themeData = THEMES_DATA[themeKey];
    const connectionText = (themeData.connections && themeData.connections[String(art.id)])
      || art.significance || '';
    document.getElementById('artwork-modal-significance').textContent = connectionText;

    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('artwork-modal-close').focus();
  },

  _closeModal() {
    document.getElementById('artwork-modal').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  },

  // ── Portal tooltip ─────────────────────────────────────────────

  _initTooltip() {
    const tooltip = document.getElementById('mosaic-tooltip');
    const MARGIN = 12;
    const mosaic = document.getElementById('theme-mosaic');

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
      if (x + tw > window.innerWidth)  x = e.clientX - tw - MARGIN;
      if (y < 0)                        y = e.clientY + MARGIN;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = y + 'px';
    });

    mosaic.addEventListener('mouseout', e => {
      if (e.target.closest('.mosaic-item')) tooltip.classList.remove('is-visible');
    });
  },

  // ── Event binding ──────────────────────────────────────────────

  _bindEvents() {
    document.getElementById('btn-check').addEventListener('click', () => this._checkAnswers());

    document.getElementById('btn-learn').addEventListener('click', () => this._learnThis());
    document.getElementById('btn-next').addEventListener('click', () => this._nextTheme());

    this._bindLiveFeedback();
    this._bindEnterKey();
  },

  _bindEnterKey() {
    const inputs = document.querySelectorAll('.theme-input');
    inputs.forEach((input, i, all) => {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i < all.length - 1) all[i + 1].focus();
        else document.getElementById('btn-check').click();
      });
    });
  },

  // ── Live feedback ──────────────────────────────────────────────

  _bindLiveFeedback() {
    document.querySelectorAll('.theme-input').forEach(inp => {
      inp.addEventListener('input', () => {
        clearTimeout(this._liveDebounceTimer);
        this._liveDebounceTimer = setTimeout(() => this._updateLiveFeedback(), 300);
      });
    });
  },

  _renderInputs(n) {
    const container = document.getElementById('theme-inputs-container');
    container.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div');
      row.className = 'theme-input-row';
      const num = document.createElement('span');
      num.className = 'theme-input-num';
      num.textContent = String(i + 1);
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'field-input theme-input';
      input.dataset.index = String(i);
      input.placeholder = 'Artwork title…';
      input.autocomplete = 'off';
      input.spellcheck = false;
      row.appendChild(num);
      row.appendChild(input);
      container.appendChild(row);
    }
  },

  _updateLiveFeedback() {
    const inputs = Array.from(document.querySelectorAll('.theme-input'));
    const usedIds = new Set();
    inputs.forEach((inp, i) => {
      const val = inp.value.trim();
      const matched = findBestMatch(val, this._themeArtworks, usedIds);
      const num = inp.closest('.theme-input-row').querySelector('.theme-input-num');
      const hasText = val.length > 0;

      // Determine state: match → close → no-match
      const isClose = !matched && hasText &&
        (bestRawScore(val, this._themeArtworks, usedIds) >= 0.2 ||
         isSubstringClose(val, this._themeArtworks, usedIds));

      inp.classList.toggle('live-match',    !!matched);
      inp.classList.toggle('live-close',    isClose);
      inp.classList.toggle('live-no-match', !matched && !isClose && hasText);

      num.classList.toggle('live-match', !!matched);
      num.classList.toggle('live-close', isClose);

      if (matched) {
        const isEssential = this._essentialIds.has(matched.id);
        num.classList.toggle('live-essential', isEssential);
        num.textContent = '★';
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
    this._themeKey = this.deck.current;
    const theme = THEMES_DATA[this._themeKey];

    this._themeArtworks = theme.artworks
      .map(id => ART_DATA.find(a => a.id === id))
      .filter(Boolean);

    this._essentialIds = new Set(theme.essential || []);
    this._topPickIds   = new Set(theme.top_picks  || []);

    const featured = this._themeArtworks[0] || null;
    this._featuredId = featured ? featured.id : null;

    // Theme badge
    const badge = document.getElementById('t-theme-badge');
    badge.textContent = theme.label;
    applyThemeColor(badge, this._themeKey);

    document.getElementById('t-theme-definition').textContent = theme.definition;

    // Featured image (use first essential artwork)
    const essentialArt = ART_DATA.find(a => (theme.essential || [])[0] === a.id) || featured;
    if (essentialArt) {
      const img = document.getElementById('t-featured-image');
      img.src = essentialArt.image_url;
      img.alt = essentialArt.title;
    }

    // Count hint
    const n = (theme.essential || []).length;
    document.getElementById('t-count-hint').innerHTML =
      `Name the <strong>${n} essential works</strong> for this theme ` +
      `— plus any of the ${this._themeArtworks.length} connected works you know.`;

    // Render dynamic inputs and re-bind live events (minimum 6 for bonus top-pick attempts)
    this._renderInputs(Math.max(n, 6));
    this._bindLiveFeedback();
    this._bindEnterKey();
    clearTimeout(this._liveDebounceTimer);

    // Reset buttons
    document.getElementById('btn-learn').textContent = 'Learn this';
    document.getElementById('btn-check').textContent = 'Check Answers';

    // Switch screens
    document.getElementById('screen-question').classList.add('active');
    document.getElementById('screen-review').classList.remove('active');

    const firstInput = document.querySelector('.theme-input');
    if (firstInput) firstInput.focus();
  },

  // ── Learn this ─────────────────────────────────────────────────

  _learnThis() {
    const learnThemeKey = this._themeKey;
    const learnArtworks = this._themeArtworks;
    this._results = [];
    this.deck.advanceLearn();
    this._updateHeader();
    this._showReview(0, 0, 0, learnThemeKey, learnArtworks, true);
  },

  // ── Check answers ──────────────────────────────────────────────

  _checkAnswers() {
    const usedIds = new Set();
    this._results = [];

    document.querySelectorAll('.theme-input').forEach(inp => {
      const userText = inp.value.trim();
      const matched  = findBestMatch(userText, this._themeArtworks, usedIds);
      const isCorrect   = !!matched;
      const isEssential = isCorrect && this._essentialIds.has(matched.id);
      const isTopPick   = isCorrect && this._topPickIds.has(matched.id);
      this._results.push({ userText, matched, isCorrect, isEssential, isTopPick });
    });

    const n                = (THEMES_DATA[this._themeKey].essential || []).length;
    const correctEssential = this._results.filter(r => r.isEssential).length;
    const bonusPoints      = this._results.filter(r => r.isCorrect && r.isTopPick).length;
    const score21          = Math.round((correctEssential / n) * 21);

    this.sessionScore += score21 + bonusPoints;

    const reviewThemeKey = this._themeKey;
    const reviewArtworks = this._themeArtworks;

    this.deck.advance(score21);
    this._updateHeader();
    this._showReview(correctEssential, score21, bonusPoints, reviewThemeKey, reviewArtworks);
  },

  // ── Review screen ──────────────────────────────────────────────

  _showReview(correct, score21, bonusPoints, themeKey, artworks, isLearn = false) {
    this._reviewThemeKey = themeKey;
    const theme = THEMES_DATA[themeKey];

    // Sidebar mode
    document.querySelector('.theme-review-sidebar')
      .classList.toggle('is-learn-mode', isLearn);

    // Badge
    const badge = document.getElementById('r-theme-badge');
    badge.textContent = theme.label;
    applyThemeColor(badge, themeKey);

    // Scores
    const n = (THEMES_DATA[themeKey].essential || []).length;
    document.getElementById('r-correct-count').textContent = `${correct} / ${n}`;
    const bonusLabel = bonusPoints > 0 ? ` (+${bonusPoints} bonus)` : '';
    document.getElementById('review-session-score').textContent =
      `${this.sessionScore} pts${bonusLabel}`;
    document.getElementById('r-theme-total').textContent = `${artworks.length} works`;

    // Score bar
    const pct = Math.round((score21 / 21) * 100);
    const bar = document.getElementById('score-bar-fill');
    bar.style.width = pct + '%';
    bar.style.background = pct >= 80 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626';

    this._renderAnswerList();
    this._renderMosaic(artworks);

    document.getElementById('screen-question').classList.remove('active');
    document.getElementById('screen-review').classList.add('active');
  },

  _renderAnswerList() {
    const container = document.getElementById('theme-answer-list');
    container.innerHTML = '';

    this._results.forEach(r => {
      const row = document.createElement('div');
      row.className = 'theme-answer-row ' +
        (r.isCorrect ? 'answer-correct' : r.userText ? 'answer-wrong' : 'answer-blank');

      const icon = r.isCorrect ? '✓' : r.userText ? '✗' : '–';
      const essentialBadge = r.isEssential
        ? ' <span class="answer-essential-badge">★ essential</span>' : '';
      const starBadge = r.isTopPick
        ? ' <span class="answer-top-pick-badge">★ top pick</span>' : '';
      const label = r.isCorrect
        ? this._esc(r.matched.title) + essentialBadge + starBadge
        : r.userText
          ? `<span class="answer-user-text">${this._esc(r.userText)}</span>`
          : '<span class="answer-blank-text">—</span>';

      row.innerHTML =
        `<span class="answer-icon">${icon}</span>` +
        `<span class="answer-label">${label}</span>`;

      container.appendChild(row);
    });
  },

  _renderMosaic(artworks) {
    const mosaic = document.getElementById('theme-mosaic');
    mosaic.innerHTML = '';

    const correctIds = new Set(
      this._results.filter(r => r.isCorrect && r.matched).map(r => r.matched.id)
    );

    const theme = THEMES_DATA[this._reviewThemeKey];
    const essentialSet = new Set(theme.essential || []);
    const topPickSet   = new Set(theme.top_picks  || []);

    const essentialArts = artworks.filter(a => essentialSet.has(a.id));
    const topPickArts   = artworks.filter(a => !essentialSet.has(a.id) && topPickSet.has(a.id));
    const relatedArts   = artworks.filter(a => !essentialSet.has(a.id) && !topPickSet.has(a.id));

    const addHeader = (text, extraClass) => {
      const h = document.createElement('div');
      h.className = 'mosaic-section-header' + (extraClass ? ' ' + extraClass : '');
      h.innerHTML = text;
      mosaic.appendChild(h);
    };

    const groups = [
      { label: '<span class="mosaic-section-star mosaic-section-star--essential">★</span> Essential',
        items: essentialArts, cls: 'mosaic-section-header--essential' },
      { label: '<span class="mosaic-section-star">★</span> Top Picks',
        items: topPickArts,   cls: null },
      { label: 'Related Works',
        items: relatedArts,   cls: null },
    ].filter(g => g.items.length > 0);

    groups.forEach(({ label, items, cls }) => {
      if (label) addHeader(label, cls);
      items.forEach(art => {
        const item = document.createElement('div');
        item.className = 'mosaic-item' + (correctIds.has(art.id) ? ' mosaic-item--found' : '');

        if (correctIds.has(art.id)) {
          const badge = document.createElement('div');
          badge.className = 'mosaic-found-badge';
          badge.textContent = '✓';
          item.appendChild(badge);
        }

        const img = document.createElement('img');
        img.className = 'mosaic-thumb';
        img.src = art.image_url;
        img.alt = art.title;
        img.loading = 'lazy';
        item.appendChild(img);

        const card = document.createElement('div');
        card.className = 'mosaic-hover-card';
        const artistStr = art.artist && art.artist.toLowerCase() !== 'unknown'
          ? art.artist : 'Unknown artist';
        card.innerHTML =
          `<div class="mosaic-card-title">${this._esc(art.title)}</div>` +
          `<div class="mosaic-card-meta">${this._esc(artistStr)}</div>` +
          (art.dates ? `<div class="mosaic-card-meta">${this._esc(art.dates)}</div>` : '') +
          (art.period_culture_style
            ? `<div class="mosaic-card-period">${this._esc(art.period_culture_style)}</div>`
            : '');
        item.appendChild(card);

        item.style.cursor = 'pointer';
        item.addEventListener('click', () => this._openModal(art, this._reviewThemeKey));

        mosaic.appendChild(item);
      });
    });
  },

  // ── Next theme ─────────────────────────────────────────────────

  _nextTheme() {
    this._showQuestion();
  },

  // ── Utilities ──────────────────────────────────────────────────

  _updateHeader() {
    document.getElementById('hdr-session-score').textContent = this.sessionScore;
    document.getElementById('hdr-studied').textContent = this.deck.studiedCount;
  },

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};

ThemesApp.init();
