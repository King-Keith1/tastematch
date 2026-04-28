/* ============================================================
   TASTEMATCH — ui.js
   All render functions. Builds HTML strings and injects them
   into the DOM. No business logic, no API calls, no scoring.

   Depends on: data.js (constants), engine.js (buildTasteProfile)
   Called by:  app.js
   ============================================================ */



/* ------------------------------------------------------------
   1. HELPERS
   ------------------------------------------------------------ */

/**
 * Escape a string for safe insertion into HTML attribute values.
 * @param  {string} str
 * @returns {string}
 */
function escAttr(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}

/**
 * Escape a string for safe insertion as HTML text content.
 * @param  {string} str
 * @returns {string}
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Swap the contents of a container element.
 * Wraps the innerHTML assignment so callers stay readable.
 * @param  {string} selector
 * @param  {string} html
 */
function setHtml(selector, html) {
  const el = document.querySelector(selector);
  if (el) el.innerHTML = html;
}

/**
 * Render a star rating display (text, no emoji).
 * Returns a span string.
 * @param  {number|null} rating  — 0 to 10
 * @returns {string}
 */
function renderRating(rating) {
  if (rating === null || rating === undefined) return '';
  const val = parseFloat(rating).toFixed(1);
  return `<span class="card-rating" aria-label="Rating ${val} out of 10">
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M6 1l1.39 2.82L10.5 4.27l-2.25 2.19.53 3.1L6 8.02 3.22 9.56l.53-3.1L1.5 4.27l3.11-.45z"/>
    </svg>
    ${escHtml(val)}
  </span>`;
}

/**
 * Render the poster image or fallback placeholder.
 * @param  {object} item
 * @returns {string}
 */
function renderPoster(item) {
  if (item.poster) {
    return `<img
      class="card-poster"
      src="${escAttr(item.poster)}"
      alt="${escAttr(item.title)} poster"
      loading="lazy"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
    />
    <div class="card-poster-placeholder" style="display:none" aria-hidden="true">
      ${POSTER_PLACEHOLDER_SVG}
    </div>`;
  }
  return `<div class="card-poster-placeholder" aria-hidden="true">
    ${POSTER_PLACEHOLDER_SVG}
  </div>`;
}


/* ------------------------------------------------------------
   2. HEADER NAV
   ------------------------------------------------------------ */

/**
 * Render the header navigation appropriate for the current screen.
 * @param  {'quiz'|'loading'|'results'} screen
 * @param  {object} state
 */
function renderHeaderNav(screen, state) {
  let html = '';

  if (screen === 'results') {
    const watchedCount  = state.watched.size;
    const likedCount    = Object.values(state.feedback).filter(v => v === 'like').length;

    if (watchedCount > 0) {
      html += `<span class="nav-btn" aria-live="polite">
        ${watchedCount} watched
      </span>`;
    }
    if (likedCount > 0) {
      html += `<span class="nav-btn active" aria-live="polite">
        ${likedCount} liked
      </span>`;
    }
    html += `<button class="nav-btn" id="nav-retake">Retake quiz</button>`;
  }

  setHtml('#header-nav', html);
}


/* ------------------------------------------------------------
   3. QUIZ SCREEN
   ------------------------------------------------------------ */

/**
 * Render the progress rail above the question.
 * @param  {number} currentIndex  — 0-based
 * @param  {number} total
 * @returns {string}
 */
function renderProgressRail(currentIndex, total) {
  const segs = Array.from({ length: total }, (_, i) => {
    let cls = 'progress-seg';
    if (i < currentIndex)  cls += ' done';
    if (i === currentIndex) cls += ' active';
    return `<div class="${cls}" role="presentation"></div>`;
  });
  return `<div class="progress-rail" role="progressbar"
    aria-valuenow="${currentIndex + 1}"
    aria-valuemin="1"
    aria-valuemax="${total}"
    aria-label="Question ${currentIndex + 1} of ${total}">
    ${segs.join('')}
  </div>`;
}

/**
 * Render all option buttons for a question.
 * @param  {object}   question
 * @param  {string[]} selectedValues  — current answer array for this question
 * @returns {string}
 */
