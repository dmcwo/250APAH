'use strict';

// ── Title fuzzy matcher ───────────────────────────────────────────────────────

const STOP = new Set(['the','a','an','of','and','or','in','on','at','to','for',
  'with','by','from','is','are','was','were','its','it','this','that','as',
  'de','des','du','la','le','les','el','los','las']);

function normTitle(s) {
  return s.toLowerCase()
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
  _results: [],
  _isLearning: false,

  init() {
    this.deck = new Deck(Object.keys(THEMES_DATA));
    this._bindEvents();
    this._showQuestion();
  },

  // ── Event binding ──────────────────────────────────────────────

  _bindEvents() {
    document.getElementById('btn-check').addEventListener('click', () => {
      if (this._isLearning) this._advanceLearned();
      else this._checkAnswers();
    });

    document.getElementById('btn-learn').addEventListener('click', () => this._learnThis());
    document.getElementById('btn-next').addEventListener('click', () => this._nextTheme());

    // Enter → advance to next input, or trigger check on last
    document.querySelectorAll('.theme-input').forEach((input, i, all) => {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i < all.length - 1) all[i + 1].focus();
        else document.getElementById('btn-check').click();
      });
    });
  },

  // ── Question screen ────────────────────────────────────────────

  _showQuestion() {
    this._themeKey = this.deck.current;
    const theme = THEMES_DATA[this._themeKey];

    this._themeArtworks = theme.artworks
      .map(id => ART_DATA.find(a => a.id === id))
      .filter(Boolean);

    const featured = this._themeArtworks[0] || null;
    this._featuredId = featured ? featured.id : null;

    // Theme badge
    const badge = document.getElementById('t-theme-badge');
    badge.textContent = theme.label;
    applyThemeColor(badge, this._themeKey);

    document.getElementById('t-theme-definition').textContent = theme.definition;

    // Featured image
    if (featured) {
      const img = document.getElementById('t-featured-image');
      img.src = featured.image_url;
      img.alt = featured.title;

      const artistStr = featured.artist && featured.artist.toLowerCase() !== 'unknown'
        ? featured.artist : 'Unknown artist';
      document.getElementById('t-featured-caption').innerHTML =
        `<strong>${this._esc(featured.title)}</strong><br>` +
        `${this._esc(artistStr)}` +
        (featured.dates ? ` · ${this._esc(featured.dates)}` : '');
    }

    // Count hint
    document.getElementById('t-count-hint').innerHTML =
      `This theme connects to <strong>${this._themeArtworks.length}</strong> of the 250 ` +
      `required works — how many can you name?`;

    // Clear inputs
    document.querySelectorAll('.theme-input').forEach(inp => {
      inp.value = '';
      inp.classList.remove('learn-filled');
      inp.disabled = false;
    });

    // Reset buttons
    const btnLearn = document.getElementById('btn-learn');
    const btnCheck = document.getElementById('btn-check');
    btnLearn.textContent = 'Learn this';
    btnLearn.classList.remove('hidden', 'btn-learn-done');
    btnCheck.textContent = 'Check Answers';
    btnCheck.classList.remove('hidden');
    this._isLearning = false;

    // Switch screens
    document.getElementById('screen-question').classList.add('active');
    document.getElementById('screen-review').classList.remove('active');

    document.querySelector('.theme-input').focus();
  },

  // ── Learn this ─────────────────────────────────────────────────

  _learnThis() {
    if (this._isLearning) return;
    this._isLearning = true;

    const samples = this._themeArtworks
      .filter(a => a.id !== this._featuredId)
      .slice(0, 5);

    document.querySelectorAll('.theme-input').forEach((inp, i) => {
      inp.value = samples[i] ? samples[i].title : '';
      inp.classList.add('learn-filled');
      inp.disabled = true;
    });

    document.getElementById('btn-learn').classList.add('hidden');
    const btnCheck = document.getElementById('btn-check');
    btnCheck.textContent = 'Got it, Next Theme →';
    btnCheck.classList.add('btn-learn-done');
  },

  _advanceLearned() {
    this.deck.advanceLearn();  // increments studiedCount internally
    this._updateHeader();
    this._showQuestion();
  },

  // ── Check answers ──────────────────────────────────────────────

  _checkAnswers() {
    const usedIds = new Set();
    this._results = [];

    document.querySelectorAll('.theme-input').forEach(inp => {
      const userText = inp.value.trim();
      const matched = findBestMatch(userText, this._themeArtworks, usedIds);
      this._results.push({ userText, matched, isCorrect: !!matched });
    });

    const correct = this._results.filter(r => r.isCorrect).length;
    const score21 = Math.round((correct / 5) * 21);

    this.sessionScore += score21;

    // Capture state for review before advancing deck
    const reviewThemeKey = this._themeKey;
    const reviewArtworks = this._themeArtworks;

    this.deck.advance(score21);
    this._updateHeader();
    this._showReview(correct, score21, reviewThemeKey, reviewArtworks);
  },

  // ── Review screen ──────────────────────────────────────────────

  _showReview(correct, score21, themeKey, artworks) {
    const theme = THEMES_DATA[themeKey];

    // Badge
    const badge = document.getElementById('r-theme-badge');
    badge.textContent = theme.label;
    applyThemeColor(badge, themeKey);

    // Scores
    document.getElementById('r-correct-count').textContent = `${correct} / 5`;
    document.getElementById('review-session-score').textContent = `${this.sessionScore} pts`;
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

  _renderMosaic(artworks) {
    const mosaic = document.getElementById('theme-mosaic');
    mosaic.innerHTML = '';

    const correctIds = new Set(
      this._results.filter(r => r.isCorrect && r.matched).map(r => r.matched.id)
    );

    artworks.forEach(art => {
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

      mosaic.appendChild(item);
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
