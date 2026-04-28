/* ============================================================
   TASTEMATCH — app.js
   State management, event delegation, and app initialisation.
   Orchestrates api.js, engine.js, and ui.js.
   Entry point — runs after all other scripts are loaded.
   ============================================================ */



/* ------------------------------------------------------------
   1. STATE
   Single source of truth. Never mutated directly outside of
   the setState() helper below.
   ------------------------------------------------------------ */

const INITIAL_STATE = {
  screen:      'quiz',    // 'quiz' | 'loading' | 'results'
  qIndex:      0,         // current question index
  answers:     {},        // { [questionId]: string[] }
  results:     [],        // scored + sorted item objects
  feedback:    {},        // { [itemId]: 'like' | 'dislike' | null }
  watched:     new Set(), // Set of item ids marked as watched
  activeFilter:'all',     // 'all' | 'movie' | 'tv' | 'anime'
  loadingMore: false,     // true while load-more fetch is in flight
  error:       null,      // string | null
  page:        1,         // current pagination page for load-more
};

let state = deepCloneState(INITIAL_STATE);

/**
 * Deep-clone the initial state shape.
 * Handles the Set type manually since structuredClone is not
 * available in all target browsers.
 * @param  {object} src
 * @returns {object}
 */
function deepCloneState(src) {
  return {
    ...src,
    answers:  { ...src.answers },
    results:  [...(src.results || [])],
    feedback: { ...src.feedback },
    watched:  new Set(src.watched),
  };
}

/**
 * Merge a partial update into state and return the new state.
 * Does NOT trigger a render — callers decide when to render.
 * @param  {object} patch
 */
function setState(patch) {
  state = { ...state, ...patch };
}


/* ------------------------------------------------------------
   2. QUIZ NAVIGATION
   ------------------------------------------------------------ */

/**
 * Toggle or set the answer for the current question.
 * For 'single' type: replace the answer.
 * For 'multi'  type: toggle the value in/out of the array.
 *
 * @param  {string} questionId
 * @param  {string} value
 * @param  {'single'|'multi'} type
 */
function handleOptionClick(questionId, value, type) {
  const current = state.answers[questionId] || [];

  let next;
  if (type === 'multi') {
    next = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
  } else {
    next = [value];
  }

  setState({
    answers: { ...state.answers, [questionId]: next },
  });

  renderQuiz(state.qIndex, state.answers);
}

/**
 * Advance to the next question, or trigger the search if on
 * the last question.
 */
function handleNext() {
  const q       = QUESTIONS[state.qIndex];
  const current = state.answers[q.id] || [];

  /* Guard: should not be reachable (button is disabled), but
     belt-and-braces to prevent proceeding with empty answers. */
  if (current.length === 0) return;

  if (state.qIndex < QUESTIONS.length - 1) {
    setState({ qIndex: state.qIndex + 1 });
    renderQuiz(state.qIndex, state.answers);
  } else {
    startSearch();
  }
}

/**
 * Go back one question.
 */
function handleBack() {
  if (state.qIndex === 0) return;
  setState({ qIndex: state.qIndex - 1 });
  renderQuiz(state.qIndex, state.answers);
}


/* ------------------------------------------------------------
   3. SEARCH ORCHESTRATION
   ------------------------------------------------------------ */

/**
 * Kick off the full search pipeline:
 * show loading → fetch → score → render results.
 */
async function startSearch() {
  setState({ screen: 'loading', error: null });
  renderLoading();

  let raw = [];
  let errorMsg = null;

  try {
    raw = await fetchAllResults(state.answers);
  } catch (err) {
    console.error('[app] fetchAllResults threw:', err);
    errorMsg = 'Something went wrong fetching results. Some recommendations may be missing.';
  }

  const scored = runEngine(raw, state.answers, state.feedback, state.watched);

  setState({
    screen:      'results',
    results:     scored,
    activeFilter:'all',
    page:        1,
    error:       errorMsg,
  });

  renderResults(state);
}

/**
 * Load an additional page of results and merge them in.
 * Triggered by the "Load more" button.
 */