function renderOptions(question, selectedValues) {
  const selected = new Set(selectedValues);

  const buttons = question.options.map(opt => {
    const isSelected = selected.has(opt.value);
    const ariaPressed = isSelected ? 'true' : 'false';

    return `<button
      class="opt${isSelected ? ' selected' : ''}"
      data-value="${escAttr(opt.value)}"
      aria-pressed="${ariaPressed}"
    >
      <span class="opt-indicator" aria-hidden="true"></span>
      ${escHtml(opt.label)}
    </button>`;
  });

  const gridClass = `options-grid ${question.cols}${question.type === 'multi' ? ' multi' : ''}`;

  return `<div class="${gridClass}" role="group" aria-label="${escAttr(question.text)}">
    ${buttons.join('\n')}
  </div>`;
}

/**
 * Render the full quiz screen for the current question index.
 * @param  {number}  qIndex
 * @param  {object}  answers  — full answers map
 */
function renderQuiz(qIndex, answers) {
  const question = QUESTIONS[qIndex];
  const current  = answers[question.id] || [];
  const canNext  = question.type === 'multi'
    ? current.length > 0
    : current.length === 1;
  const isLast   = qIndex === QUESTIONS.length - 1;

  const html = `
    <section class="quiz-wrap" aria-label="Preference quiz">
      <h2 class="sr-only">Preference quiz — ${question.step}</h2>

      ${renderProgressRail(qIndex, QUESTIONS.length)}

      <p class="step-label" aria-hidden="true">${escHtml(question.step)}</p>
      <h3 class="question-text">${escHtml(question.text)}</h3>

      ${renderOptions(question, current)}

      ${question.type === 'multi'
        ? `<p class="hint-text" aria-live="polite">
            ${current.length === 0
              ? 'Select at least one option to continue.'
              : `${current.length} selected`}
           </p>`
        : ''}

      <nav class="quiz-nav" aria-label="Quiz navigation">
        ${qIndex > 0
          ? `<button class="btn btn-ghost" id="btn-back">Back</button>`
          : ''}
        <button
          class="btn btn-primary"
          id="btn-next"
          ${canNext ? '' : 'disabled aria-disabled="true"'}
        >
          ${isLast ? 'Find my matches' : 'Next'}
        </button>
      </nav>
    </section>`;

  setHtml('#screen', html);
  renderHeaderNav('quiz', {});
}


/* ------------------------------------------------------------
   4. LOADING SCREEN
   ------------------------------------------------------------ */

/**
 * Render the loading state while API calls are in flight.
 */
function renderLoading() {
  const html = `
    <section class="loading-screen" aria-label="Loading recommendations" aria-busy="true">
      <h2 class="sr-only">Fetching your recommendations</h2>
      <div class="loader-ring" aria-hidden="true"></div>
      <p class="loading-title">Finding your matches</p>
      <p class="loading-sub">Searching across movies, shows and anime — this takes a few seconds.</p>
      <div class="loading-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </section>`;

  setHtml('#screen', html);
  renderHeaderNav('loading', {});
}


/* ------------------------------------------------------------
   5. RESULTS SCREEN
   ------------------------------------------------------------ */

/**
 * Render a single result card.
 * @param  {object}  item
 * @param  {object}  feedback   — full feedback map
 * @param  {Set}     watchedIds
 * @returns {string}
 */
