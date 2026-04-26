/**
 * AP Art History — Image Recall
 * Main application logic: state machine, rendering, fuzzy grading.
 */

// ══════════════════════════════════════════════════════════════
// Field definitions
// Maps form inputs → data fields and grading strategy
// ══════════════════════════════════════════════════════════════
const FIELDS = [
  {
    key:      'title',
    label:    'Title',
    inputId:  'f-title',
    dataKey:  'title',
    grade:    'standard',
  },
  {
    key:      'artist',
    label:    'Artist(s)',
    inputId:  'f-artist',
    dataKey:  'artist',
    grade:    'standard',
  },
  {
    key:      'dates',
    label:    'Dates',
    inputId:  'f-dates',
    dataKey:  'dates',
    grade:    'dates',
  },
  {
    key:      'place',
    label:    'Place',
    inputId:  'f-place',
    dataKey:  'place',
    grade:    'standard',
  },
  {
    key:      'period',
    label:    'Period / Culture / Style',
    inputId:  'f-period',
    dataKey:  'period_culture_style',
    grade:    'standard',
  },
  {
    key:      'type',
    label:    'Artwork Type / Materials',
    inputId:  'f-type',
    dataKey:  '_type_combined',    // special: merged field (see getCorrect)
    grade:    'standard',
  },
  {
    key:      'significance',
    label:    'Significance',
    inputId:  'f-significance',
    dataKey:  'significance',
    grade:    'significance',
  },
];

const MAX_SCORE = FIELDS.length * 3;   // 7 × 3 = 21

