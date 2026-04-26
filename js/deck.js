/**
 * Deck — shuffled card collection with spaced-repetition re-insertion.
 *
 * Spaced repetition schedule (based on score out of 21):
 *   0        → re-appears in  3–7  cards  (total miss)
 *   1–6      → re-appears in  8–15 cards  (mostly wrong)
 *   7–13     → re-appears in 20–40 cards  (partial recall)
 *   14–20    → re-appears in 60–120 cards (good but not perfect)
 *   21       → re-inserted at end of deck (mastered)
 */
class Deck {
  /**
   * @param {Object[]} data - Array of artwork records (from ART_DATA)
   */
  constructor(data) {
    this.cards = [...data];       // working copy
    this.studiedCount = 0;        // cards reviewed this session
    this._shuffle();
  }

  // ── Public getters ─────────────────────────────────────────

  /** The card currently on top of the deck. */
  get current() {
    return this.cards[0];
  }

  /** Number of unique cards remaining (some may repeat). */
  get size() {
    return this.cards.length;
  }

  // ── Public methods ─────────────────────────────────────────

  /**
   * Record a score for the current card and advance to the next one.
   * The card is re-inserted into the deck at a position determined by the score.
   *
   * @param {number} score - Integer 0–21
   * @returns {Object} The new current card (after advance)
   */
  advance(score) {
    const card = this.cards.shift();      // remove from front
    this.studiedCount++;

    const pos = this._reinsertAt(score);  // where to put it back
    this.cards.splice(pos, 0, card);      // re-insert

    return this.cards[0];
  }

  /**
   * "Learn this" path: user peeked at the answer.
   * Re-insert 3–5 cards ahead so it comes back soon for a real attempt.
   *
   * @returns {Object} The new current card
   */
  advanceLearn() {
    const card = this.cards.shift();
    this.studiedCount++;
    const pos = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
    this.cards.splice(Math.min(pos, this.cards.length), 0, card);
    return this.cards[0];
  }

  // ── Private helpers ────────────────────────────────────────

  /** Fisher-Yates in-place shuffle. */
  _shuffle() {
    const a = this.cards;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  /**
   * Given a score (0-21), return the index at which to splice the card
   * back into the remaining deck (after the current card has been removed).
   *
   * @param {number} score
   * @returns {number} Insertion index (clamped to deck length)
   */
  _reinsertAt(score) {
    const n = this.cards.length;
    const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

    let pos;
    if (score >= 21) {
      pos = n;                       // mastered → absolute end
    } else if (score === 0) {
      pos = rand(3, 7);              // total miss → 3-7 cards
    } else if (score <= 6) {
      pos = rand(8, 15);             // mostly wrong → 8-15 cards
    } else if (score <= 13) {
      pos = rand(20, 40);            // partial → 20-40 cards
    } else {
      pos = rand(60, 120);           // good → 60-120 cards
    }

    return Math.min(pos, n);         // never past end of deck
  }
}