function renderCard(item, feedback, watchedIds) {
  const fb         = feedback[item.id] || null;
  const isWatched  = watchedIds.has(item.id);
  const badgeClass = TYPE_BADGE_CLASSES[item.type] || '';
  const typeLabel  = TYPE_LABELS[item.type]        || item.type;

  const metaParts = [];
  if (item.rating !== null) metaParts.push(renderRating(item.rating));
  if (item.year)            metaParts.push(`<span>${escHtml(item.year)}</span>`);

  const scoreHtml = item.score
    ? `<span class="badge badge-score" aria-label="Match score ${item.score} percent">${item.score}%</span>`
    : '';

  return `<article
    class="result-card"
    data-id="${escAttr(item.id)}"
    aria-label="${escAttr(item.title)}"
  >
    <div class="card-poster-wrap">
      ${renderPoster(item)}
      <div class="card-badges">
        <span class="badge ${badgeClass}">${escHtml(typeLabel)}</span>
        ${scoreHtml}
      </div>
    </div>

    <div class="card-body">
      <h3 class="card-title">${escHtml(item.title)}</h3>

      ${metaParts.length
        ? `<div class="card-meta-row">${metaParts.join('<span class="divider" aria-hidden="true"></span>')}</div>`
        : ''}

      ${item.overview
        ? `<p class="card-overview">${escHtml(item.overview)}</p>`
        : ''}

      <div class="card-actions" role="group" aria-label="Actions for ${escAttr(item.title)}">
        <button
          class="btn-icon${fb === 'like' ? ' active-like' : ''}"
          data-action="like"
          data-id="${escAttr(item.id)}"
          aria-label="Like ${escAttr(item.title)}"
          aria-pressed="${fb === 'like' ? 'true' : 'false'}"
          title="Like"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${fb === 'like' ? 'currentColor' : 'none'}"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
          </svg>
        </button>

        <button
          class="btn-icon${isWatched ? ' active-watched' : ''}"
          data-action="watched"
          data-id="${escAttr(item.id)}"
          aria-label="${isWatched ? 'Mark as unwatched' : 'Mark as watched'}: ${escAttr(item.title)}"
          aria-pressed="${isWatched ? 'true' : 'false'}"
          title="${isWatched ? 'Unmark watched' : 'Mark watched'}"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${isWatched ? 'currentColor' : 'none'}"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>

        <button
          class="btn-icon${fb === 'dislike' ? ' active-dislike' : ''}"
          data-action="dislike"
          data-id="${escAttr(item.id)}"
          aria-label="Dislike ${escAttr(item.title)}"
          aria-pressed="${fb === 'dislike' ? 'true' : 'false'}"
          title="Not for me"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${fb === 'dislike' ? 'currentColor' : 'none'}"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/>
            <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
          </svg>
        </button>
      </div>
    </div>
  </article>`;
}

/**
 * Render the taste profile strip from quiz answers.
 * @param  {object} answers
 * @returns {string}
 */
function renderTasteStrip(answers) {
  const chips = buildTasteProfile(answers);
  if (!chips.length) return '';

  const chipHtml = chips.map(c => `
    <div class="taste-chip">
      <span class="taste-chip-label">${escHtml(c.label)}</span>
      <span class="taste-chip-value">${escHtml(c.value)}</span>
    </div>`).join('');

  return `<div class="taste-strip" aria-label="Your taste profile">
    ${chipHtml}
  </div>`;
}

/**
 * Render the filter tab bar.
 * Only shows tabs for types that exist in the result set.
 * @param  {object[]} allResults
 * @param  {string}   activeFilter
 * @returns {string}
 */
function renderFilterTabs(allResults, activeFilter) {
  const presentTypes = new Set(allResults.map(r => r.type));

  const tabs = [
    { key: 'all',   label: 'All' },
    { key: 'movie', label: 'Movies' },
    { key: 'tv',    label: 'TV Shows' },
    { key: 'anime', label: 'Anime' },
  ].filter(t => t.key === 'all' || presentTypes.has(t.key));

  if (tabs.length <= 2) return ''; /* Only one type — tabs add no value */

  const tabHtml = tabs.map(t => `
    <button
      class="filter-tab${activeFilter === t.key ? ' active' : ''}"
      data-filter="${escAttr(t.key)}"
      aria-pressed="${activeFilter === t.key ? 'true' : 'false'}"
    >${escHtml(t.label)}</button>`).join('');

  return `<div class="filter-row" role="group" aria-label="Filter by content type">
    ${tabHtml}
  </div>`;
}

/**
 * Render the error banner (shown alongside results, not instead of).
 * @param  {string|null} errorMsg
 * @returns {string}
 */
function renderErrorBanner(errorMsg) {
  if (!errorMsg) return '';
  return `<div class="error-banner" role="alert">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    ${escHtml(errorMsg)}
  </div>`;
}

/**
 * Render the results grid.
 * Filters by active tab, excludes watched items.
 * @param  {object[]} results
 * @param  {string}   activeFilter
 * @param  {object}   feedback
 * @param  {Set}      watchedIds
 * @returns {string}
 */
