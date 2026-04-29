'use strict';

// ── Scoring helpers ───────────────────────────────────────────────────────────

function tlNorm(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\bc\.?\s*/g, '')
    .replace(/\b(ce|bce|ad|bc)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score a user's date entry against an artwork's numeric date range.
 * Uses date_start / date_end for range-aware grading, falls back to text match.
 */
function tlScoreDates(userText, art) {
  if (!userText.trim()) return 'miss';

  // --- numeric path ---
  const isBce = /bce|b\.c\.e\.|bc\b/i.test(userText);
  const numM  = userText.match(/[\d,]+/);
  if (numM) {
    const year = parseInt(numM[0].replace(/,/g, ''), 10) * (isBce ? -1 : 1);
    const lo = Math.min(art.date_start, art.date_end);
    const hi = Math.max(art.date_start, art.date_end);
    if (year >= lo && year <= hi) return 'got-it';

    // Tolerance: larger for ancient / circa works
    const span = Math.max(Math.abs(hi - lo), 1);
    const mag  = Math.max(Math.abs(lo), Math.abs(hi), 1);
    const tol  = art.date_circa ? Math.max(span, Math.round(mag * 0.05)) : Math.max(span, 10);
    if (year >= lo - tol && year <= hi + tol) return 'close';
  }

  // --- text fallback ---
  return tlAutoScore(userText, art.dates || '');
}

function tlAutoScore(userText, correctText) {
  if (!userText.trim()) return 'miss';
  const u = tlNorm(userText), c = tlNorm(correctText);
  if (u === c) return 'got-it';
  const uW = u.split(' ').filter(w => w.length >= 2);
  const cW = c.split(' ').filter(w => w.length >= 2);
  if (!uW.length || !cW.length) return 'miss';
  let hits = 0;
  for (const uw of uW) {
    if (cW.some(cw => cw === uw || cw.startsWith(uw) || uw.startsWith(cw))) hits++;
  }
  const sc = hits / Math.max(uW.length, Math.ceil(cW.length * 0.4));
  return sc >= 0.7 ? 'got-it' : sc >= 0.3 ? 'close' : 'miss';
}

// ── Main app ──────────────────────────────────────────────────────────────────

const TimelineApp = {
  _round: [],        // 8 artworks in correct chronological order (by id)
  _arrangement: [],  // _arrangement[pos] = roundIdx of card at that position
  _dragMode: true,
  _selected: null,   // click mode: selected track position
  _dragSrc: null,
  _answers: [],      // [{dates, period}] per artwork (roundIdx order)
  _scores: [],       // [{dates, period}] 'got-it'|'close'|'miss'|'learn'
  _sessionScore: 0,
  _roundsDone: 0,
  _filterThemeKeys: new Set(), // theme keys active in filter bar (empty = All Works)

  init() {
    FilterBar.init('filter-bar', (keys) => this._onFilterChange(keys));
    this._bindStatic();
    this._newRound();
  },

  _onFilterChange(keys) {
    this._filterThemeKeys = keys;
    this._newRound();
  },

  _getFilteredPool() {
    if (this._filterThemeKeys.size === 0) return ART_DATA;
    const ids = new Set();
    for (const key of this._filterThemeKeys) {
      for (const id of (THEMES_DATA[key]?.artworks || [])) ids.add(id);
    }
    const pool = ART_DATA.filter(art => ids.has(art.id));
    if (pool.length < 16) {
      this._showFilterWarning();
      return ART_DATA;
    }
    return pool;
  },

  _showFilterWarning() {
    const el = document.getElementById('filter-warn');
    if (!el) return;
    el.textContent = 'Too few works for this filter — using all works.';
    el.classList.add('filter-warn--visible');
    clearTimeout(this._warnTimer);
    this._warnTimer = setTimeout(() => el.classList.remove('filter-warn--visible'), 4000);
  },

  // ── Round lifecycle ────────────────────────────────────────────

  _newRound() {
    this._round       = this._pickRound();
    this._arrangement = this._derange(this._round.map((_, i) => i));
    this._answers     = this._round.map(() => ({ dates: '', period: '' }));
    this._scores      = [];
    this._selected    = null;
    this._dragSrc     = null;
    this._showOrder();
  },

  _pickRound() {
    const pool   = this._getFilteredPool();
    const sorted = [...pool].sort((a, b) =>
      (a.date_start + a.date_end) / 2 - (b.date_start + b.date_end) / 2
    );
    const n = sorted.length;
    return Array.from({ length: 8 }, (_, b) => {
      const start = Math.floor(b * n / 8);
      const end   = Math.floor((b + 1) * n / 8);
      const range = Math.max(1, end - start);
      return sorted[start + Math.floor(Math.random() * range)];
    });
  },

  _derange(arr) {
    const a = [...arr];
    let tries = 0;
    do {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    } while (a.some((v, i) => v === i) && ++tries < 200);
    return a;
  },

  // ── Static event binding ───────────────────────────────────────

  _bindStatic() {
    document.getElementById('btn-mode-toggle').addEventListener('click', () => {
      this._dragMode = !this._dragMode;
      this._selected = null;
      document.getElementById('btn-mode-toggle').textContent =
        this._dragMode ? 'Use click-to-swap' : 'Use drag-and-drop';
      this._renderCards();
    });

    document.getElementById('btn-continue').addEventListener('click', () => this._showRecall());
    document.getElementById('btn-tl-learn').addEventListener('click', () => this._learnThis());
    document.getElementById('btn-tl-check').addEventListener('click', () => this._checkAnswers());

    document.getElementById('btn-next-round').addEventListener('click', () => {
      if (this._scores.length && this._scores[0].dates !== 'learn') {
        this._sessionScore += this._computeScore();
      }
      this._roundsDone++;
      document.getElementById('tl-hdr-score').textContent  = this._sessionScore;
      document.getElementById('tl-hdr-rounds').textContent = this._roundsDone;
      this._newRound();
    });
  },

  // ── Order screen ───────────────────────────────────────────────

  _showOrder() {
    document.getElementById('screen-order').classList.add('active');
    document.getElementById('screen-recall').classList.remove('active');
    document.getElementById('screen-tl-review').classList.remove('active');
    this._renderCards();
    this._syncOrderStatus();
  },

  _renderCards() {
    const track = document.getElementById('tl-track');
    track.innerHTML = '';
    track.classList.toggle('drag-mode', this._dragMode);

    // ── Drop zone helper ──────────────────────────────────────
    const makeZone = (zoneIdx) => {
      const z = document.createElement('div');
      z.className = 'tl-drop-zone';
      z.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        z.classList.add('tl-drop-zone--over');
      });
      z.addEventListener('dragleave', () => z.classList.remove('tl-drop-zone--over'));
      z.addEventListener('drop', e => {
        e.preventDefault();
        z.classList.remove('tl-drop-zone--over');
        this._insertCard(this._dragSrc, zoneIdx);
      });
      return z;
    };

    // ── Card-wrap helper ──────────────────────────────────────
    const makeWrap = (pos) => {
      const roundIdx = this._arrangement[pos];
      const art      = this._round[roundIdx];
      const correct  = roundIdx === pos;
      const selected = !this._dragMode && this._selected === pos;

      const wrap = document.createElement('div');
      wrap.className = 'tl-card-wrap' +
        (correct  ? ' tl-card-wrap--correct'  : '') +
        (selected ? ' tl-card-wrap--selected' : '');

      // Image box
      const card = document.createElement('div');
      card.className = 'tl-card';

      const img = document.createElement('img');
      img.className = 'tl-card-img';
      img.src       = art.image_url;
      img.alt       = '';
      img.draggable = false;
      card.appendChild(img);

      if (correct) {
        const badge = document.createElement('div');
        badge.className   = 'tl-correct-badge';
        badge.textContent = '✓';
        card.appendChild(badge);
      }
      if (art.date_circa) {
        const circa = document.createElement('span');
        circa.className = 'tl-circa-badge';
        circa.textContent = '~';
        circa.title = 'Approximate date';
        card.appendChild(circa);
      }
      wrap.appendChild(card);

      // Number label below image
      const num = document.createElement('div');
      num.className   = 'tl-card-num';
      num.textContent = pos + 1;
      wrap.appendChild(num);

      if (this._dragMode) {
        wrap.draggable = true;

        wrap.addEventListener('dragstart', e => {
          this._dragSrc = pos;
          e.dataTransfer.effectAllowed = 'move';
          track.classList.add('is-dragging');
          requestAnimationFrame(() => wrap.classList.add('tl-card-wrap--dragging'));
        });

        // Swap target: lift + tilt when hovered
        wrap.addEventListener('dragover', e => {
          e.preventDefault();
          if (this._dragSrc !== null && this._dragSrc !== pos)
            wrap.classList.add('tl-card-wrap--swap');
        });
        wrap.addEventListener('dragleave', () => wrap.classList.remove('tl-card-wrap--swap'));

        wrap.addEventListener('drop', e => {
          e.preventDefault();
          wrap.classList.remove('tl-card-wrap--swap');
          const src = this._dragSrc;
          if (src !== null && src !== pos) {
            [this._arrangement[src], this._arrangement[pos]] =
              [this._arrangement[pos], this._arrangement[src]];
            this._dragSrc = null;
            track.classList.remove('is-dragging');
            this._renderCards();
            this._syncOrderStatus();
          }
        });

        wrap.addEventListener('dragend', () => {
          this._dragSrc = null;
          track.classList.remove('is-dragging');
          track.querySelectorAll('.tl-card-wrap--dragging, .tl-card-wrap--swap, .tl-drop-zone--over')
            .forEach(el => el.classList.remove(
              'tl-card-wrap--dragging', 'tl-card-wrap--swap', 'tl-drop-zone--over'
            ));
        });

      } else {
        wrap.addEventListener('click', () => {
          if (this._selected === null) {
            this._selected = pos;
          } else if (this._selected === pos) {
            this._selected = null;
          } else {
            [this._arrangement[this._selected], this._arrangement[pos]] =
              [this._arrangement[pos], this._arrangement[this._selected]];
            this._selected = null;
            this._syncOrderStatus();
          }
          this._renderCards();
        });
      }

      return wrap;
    };

    // ── Build 4×2 grid ────────────────────────────────────────
    // Row 1 pattern: z0 w0 z1 w1 z2 w2 z3 w3 z4   (9 cells)
    // Row 2 pattern: z4 w4 z5 w5 z6 w6 z7 w7 z8   (9 cells)
    // Zone 4 is duplicated: end of row 1 & start of row 2 both map to insert-at-4.
    if (this._dragMode) {
      for (let pos = 0; pos < 4; pos++) {
        track.appendChild(makeZone(pos));
        track.appendChild(makeWrap(pos));
      }
      track.appendChild(makeZone(4)); // row 1 tail

      track.appendChild(makeZone(4)); // row 2 head (same logical insert point)
      for (let pos = 4; pos < 8; pos++) {
        track.appendChild(makeWrap(pos));
        track.appendChild(makeZone(pos + 1));
      }
    } else {
      // Click mode: plain 4-column grid, no zones
      for (let pos = 0; pos < 8; pos++) {
        track.appendChild(makeWrap(pos));
      }
    }
  },

  _insertCard(src, zone) {
    if (src === null || src === undefined) return;
    const newArr = [...this._arrangement];
    const [card] = newArr.splice(src, 1);
    const insertAt = zone > src ? zone - 1 : zone;
    newArr.splice(Math.min(insertAt, newArr.length), 0, card);
    this._arrangement = newArr;
    this._dragSrc = null;
    document.getElementById('tl-track').classList.remove('is-dragging');
    this._renderCards();
    this._syncOrderStatus();
  },

  _datesOverlap(a, b) {
    return a.date_start <= b.date_end && b.date_start <= a.date_end;
  },

  _syncOrderStatus() {
    let correct = 0;
    for (let pos = 0; pos < this._arrangement.length; pos++) {
      const roundIdx = this._arrangement[pos];
      if (roundIdx === pos) {
        correct++;
      } else if (Math.abs(roundIdx - pos) === 1) {
        // Card is one slot off — accept if its date range overlaps the card that belongs here
        if (this._datesOverlap(this._round[roundIdx], this._round[pos])) {
          correct++;
        }
      }
    }
    document.getElementById('tl-correct-count').textContent = correct;
    document.getElementById('btn-continue').disabled = correct < 8;
  },

  // ── Recall screen ──────────────────────────────────────────────

  _showRecall() {
    document.getElementById('screen-order').classList.remove('active');
    document.getElementById('screen-recall').classList.add('active');
    document.getElementById('screen-tl-review').classList.remove('active');
    this._renderRecallRows();
  },

  _renderRecallRows() {
    const list = document.getElementById('tl-recall-list');
    list.innerHTML = '';

    this._round.forEach((art, i) => {
      const row = document.createElement('div');
      row.className = 'tl-recall-row';

      const img = document.createElement('img');
      img.className = 'tl-recall-thumb';
      img.src       = art.image_url;
      img.alt       = '';
      row.appendChild(img);

      const fields = document.createElement('div');
      fields.className = 'tl-recall-fields';

      ['dates', 'period'].forEach(key => {
        const inp = document.createElement('input');
        inp.type        = 'text';
        inp.className   = 'field-input tl-field';
        inp.placeholder = key === 'dates' ? 'Dates…' : 'Period / Culture / Style…';
        inp.value       = this._answers[i][key];
        inp.autocomplete = 'off';
        inp.spellcheck  = false;
        inp.addEventListener('input', () => { this._answers[i][key] = inp.value; });
        inp.addEventListener('keydown', e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const all = list.querySelectorAll('.tl-field');
          const idx = Array.from(all).indexOf(inp);
          if (idx < all.length - 1) all[idx + 1].focus();
          else document.getElementById('btn-tl-check').click();
        });
        fields.appendChild(inp);
        if (key === 'dates' && art.date_circa) {
          const hint = document.createElement('span');
          hint.className   = 'tl-circa-hint';
          hint.textContent = '~ approximate date';
          fields.appendChild(hint);
        }
      });

      row.appendChild(fields);
      list.appendChild(row);
    });

    list.querySelector('.tl-field')?.focus();
  },

  _learnThis() {
    this._round.forEach((art, i) => {
      this._answers[i].dates  = art.dates || '';
      this._answers[i].period = art.period_culture_style || '';
    });
    this._scores = this._round.map(() => ({ dates: 'learn', period: 'learn' }));
    this._showReview(true);
  },

  _checkAnswers() {
    this._scores = this._round.map((art, i) => ({
      dates:  tlScoreDates(this._answers[i].dates, art),
      period: tlAutoScore(this._answers[i].period, art.period_culture_style || ''),
    }));
    this._showReview(false);
  },

  // ── Review screen ──────────────────────────────────────────────

  _showReview(isLearn) {
    document.getElementById('screen-order').classList.remove('active');
    document.getElementById('screen-recall').classList.remove('active');
    document.getElementById('screen-tl-review').classList.add('active');
    this._renderReview(isLearn);
    this._syncReviewScore(isLearn);
  },

  _renderReview(isLearn) {
    const list = document.getElementById('tl-review-list');
    list.innerHTML = '';

    this._round.forEach((art, i) => {
      const item = document.createElement('div');
      item.className = 'tl-review-item';

      const img = document.createElement('img');
      img.className = 'tl-review-thumb';
      img.src       = art.image_url;
      img.alt       = art.title;
      item.appendChild(img);

      const body = document.createElement('div');
      body.className = 'tl-review-body';

      const title = document.createElement('div');
      title.className   = 'tl-review-title';
      title.textContent = art.title;
      body.appendChild(title);

      [
        { key: 'dates',  label: 'Dates',                   correct: art.dates                || '—' },
        { key: 'period', label: 'Period / Culture / Style', correct: art.period_culture_style || '—' },
      ].forEach(({ key, label, correct }) => {
        body.appendChild(
          this._makeReviewField(i, key, label, this._answers[i][key], correct, isLearn)
        );
      });

      item.appendChild(body);
      list.appendChild(item);
    });
  },

  _makeReviewField(artIdx, fieldKey, label, userAnswer, correctAnswer, isLearn) {
    const wrap = document.createElement('div');
    wrap.className = 'tl-review-field';

    const lbl = document.createElement('div');
    lbl.className   = 'tl-field-label';
    lbl.textContent = label;
    wrap.appendChild(lbl);

    if (isLearn) {
      const ans = document.createElement('div');
      ans.className   = 'tl-field-correct';
      ans.textContent = correctAnswer;
      wrap.appendChild(ans);
      return wrap;
    }

    const row = document.createElement('div');
    row.className = 'tl-field-row';

    const answers = document.createElement('div');
    answers.className = 'tl-field-answers';
    if (userAnswer) {
      const u = document.createElement('div');
      u.className   = 'tl-field-user';
      u.textContent = `You: ${userAnswer}`;
      answers.appendChild(u);
    }
    const c = document.createElement('div');
    c.className   = 'tl-field-correct';
    c.textContent = `Answer: ${correctAnswer}`;
    answers.appendChild(c);
    row.appendChild(answers);

    const btns = document.createElement('div');
    btns.className = 'tl-score-btns';
    const status = this._scores[artIdx][fieldKey];

    [
      { key: 'got-it', label: '✓ Got it' },
      { key: 'close',  label: '~ Close'  },
      { key: 'miss',   label: '✗ Miss'   },
    ].forEach(({ key, label: btnLabel }) => {
      const btn = document.createElement('button');
      btn.className   = `tl-score-btn tl-score-btn--${key}${status === key ? ' is-active' : ''}`;
      btn.textContent = btnLabel;
      btn.addEventListener('click', () => {
        this._scores[artIdx][fieldKey] = key;
        btns.querySelectorAll('.tl-score-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this._syncReviewScore(false);
      });
      btns.appendChild(btn);
    });

    row.appendChild(btns);
    wrap.appendChild(row);
    return wrap;
  },

  _computeScore() {
    return this._scores.reduce((sum, s) => {
      const d = s.dates  === 'got-it' ? 2 : s.dates  === 'close' ? 1 : 0;
      const p = s.period === 'got-it' ? 2 : s.period === 'close' ? 1 : 0;
      return sum + d + p;
    }, 0);
  },

  _syncReviewScore(isLearn) {
    if (isLearn) {
      document.getElementById('tl-round-score').textContent         = '— (study mode)';
      document.getElementById('tl-session-score-review').textContent = `${this._sessionScore} pts`;
      return;
    }
    const round = this._computeScore();
    document.getElementById('tl-round-score').textContent =
      `${round} / 32 pts`;
    document.getElementById('tl-session-score-review').textContent =
      `${this._sessionScore} + ${round} pts`;
  },
};

TimelineApp.init();