// ══════════════════════════════════════════════════════════════
// Fuzzy grader
// Returns 'correct' | 'close' | 'incorrect' | 'blank'
// ══════════════════════════════════════════════════════════════
const Fuzzy = (() => {

  const STOPWORDS = new Set([
    'a','an','the','in','of','at','on','for','to','is','are','was','were',
    'and','or','but','with','by','from','as','it','its','this','that',
    'which','who','has','have','had','be','been','one','two','three',
    'first','most','also','more','into','through','during','after','before',
    'about','out','over','not','so','up','what','when','where','how','all',
    'both','each','few','other','some','such','than','then','they','their',
    'there','these','those','very','just','can','will','only','same','used',
    'use','his','her','him','she','he','we','us','our','your','you','i',
    'my','me','its','now','known','made','making','using','including',
    'shows','show','depicts','depicted','featuring','features',
  ]);

  function normalize(str) {
    return str
      .toLowerCase()
      .replace(/['']/g, "'")
      .replace(/[^\w\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(str) {
    return normalize(str)
      .split(' ')
      .filter(w => w.length > 1);
  }

  /** Fraction of user's words that appear in the correct answer. */
  function wordOverlap(user, correct) {
    const userWords = tokenize(user);
    const correctSet = new Set(tokenize(correct));
    if (userWords.length === 0) return 0;
    const hits = userWords.filter(w => correctSet.has(w)).length;
    return hits / userWords.length;
  }

  /** Standard grading for text fields (title, artist, place, etc.) */
  function gradeStandard(user, correct) {
    if (!user || !user.trim()) return 'blank';

    const u = normalize(user);
    const c = normalize(correct);

    // Exact match
    if (u === c) return 'correct';

    // Contains match (with reasonable length ratio to avoid "a" matching anything)
    const shorter = Math.min(u.length, c.length);
    const longer  = Math.max(u.length, c.length);
    if ((c.includes(u) || u.includes(c)) && shorter / longer >= 0.35) {
      return 'correct';
    }

    // Word-level overlap
    const ov = wordOverlap(u, c);
    if (ov >= 0.55) return 'correct';
    if (ov >= 0.20) return 'close';

    return 'incorrect';
  }

  /**
   * Date-aware grading with age-scaled tolerances.
   *
   * Key insight: "reasonably close" means different things depending on
   * how ancient the work is. Scale tolerances by the artwork's age:
   *
   *   > 20,000 yrs ago (Prehistoric):  correct ±2000, close ±8000
   *   > 10,000 yrs ago (Late Prehi.):  correct ±1000, close ±4000
   *   >  4,000 yrs ago (Ancient):      correct ±300,  close ±1000
   *   >  2,000 yrs ago (Classical):    correct ±100,  close ±350
   *   >    800 yrs ago (Medieval):     correct ±75,   close ±200
   *   >    300 yrs ago (Renaissance):  correct ±25,   close ±80
   *   >    100 yrs ago (19th c.):      correct ±10,   close ±30
   *              else  (Modern):       correct ±5,    close ±15
   *
   * A wrong era (BCE vs CE) downgrades result by one level.
   * If the user omits an era marker entirely, the era check is skipped.
   */
  function gradeDates(user, correct) {
    if (!user || !user.trim()) return 'blank';

    // Normalise BCE/CE BEFORE stripping other punctuation,
    // so "B.C.E." and "C.E." are caught reliably.
    const normEra = s => {
      let t = s.toLowerCase();
      // Remove thousands-separator commas (25,000 → 25000)
      t = t.replace(/(\d),(\d)/g, '$1$2');
      // BCE variants first (must precede CE replacements)
      t = t.replace(/b\.?c\.?e\.?/gi, ' bce ');
      t = t.replace(/\bbc\b/gi,        ' bce ');
      // CE variants — lookbehind (?<!b) prevents matching the "ce" inside "bce"
      t = t.replace(/\ba\.?d\.?\b/gi,             ' ce ');
      t = t.replace(/(?<!b)c\.?e\.?\b/gi,         ' ce ');  // C.E., CE (not bce)
      // Strip remaining punctuation
      return t.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    };

    const u = normEra(user);
    const c = normEra(correct);

    // Quick exact / substring checks
    if (u === c) return 'correct';
    if (c.includes(u) || u.includes(c)) return 'correct';

    // Extract all year-like numbers, signing BCE values negative
    function extractSignedYears(str) {
      const isBce = str.includes('bce');
      return (str.match(/\d+/g) || []).map(n => {
        const v = parseInt(n, 10);
        return isBce ? -v : v;
      });
    }

    const uY = extractSignedYears(u);
    const cY = extractSignedYears(c);
    if (!uY.length || !cY.length) return gradeStandard(user, correct);

    // Era awareness: if user didn't write any era marker, skip the era check
    // (benefit of the doubt — they just wrote the number)
    const userHasEra = u.includes('bce') || /\bce\b/.test(u);
    const uBce = u.includes('bce');
    const cBce = c.includes('bce');
    const eraMatch = !userHasEra || (uBce === cBce);

    // Minimum year-difference across all user/correct year pairs
    let minDiff = Infinity;
    for (const uy of uY) for (const cy of cY) {
      minDiff = Math.min(minDiff, Math.abs(Math.abs(uy) - Math.abs(cy)));
    }

    // Age of artwork in years (from ~2025)
    const mainYear = cY[0];
    const age = mainYear < 0
      ? 2025 + Math.abs(mainYear)
      : Math.max(2025 - mainYear, 1);

    // Age-scaled tolerances
    let correctTol, closeTol;
    if      (age > 20000) { correctTol = 2000; closeTol = 8000; }
    else if (age > 10000) { correctTol = 1000; closeTol = 4000; }
    else if (age >  4000) { correctTol =  300; closeTol = 1000; }
    else if (age >  2000) { correctTol =  100; closeTol =  350; }
    else if (age >   800) { correctTol =   75; closeTol =  200; }
    else if (age >   300) { correctTol =   25; closeTol =   80; }
    else if (age >   100) { correctTol =   10; closeTol =   30; }
    else                  { correctTol =    5; closeTol =   15; }

    // Wrong era bumps result down one level
    if (minDiff <= correctTol) return eraMatch ? 'correct' : 'close';
    if (minDiff <= closeTol)   return eraMatch ? 'close'   : 'incorrect';
    return 'incorrect';
  }

  /** Significance grading: keyword/noun matching. */
  function gradeSignificance(user, correct) {
    if (!user || !user.trim()) return 'blank';

    // Extract meaningful nouns from the correct answer (filter stopwords + short words)
    const keyWords = tokenize(correct)
      .filter(w => !STOPWORDS.has(w) && w.length >= 4);

    if (keyWords.length === 0) return gradeStandard(user, correct);

    const userSet = new Set(tokenize(user));
    const matches = keyWords.filter(kw => userSet.has(kw)).length;

    if (matches >= 2) return 'correct';
    if (matches >= 1) return 'close';

    // Soft fallback: general word overlap
    const ov = wordOverlap(user, correct);
    if (ov >= 0.15) return 'close';

    return 'incorrect';
  }

  return { gradeStandard, gradeDates, gradeSignificance };
})();

// ══════════════════════════════════════════════════════════════
// App state
// ══════════════════════════════════════════════════════════════
const App = {
  deck:           null,
  sessionScore:   0,
  fieldResults:   [],   // [{field, userAnswer, correct, status, pts}]
  _isLearning:    false,

  // ── Initialise ────────────────────────────────────────────

  init() {
    this.deck = new Deck(ART_DATA);
    this._bindEvents();
    this._showQuestion();
  },

  // ── Event binding ─────────────────────────────────────────

  _bindEvents() {
    // Question screen — Check Answers
    document.getElementById('btn-check').addEventListener('click', () => this._checkAnswers());

    // Question screen — Learn This / Got it, Next Card (toggles based on learn state)
    document.getElementById('btn-learn').addEventListener('click', () => {
      if (this._isLearning) {
        this._advanceLearned();
      } else {
        this._learnThis();
      }
    });

    // Artist "Unknown" quick-fill
    document.getElementById('btn-unknown-artist').addEventListener('click', () => {
      const el = document.getElementById('f-artist');
      el.value = 'Unknown';
      el.focus();
    });

    // Review screen — Next Card
    document.getElementById('btn-next').addEventListener('click', () => this._nextCard());

    // Grade override buttons (event delegation on tbody)
    document.getElementById('review-tbody').addEventListener('click', e => {
      const btn = e.target.closest('.grade-btn');
      if (!btn) return;
      const row   = btn.closest('tr');
      const fIdx  = parseInt(row.dataset.fieldIndex, 10);
      const grade = btn.dataset.grade;
      this._overrideGrade(fIdx, grade);
    });
  },

  // ── Screen transitions ────────────────────────────────────

  _showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  // ── Question screen ───────────────────────────────────────

  _showQuestion() {
    const card = this.deck.current;
    if (!card) return;

    // Set image
    document.getElementById('q-image').src = card.image_url;
    document.getElementById('q-image').alt = `Artwork #${card.id}`;

    // Clear all fields and remove learn-mode styling
    FIELDS.forEach(f => {
      const el = document.getElementById(f.inputId);
      if (el) {
        el.value = '';
        el.classList.remove('learn-filled');
      }
    });

    // Reset learn-mode button state
    this._isLearning = false;
    const learnBtn = document.getElementById('btn-learn');
    learnBtn.textContent = 'Learn this';
    learnBtn.classList.remove('btn-learn-done');
    document.getElementById('btn-check').classList.remove('hidden');

    // Focus title
    document.getElementById('f-title').focus();

    // Update header
    this._updateHeader();

    this._showScreen('screen-question');
  },

  // ── Learn this ────────────────────────────────────────────

  /** Reveal all correct answers in the form fields so the user can study them. */
  _learnThis() {
    const card = this.deck.current;

    // Populate every field with the correct answer
    FIELDS.forEach(f => {
      const el = document.getElementById(f.inputId);
      if (el) {
        el.value = this._getCorrect(card, f);
        el.classList.add('learn-filled');
      }
    });

    // Switch button to "Got it, Next Card →"
    this._isLearning = true;
    const learnBtn = document.getElementById('btn-learn');
    learnBtn.textContent = 'Got it, Next Card →';
    learnBtn.classList.add('btn-learn-done');

    // Hide "Check Answers" — answers are already revealed
    document.getElementById('btn-check').classList.add('hidden');
  },

  /** User studied the card; re-insert 3–5 ahead without going to review. */
  _advanceLearned() {
    this.deck.advanceLearn();
    this._showQuestion();
  },

  // ── Check answers ─────────────────────────────────────────

  _checkAnswers() {
    const card = this.deck.current;

    this.fieldResults = FIELDS.map((field, idx) => {
      const el          = document.getElementById(field.inputId);
      const userAnswer  = el ? el.value.trim() : '';
      const correct     = this._getCorrect(card, field);
      const status      = this._gradeField(field, userAnswer, correct);
      const pts         = this._statusToPts(status);

      return { field, userAnswer, correct, status, pts };
    });

    this._showReview();
  },

  /** Get the correct answer string for a field + card combo. */
  _getCorrect(card, field) {
    if (field.dataKey === '_type_combined') {
      return [card.artwork_type, card.material, card.technique]
        .filter(Boolean)
        .join('; ');
    }
    return card[field.dataKey] || '';
  },

  /** Run the appropriate fuzzy grader for a field. */
  _gradeField(field, user, correct) {
    switch (field.grade) {
      case 'dates':        return Fuzzy.gradeDates(user, correct);
      case 'significance': return Fuzzy.gradeSignificance(user, correct);
      default:             return Fuzzy.gradeStandard(user, correct);
    }
  },

  _statusToPts(status) {
    switch (status) {
      case 'correct':   return 3;
      case 'close':     return 1;
      case 'blank':
      case 'incorrect': return 0;
      default:          return 0;
    }
  },

  // ── Review screen ─────────────────────────────────────────

  _showReview() {
    const card = this.deck.current;

    // Mirror image
    document.getElementById('r-image').src = card.image_url;
    document.getElementById('r-image').alt = `Artwork #${card.id}`;

    // Render table
    this._renderReviewTable();

    // Update scores
    this._updateReviewScores();

    this._showScreen('screen-review');
  },

  _renderReviewTable() {
    const tbody = document.getElementById('review-tbody');
    tbody.innerHTML = '';

    this.fieldResults.forEach((result, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.fieldIndex = idx;
      tr.className = this._rowClass(result.status);

      const userDisplay    = result.userAnswer || '—';
      const userBlankClass = result.userAnswer ? '' : 'blank';

      tr.innerHTML = `
        <td class="col-field-cell">${result.field.label}</td>
        <td><span class="user-answer-text ${userBlankClass}">${this._esc(userDisplay)}</span></td>
        <td><span class="correct-answer-text">${this._esc(result.correct)}</span></td>
        <td class="grade-cell">
          <div class="grade-btn-group">
            <button class="grade-btn ${this._btnActiveClass(result.status, 'correct')}"
                    data-grade="correct" title="Mark as correct (3 pts)">✓ Got it!</button>
            <button class="grade-btn ${this._btnActiveClass(result.status, 'close')}"
                    data-grade="close" title="Mark as close (1 pt)">~ Close</button>
            <button class="grade-btn ${this._btnActiveClass(result.status, 'incorrect')}"
                    data-grade="incorrect" title="Mark for review (0 pts)">✗ Review</button>
          </div>
          <div class="field-pts" id="pts-${idx}">${result.pts} pt${result.pts !== 1 ? 's' : ''}</div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  },

  /** Handle user clicking a grade override button. */
  _overrideGrade(fieldIdx, newGrade) {
    const result  = this.fieldResults[fieldIdx];
    result.status = newGrade;
    result.pts    = this._statusToPts(newGrade);

    // Update row class
    const row = document.querySelector(`tr[data-field-index="${fieldIdx}"]`);
    if (row) {
      row.className = this._rowClass(newGrade);
      // Update button active states
      row.querySelectorAll('.grade-btn').forEach(btn => {
        const g = btn.dataset.grade;
        btn.className = 'grade-btn ' + this._btnActiveClass(newGrade, g);
      });
      // Update pts label
      const ptsEl = document.getElementById(`pts-${fieldIdx}`);
      if (ptsEl) ptsEl.textContent = `${result.pts} pt${result.pts !== 1 ? 's' : ''}`;
    }

    this._updateReviewScores();
  },

  _updateReviewScores() {
    const cardScore = this.fieldResults.reduce((sum, r) => sum + r.pts, 0);
    const total     = this.sessionScore + cardScore;  // preview; not committed yet

    // Card score display
    document.getElementById('card-score-display').textContent = `${cardScore} / ${MAX_SCORE}`;

    // Score bar
    const pct  = (cardScore / MAX_SCORE) * 100;
    const hue  = Math.round((cardScore / MAX_SCORE) * 120); // red→green
    const fill = document.getElementById('score-bar-fill');
    fill.style.width = `${pct}%`;
    fill.style.backgroundColor = `hsl(${hue}, 65%, 42%)`;

    // Session total preview
    document.getElementById('review-session-score').textContent = `${total} pts`;
  },

  // ── Next card ─────────────────────────────────────────────

  _nextCard() {
    // Commit card score to session
    const cardScore = this.fieldResults.reduce((sum, r) => sum + r.pts, 0);
    this.sessionScore += cardScore;

    // Re-insert card into deck based on score
    this.deck.advance(cardScore);

    // Reset and show next question
    this._showQuestion();
  },

  // ── Header update ─────────────────────────────────────────

  _updateHeader() {
    document.getElementById('hdr-session-score').textContent = this.sessionScore;
    document.getElementById('hdr-studied').textContent       = this.deck.studiedCount;
  },

  // ── Helpers ───────────────────────────────────────────────

  _rowClass(status) {
    const map = { correct: 'row-got-it', close: 'row-close', incorrect: 'row-review', blank: '' };
    return map[status] || '';
  },

  _btnActiveClass(currentStatus, btnGrade) {
    if (currentStatus === btnGrade) {
      const map = { correct: 'active-got-it', close: 'active-close', incorrect: 'active-review', blank: 'active-blank' };
      return map[btnGrade] || '';
    }
    return '';
  },

  /** HTML-escape a string for safe innerHTML insertion. */
  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