async function handleLoadMore() {
  if (state.loadingMore) return;

  setState({ loadingMore: true });
  /* Update just the footer button state without full re-render */
  const btn = document.getElementById('btn-load-more');
  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Loading...';
  }

  const nextPage    = state.page + 1;
  const existingIds = new Set(state.results.map(r => r.id));

  let newItems = [];
  try {
    newItems = await fetchMoreResults(state.answers, existingIds, nextPage);
  } catch (err) {
    console.warn('[app] fetchMoreResults error:', err);
    showToast('Could not load more results. Try again.');
    setState({ loadingMore: false });
    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Load more';
    }
    return;
  }

  if (!newItems.length) {
    showToast('No more results found.');
    setState({ loadingMore: false });
    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Load more';
    }
    return;
  }

  /* Score the new items using current feedback */
  const scoredNew = runEngine(
    newItems,
    state.answers,
    state.feedback,
    state.watched,
  );

  /* Merge and re-sort the full list */
  const merged = runEngine(
    [...state.results, ...scoredNew],
    state.answers,
    state.feedback,
    state.watched,
  );

  setState({
    results:     merged,
    page:        nextPage,
    loadingMore: false,
  });

  renderResults(state);
  showToast(`${scoredNew.length} more titles added.`);
}

/**
 * Fetch a random page of trending content and prepend it
 * to the results list. Triggered by "Surprise me".
 */
async function handleSurprise() {
  const btn = document.getElementById('btn-surprise');
  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Finding...';
  }

  /* Temporarily override vibe to 'surprise' for the fetch */
  const surpriseAnswers = { ...state.answers, vibe: 'surprise' };
  const existingIds     = new Set(state.results.map(r => r.id));

  let newItems = [];
  try {
    newItems = await fetchAllResults(surpriseAnswers);
  } catch (err) {
    console.warn('[app] surprise fetch error:', err);
  }

  const fresh = newItems.filter(item => !existingIds.has(item.id));

  if (!fresh.length) {
    showToast('Nothing new found — try again.');
    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Surprise me';
    }
    return;
  }

  /* Score surprise items with jitter preserved */
  const scored = runEngine(fresh, surpriseAnswers, state.feedback, state.watched);

  /* Inject them at the top, re-sort everything */
  const merged = runEngine(
    [...scored, ...state.results],
    state.answers,
    state.feedback,
    state.watched,
  );

  setState({ results: merged });
  renderResults(state);
  showToast(`${scored.length} surprise titles added.`);
}


/* ------------------------------------------------------------
   4. FEEDBACK & WATCHED
   ------------------------------------------------------------ */

/**
 * Toggle like/dislike feedback for an item.
 * If the user taps the same action twice, it clears.
 * After updating, rescores visible results.
 *
 * @param  {string} id
 * @param  {'like'|'dislike'} action
 */
function handleFeedback(id, action) {
  const current = state.feedback[id] || null;
  const next    = current === action ? null : action;

  const newFeedback = { ...state.feedback, [id]: next };
  setState({ feedback: newFeedback });

  /* Re-score and re-sort results in place */
  const rescored = rescoreAfterFeedback(
    state.results,
    state.answers,
    newFeedback,
    state.watched,
  );
  setState({ results: rescored });

  /* Find the item and update its card */
  const item = state.results.find(r => r.id === id);
  if (item) {
    updateCard(id, item, state.feedback, state.watched, state);
  }

  updateHeaderNav(state);

  const msg = next === 'like'
    ? 'Marked as liked — results adjusted.'
    : next === 'dislike'
    ? 'Marked as not for you — results adjusted.'
    : 'Feedback cleared.';
  showToast(msg);
}

/**
 * Toggle watched status for an item.
 * Watched items are excluded from the visible grid.
 *
 * @param  {string} id
 */
function handleWatched(id) {
  const newWatched = new Set(state.watched);
  const wasWatched = newWatched.has(id);

  if (wasWatched) {
    newWatched.delete(id);
  } else {
    newWatched.add(id);
  }

  setState({ watched: newWatched });

  const item = state.results.find(r => r.id === id);
  if (item) {
    updateCard(id, item, state.feedback, newWatched, state);
  }

  updateHeaderNav(state);
  showToast(wasWatched ? 'Removed from watched.' : 'Marked as watched — hidden from results.');
}