function renderResultsGrid(results, activeFilter, feedback, watchedIds) {
  const visible = results.filter(r => {
    if (watchedIds.has(r.id))                          return false;
    if (activeFilter !== 'all' && r.type !== activeFilter) return false;
    return true;
  });

  if (!visible.length) {
    return `<div class="empty-state" role="status">
      <p class="empty-state-title">Nothing here yet</p>
      <p>Try a different filter, or load more results below.</p>
    </div>`;
  }

  const cards = visible
    .map(item => renderCard(item, feedback, watchedIds))
    .join('\n');

  return `<div class="results-grid" role="list" aria-label="Recommendations">
    ${cards}
  </div>`;
}

/**
 * Render the full results screen.
 * @param  {object} state  — full app state object
 */
function renderResults(state) {
  const { results, answers, feedback, watched, activeFilter, error, loadingMore } = state;

  const totalVisible = results.filter(r => {
    if (watched.has(r.id)) return false;
    if (activeFilter !== 'all' && r.type !== activeFilter) return false;
    return true;
  }).length;

  const html = `
    <section aria-label="Your recommendations">
      <h2 class="sr-only">Recommendations</h2>

      <header class="results-header">
        <h2 class="results-title">Your <em>matches</em></h2>
        <p class="results-meta">
          ${results.length} titles found
          ${totalVisible !== results.length ? ` &mdash; ${totalVisible} visible` : ''}
        </p>
      </header>

      ${renderTasteStrip(answers)}
      ${renderErrorBanner(error)}
      ${renderFilterTabs(results, activeFilter)}
      ${renderResultsGrid(results, activeFilter, feedback, watched)}

      <footer class="results-footer">
        <button class="btn btn-primary" id="btn-retake">Retake quiz</button>
        <button class="btn btn-ghost" id="btn-load-more" ${loadingMore ? 'disabled aria-disabled="true"' : ''}>
          ${loadingMore ? 'Loading...' : 'Load more'}
        </button>
        <button class="btn btn-outline" id="btn-surprise">
          Surprise me
        </button>
      </footer>
    </section>`;

  setHtml('#screen', html);
  renderHeaderNav('results', state);
}


/* ------------------------------------------------------------
   6. PARTIAL UPDATES
   These avoid a full re-render when only one part of the
   results screen changes (e.g. a single card's action buttons).
   ------------------------------------------------------------ */

/**
 * Re-render a single card in place by its data-id attribute.
 * Falls back to a full results re-render if the card is not found.
 * @param  {string}  id
 * @param  {object}  item
 * @param  {object}  feedback
 * @param  {Set}     watchedIds
 * @param  {object}  state       — passed for full fallback
 */
function updateCard(id, item, feedback, watchedIds, state) {
  const safeId = String(id).replace(/_/g, "_");
  const existing = document.querySelector("[data-id='" + safeId + "']");
  if (!existing) {
    /* Card may have been removed (watched). Re-render everything. */
    renderResults(state);
    return;
  }

  /* If now watched, animate out then remove */
  if (watchedIds.has(id)) {
    existing.style.transition = 'opacity 0.25s, transform 0.25s';
    existing.style.opacity    = '0';
    existing.style.transform  = 'scale(0.95)';
    setTimeout(() => existing.remove(), 280);
    return;
  }

  /* Replace the card HTML in place */
  const newCardHtml = renderCard(item, feedback, watchedIds);
  const temp        = document.createElement('div');
  temp.innerHTML    = newCardHtml.trim();
  const newCard     = temp.firstElementChild;
  if (newCard) existing.replaceWith(newCard);
}

/**
 * Update just the header nav without touching the screen.
 * @param  {object} state
 */
function updateHeaderNav(state) {
  renderHeaderNav('results', state);
}


/* ------------------------------------------------------------
   7. TOAST NOTIFICATIONS
   ------------------------------------------------------------ */

/**
 * Show a short toast message.
 * Auto-dismisses after `duration` ms.
 * @param  {string} message
 * @param  {number} [duration=2200]
 */
function showToast(message, duration = 2200) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast     = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.setAttribute('role', 'status');

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}