'use strict';

/**
 * FilterBar — shared theme filter UI for Image Recall, Timeline, and Period & Culture modes.
 *
 * Usage:
 *   FilterBar.init('filter-bar', callback);
 *   // callback(activeKeys) called whenever selection changes.
 *   // activeKeys is a Set<string>; empty Set = "All Works" (no filter).
 *
 * Multi-select: any number of themes can be active simultaneously.
 * The active pool is the UNION of all selected themes' artworks.
 * Selecting zero themes (or clicking "All Works") restores the full pool.
 *
 * Pills are icon-only when collapsed; the label slides in on hover or when active.
 */

/** Emoji icon for each theme pill (keyed by THEMES_DATA key; '' = All Works). */
const PILL_ICONS = {
  '':                         '◉',
  power_authority:            '👑',
  religion_ritual:            '🕍',
  human_experience:           '🧑',
  identity:                   '🎭',
  architecture_space:         '🏛',
  trade_exchange:             '⚖️',
  death_afterlife:            '💀',
  art_innovation_materials:   '🎨',
  nature_body:                '🌿',
  conflict_resistance:        '⚔️',
  narrative_storytelling:     '📜',
};

const FilterBar = {
  _activeKeys: new Set(),
  _callback:   null,

  /**
   * Render 12 pills (All Works + 11 themes) into the given container.
   * @param {string}   containerId  id of the .filter-bar element
   * @param {Function} onChangeFn   called with Set<themeKey> on every toggle
   */
  init(containerId, onChangeFn) {
    this._callback   = onChangeFn;
    this._activeKeys = new Set();

    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    // "All Works" is always first
    container.appendChild(this._makeButton('', 'All Works'));

    // One pill per theme, in THEMES_DATA insertion order
    for (const [key, theme] of Object.entries(THEMES_DATA)) {
      container.appendChild(this._makeButton(key, theme.label));
    }

    this._syncUI();

    // Keep --filter-h in sync with actual rendered bar height (handles wrapping)
    if ('ResizeObserver' in window) {
      new ResizeObserver(entries => {
        const h = entries[0].contentRect.height;
        document.documentElement.style.setProperty('--filter-h', `${h}px`);
      }).observe(container);
    }
  },

  _makeButton(key, label) {
    const btn = document.createElement('button');
    btn.type        = 'button';
    btn.className   = 'filter-pill';
    btn.dataset.key = key;   // '' for All Works
    btn.setAttribute('aria-label', label || 'All Works');

    const icon = document.createElement('span');
    icon.className   = 'pill-icon';
    icon.textContent = PILL_ICONS[key] ?? '◉';
    icon.setAttribute('aria-hidden', 'true');

    const lbl = document.createElement('span');
    lbl.className   = 'pill-label';
    lbl.textContent = label;

    btn.appendChild(icon);
    btn.appendChild(lbl);
    btn.addEventListener('click', () => this._toggle(key));
    return btn;
  },

  _toggle(key) {
    if (key === '') {
      // "All Works" clicked — clear all selections
      this._activeKeys.clear();
    } else {
      if (this._activeKeys.has(key)) {
        this._activeKeys.delete(key);
      } else {
        this._activeKeys.add(key);
      }
      // Empty set is equivalent to "All Works" — no special handling needed
    }
    this._syncUI();
    if (this._callback) this._callback(new Set(this._activeKeys));
  },

  _syncUI() {
    const allEmpty = this._activeKeys.size === 0;
    document.querySelectorAll('.filter-pill').forEach(btn => {
      const k = btn.dataset.key;
      const isActive = (k === '') ? allEmpty : this._activeKeys.has(k);
      btn.classList.toggle('filter-pill--active', isActive);
    });
  },
};