/* ------------------------------------------------------------
   5. FILTER TABS
   ------------------------------------------------------------ */

/**
 * Switch the active content-type filter.
 * Only updates the grid section, not the full screen.
 * @param  {string} filter
 */
function handleFilterChange(filter) {
  setState({ activeFilter: filter });
  /* Re-render full results screen — filter change is cheap */
  renderResults(state);
}


/* ------------------------------------------------------------
   6. RESET
   ------------------------------------------------------------ */

/**
 * Reset all state back to the initial quiz screen.
 * Preserves nothing — fresh start.
 */
function handleRetake() {
  state = deepCloneState(INITIAL_STATE);
  renderQuiz(state.qIndex, state.answers);
}


/* ------------------------------------------------------------
   7. EVENT DELEGATION
   A single listener on each major container handles all
   click events via data-* attribute routing.
   This avoids attaching/detaching dozens of listeners on
   every render.
   ------------------------------------------------------------ */

/**
 * Route a click event from the #screen container.
 * @param  {MouseEvent} e
 */
function onScreenClick(e) {
  const target = e.target.closest('[data-action], [data-value], [data-filter], #btn-next, #btn-back, #btn-retake, #btn-load-more, #btn-surprise');
  if (!target) return;

  /* Quiz option button */
  if (target.dataset.value !== undefined && state.screen === 'quiz') {
    const q    = QUESTIONS[state.qIndex];
    handleOptionClick(q.id, target.dataset.value, q.type);
    return;
  }

  /* Quiz navigation */
  if (target.id === 'btn-next')  { handleNext();  return; }
  if (target.id === 'btn-back')  { handleBack();  return; }

  /* Results actions */
  if (target.dataset.action === 'like')    { handleFeedback(target.dataset.id, 'like');    return; }
  if (target.dataset.action === 'dislike') { handleFeedback(target.dataset.id, 'dislike'); return; }
  if (target.dataset.action === 'watched') { handleWatched(target.dataset.id);             return; }

  /* Filter tabs */
  if (target.dataset.filter !== undefined) { handleFilterChange(target.dataset.filter); return; }

  /* Footer buttons */
  if (target.id === 'btn-retake')    { handleRetake();     return; }
  if (target.id === 'btn-load-more') { handleLoadMore();   return; }
  if (target.id === 'btn-surprise')  { handleSurprise();   return; }
}

/**
 * Route a click event from the #site-header.
 * @param  {MouseEvent} e
 */
function onHeaderClick(e) {
  const target = e.target.closest('#nav-retake, #logo-link');
  if (!target) return;

  if (target.id === 'nav-retake' || target.id === 'logo-link') {
    e.preventDefault();
    handleRetake();
  }
}

/**
 * Handle keyboard shortcuts.
 * @param  {KeyboardEvent} e
 */
function onKeyDown(e) {
  /* Enter / Space on the #screen advances the quiz if applicable */
  if ((e.key === 'Enter' || e.key === ' ') && state.screen === 'quiz') {
    const focused = document.activeElement;
    /* Already handled by the button's own click — only intercept if
       focus is on the screen container itself */
    if (focused && focused.id === 'screen') {
      e.preventDefault();
      handleNext();
    }
  }
}


/* ------------------------------------------------------------
   8. INITIALISATION
   ------------------------------------------------------------ */

/**
 * Boot the app once the DOM is ready.
 */
function init() {
  /* Attach delegated event listeners */
  const screen = document.getElementById('screen');
  const header = document.getElementById('site-header');

  if (screen) screen.addEventListener('click', onScreenClick);
  if (header) header.addEventListener('click', onHeaderClick);
  document.addEventListener('keydown', onKeyDown);

  /* Render initial quiz screen */
  renderQuiz(state.qIndex, state.answers);
}

/* Run after the DOM is fully parsed */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}