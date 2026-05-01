/* ============================================================
   TASTEMATCH — app.js
   State management, event delegation, and app initialisation.
   Orchestrates api.js, engine.js, and ui.js.
   Entry point — runs after all other scripts are loaded.
   ============================================================ */


/* ------------------------------------------------------------
   1. LOCALSTORAGE
   All persistence lives here. The rest of the app never
   touches localStorage directly.
   ------------------------------------------------------------ */

const STORAGE_KEY = 'tastematch_v1';

/**
 * Serialise state to localStorage.
 * Sets and item arrays are converted to plain JSON-safe types.
 * @param {object} s
 */
function saveToStorage(s) {
  try {
    const payload = {
      answers:     s.answers,
      feedback:    s.feedback,
      watchLater:  [...s.watchLater],
      watchingNow: [...s.watchingNow],
      /* Persist the full results pool so reopening doesn't require
         a new API fetch. Items are large-ish, so cap at 60. */
      results:     s.results.slice(0, 60).map(function(item) {
        /* Drop the computed score — it gets recalculated on load */
        var copy = Object.assign({}, item);
        delete copy.score;
        return copy;
      }),
      activeFilter: s.activeFilter,
      page:         s.page,
      /* Store screen so we can restore to results if applicable */
      screen:       s.screen === 'results' ? 'results' : 'quiz',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    /* localStorage can be unavailable (private mode, full quota) */
    console.warn('[storage] save failed:', e.message);
  }
}

/**
 * Load persisted state from localStorage.
 * Returns null if nothing is stored or data is malformed.
 * @returns {object|null}
 */
function loadFromStorage() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    var data = JSON.parse(raw);
    return {
      answers:     data.answers     || {},
      feedback:    data.feedback    || {},
      watchLater:  new Set(data.watchLater  || []),
      watchingNow: new Set(data.watchingNow || []),
      results:     data.results     || [],
      activeFilter:data.activeFilter || 'all',
      page:        data.page        || 1,
      screen:      data.screen      || 'quiz',
    };
  } catch (e) {
    console.warn('[storage] load failed:', e.message);
    return null;
  }
}

/**
 * Clear all persisted data.
 */
function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}


/* ------------------------------------------------------------
   2. STATE
   ------------------------------------------------------------ */

const INITIAL_STATE = {
  screen:      'quiz',
  qIndex:      0,
  answers:     {},
  results:     [],
  feedback:    {},
  watchLater:  new Set(),
  watchingNow: new Set(),
  activeFilter:'all',
  loadingMore: false,
  error:       null,
  page:        1,
};

let state = deepCloneState(INITIAL_STATE);

/**
 * Deep-clone the state shape, handling Sets manually.
 * @param  {object} src
 * @returns {object}
 */
function deepCloneState(src) {
  return Object.assign({}, src, {
    answers:     Object.assign({}, src.answers),
    results:     (src.results  || []).slice(),
    feedback:    Object.assign({}, src.feedback),
    watchLater:  new Set(src.watchLater),
    watchingNow: new Set(src.watchingNow),
  });
}

/**
 * Merge a partial update into state.
 * Persists to localStorage after every meaningful change.
 * @param {object} patch
 * @param {boolean} [persist=true]
 */
function setState(patch, persist) {
  state = Object.assign({}, state, patch);
  if (persist !== false) saveToStorage(state);
}


/* ------------------------------------------------------------
   3. QUIZ NAVIGATION
   ------------------------------------------------------------ */

function handleOptionClick(questionId, value, type) {
  var current = state.answers[questionId] || [];
  var next;

  if (type === 'multi') {
    next = current.includes(value)
      ? current.filter(function(v) { return v !== value; })
      : current.concat([value]);
  } else {
    next = [value];
  }

  var newAnswers = Object.assign({}, state.answers);
  newAnswers[questionId] = next;
  setState({ answers: newAnswers });
  renderQuiz(state.qIndex, state.answers);
}

function handleNext() {
  var q       = QUESTIONS[state.qIndex];
  var current = state.answers[q.id] || [];
  if (current.length === 0) return;

  if (state.qIndex < QUESTIONS.length - 1) {
    setState({ qIndex: state.qIndex + 1 }, false);
    renderQuiz(state.qIndex, state.answers);
  } else {
    startSearch();
  }
}

function handleBack() {
  if (state.qIndex === 0) return;
  setState({ qIndex: state.qIndex - 1 }, false);
  renderQuiz(state.qIndex, state.answers);
}


/* ------------------------------------------------------------
   4. SEARCH ORCHESTRATION
   ------------------------------------------------------------ */

async function startSearch() {
  setState({ screen: 'loading', error: null }, false);
  renderLoading();

  var raw      = [];
  var errorMsg = null;

  try {
    raw = await fetchAllResults(state.answers);
  } catch (err) {
    console.error('[app] fetchAllResults threw:', err);
    errorMsg = 'Something went wrong fetching results. Some recommendations may be missing.';
  }

  var scored = runEngine(raw, state.answers, state.feedback, state.watchLater, state.watchingNow);

  setState({
    screen:      'results',
    results:     scored,
    activeFilter:'all',
    page:        1,
    error:       errorMsg,
  });

  renderResults(state);
}

async function handleLoadMore() {
  if (state.loadingMore) return;

  setState({ loadingMore: true }, false);
  var btn = document.getElementById('btn-load-more');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  var nextPage    = state.page + 1;
  var existingIds = new Set(state.results.map(function(r) { return r.id; }));
  var newItems    = [];

  try {
    newItems = await fetchMoreResults(state.answers, existingIds, nextPage);
  } catch (err) {
    console.warn('[app] fetchMoreResults error:', err);
    showToast('Could not load more results.');
    setState({ loadingMore: false }, false);
    if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
    return;
  }

  if (!newItems.length) {
    showToast('No more results found.');
    setState({ loadingMore: false }, false);
    if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
    return;
  }

  var scoredNew = runEngine(newItems, state.answers, state.feedback, state.watchLater, state.watchingNow);
  var merged    = runEngine(
    state.results.concat(scoredNew),
    state.answers, state.feedback, state.watchLater, state.watchingNow
  );

  setState({ results: merged, page: nextPage, loadingMore: false });
  renderResults(state);
  showToast(scoredNew.length + ' more titles added.');
}

async function handleSurprise() {
  var btn = document.getElementById('btn-surprise');
  if (btn) { btn.disabled = true; btn.textContent = 'Finding...'; }

  var surpriseAnswers  = Object.assign({}, state.answers, { vibe: 'surprise' });
  var existingIds      = new Set(state.results.map(function(r) { return r.id; }));
  var newItems         = [];

  try {
    newItems = await fetchAllResults(surpriseAnswers);
  } catch (err) {
    console.warn('[app] surprise fetch error:', err);
  }

  var fresh = newItems.filter(function(item) { return !existingIds.has(item.id); });

  if (!fresh.length) {
    showToast('Nothing new found — try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Surprise me'; }
    return;
  }

  var scored = runEngine(fresh, surpriseAnswers, state.feedback, state.watchLater, state.watchingNow);
  var merged = runEngine(
    scored.concat(state.results),
    state.answers, state.feedback, state.watchLater, state.watchingNow
  );

  setState({ results: merged });
  renderResults(state);
  showToast(scored.length + ' surprise titles added.');
}


/* ------------------------------------------------------------
   5. FEEDBACK
   ------------------------------------------------------------ */

function handleFeedback(id, action) {
  var current = state.feedback[id] || null;
  var next    = current === action ? null : action;

  var newFeedback         = Object.assign({}, state.feedback);
  newFeedback[id]         = next;

  var rescored = rescoreAfterFeedback(
    state.results, state.answers, newFeedback, state.watchLater, state.watchingNow
  );

  setState({ feedback: newFeedback, results: rescored });

  var item = state.results.find(function(r) { return r.id === id; });
  if (item) updateCard(id, item, state.feedback, state.watchLater, state.watchingNow, state);

  updateHeaderNav(state);

  var msg = next === 'like'    ? 'Liked — results adjusted.'
          : next === 'dislike' ? 'Marked as not for you — results adjusted.'
          :                      'Feedback cleared.';
  showToast(msg);
}


/* ------------------------------------------------------------
   6. WATCH LISTS
   ------------------------------------------------------------ */

/**
 * Add or remove an item from Watch Later.
 * Removes from Watching Now if it was there.
 * @param {string} id
 */
function handleWatchLater(id) {
  var newWatchLater  = new Set(state.watchLater);
  var newWatchingNow = new Set(state.watchingNow);
  var wasInLater     = newWatchLater.has(id);

  if (wasInLater) {
    newWatchLater.delete(id);
  } else {
    newWatchLater.add(id);
    newWatchingNow.delete(id); /* Can't be in both */
  }

  var rescored = rescoreAfterFeedback(
    state.results, state.answers, state.feedback, newWatchLater, newWatchingNow
  );

  setState({ watchLater: newWatchLater, watchingNow: newWatchingNow, results: rescored });

  var item = state.results.find(function(r) { return r.id === id; });
  if (item) updateCard(id, item, state.feedback, state.watchLater, state.watchingNow, state);
  updateHeaderNav(state);

  showToast(wasInLater ? 'Removed from Watch Later.' : 'Added to Watch Later.');
}

/**
 * Add or remove an item from Watching Now.
 * Removes from Watch Later if it was there.
 * @param {string} id
 */
function handleWatchingNow(id) {
  var newWatchingNow = new Set(state.watchingNow);
  var newWatchLater  = new Set(state.watchLater);
  var wasInNow       = newWatchingNow.has(id);

  if (wasInNow) {
    newWatchingNow.delete(id);
  } else {
    newWatchingNow.add(id);
    newWatchLater.delete(id); /* Can't be in both */
  }

  var rescored = rescoreAfterFeedback(
    state.results, state.answers, state.feedback, newWatchLater, newWatchingNow
  );

  setState({ watchingNow: newWatchingNow, watchLater: newWatchLater, results: rescored });

  var item = state.results.find(function(r) { return r.id === id; });
  if (item) updateCard(id, item, state.feedback, state.watchLater, state.watchingNow, state);
  updateHeaderNav(state);

  showToast(wasInNow ? 'Removed from Watching Now.' : 'Added to Watching Now — influencing your results.');
}


/* ------------------------------------------------------------
   7. FILTER & RESET
   ------------------------------------------------------------ */

function handleFilterChange(filter) {
  setState({ activeFilter: filter }, false);
  renderResults(state);
}

function handleRetake() {
  clearStorage();
  state = deepCloneState(INITIAL_STATE);
  renderQuiz(state.qIndex, state.answers);
}


/* ------------------------------------------------------------
   8. MODAL
   ------------------------------------------------------------ */

function handleOpenModal(id) {
  var item = state.results.find(function(r) { return r.id === id; });
  if (!item) return;
  renderModal(item, state.feedback, state.watchLater, state.watchingNow);
}

function handleCloseModal() {
  closeModal(false);
}


/* ------------------------------------------------------------
   9. EVENT DELEGATION
   ------------------------------------------------------------ */

function onScreenClick(e) {
  var target = e.target.closest(
    '[data-action], [data-value], [data-filter], ' +
    '#btn-next, #btn-back, #btn-retake, #btn-load-more, #btn-surprise'
  );
  if (!target) return;

  /* Quiz option */
  if (target.dataset.value !== undefined && state.screen === 'quiz') {
    var q = QUESTIONS[state.qIndex];
    handleOptionClick(q.id, target.dataset.value, q.type);
    return;
  }

  /* Quiz nav */
  if (target.id === 'btn-next') { handleNext(); return; }
  if (target.id === 'btn-back') { handleBack(); return; }

  /* Card / modal actions */
  var action = target.dataset.action;
  var id     = target.dataset.id;

  if (action === 'open-modal')   { handleOpenModal(id);              return; }
  if (action === 'like')         { handleFeedback(id, 'like');       return; }
  if (action === 'dislike')      { handleFeedback(id, 'dislike');    return; }
  if (action === 'watch-later')  { handleWatchLater(id);             return; }
  if (action === 'watching-now') { handleWatchingNow(id);            return; }

  /* Filter tabs */
  if (target.dataset.filter !== undefined) { handleFilterChange(target.dataset.filter); return; }

  /* Footer */
  if (target.id === 'btn-retake')    { handleRetake();   return; }
  if (target.id === 'btn-load-more') { handleLoadMore(); return; }
  if (target.id === 'btn-surprise')  { handleSurprise(); return; }
}

function onHeaderClick(e) {
  var target = e.target.closest('#nav-retake, #logo-link');
  if (!target) return;
  e.preventDefault();
  handleRetake();
}

function onBodyClick(e) {
  /* Modal close button */
  if (e.target.closest('#modal-close-btn')) { handleCloseModal(); return; }

  /* Backdrop click */
  var overlay = document.getElementById('modal-overlay');
  if (overlay && e.target === overlay) { handleCloseModal(); return; }

  /* Modal action buttons */
  var btn = e.target.closest('.modal-action-btn[data-action]');
  if (!btn) return;

  var action = btn.dataset.action;
  var id     = btn.dataset.id;
  if (!id) return;

  if (action === 'like')         { handleFeedback(id, 'like');    refreshModalActions(id, state.feedback, state.watchLater, state.watchingNow); return; }
  if (action === 'dislike')      { handleFeedback(id, 'dislike'); refreshModalActions(id, state.feedback, state.watchLater, state.watchingNow); return; }
  if (action === 'watch-later')  { handleWatchLater(id);          refreshModalActions(id, state.feedback, state.watchLater, state.watchingNow); return; }
  if (action === 'watching-now') { handleWatchingNow(id);         refreshModalActions(id, state.feedback, state.watchLater, state.watchingNow); return; }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    var overlay = document.getElementById('modal-overlay');
    if (overlay) { handleCloseModal(); return; }
  }
  if ((e.key === 'Enter' || e.key === ' ') && state.screen === 'quiz') {
    var focused = document.activeElement;
    if (focused && focused.id === 'screen') {
      e.preventDefault();
      handleNext();
    }
  }
}


/* ------------------------------------------------------------
   10. INITIALISATION
   ------------------------------------------------------------ */

function init() {
  /* Restore persisted state if available */
  var saved = loadFromStorage();
  if (saved) {
    state = deepCloneState(Object.assign({}, INITIAL_STATE, saved, {
      qIndex:      0,
      loadingMore: false,
      error:       null,
    }));

    /* If we have results, re-score them with current lists and go straight
       to results screen. Otherwise start the quiz. */
    if (saved.screen === 'results' && saved.results.length) {
      var rescored = runEngine(
        state.results, state.answers, state.feedback, state.watchLater, state.watchingNow
      );
      state.results = rescored;
      state.screen  = 'results';
    } else {
      state.screen = 'quiz';
    }
  }

  /* Attach events */
  var screen = document.getElementById('screen');
  var header = document.getElementById('site-header');
  if (screen) screen.addEventListener('click', onScreenClick);
  if (header) header.addEventListener('click', onHeaderClick);
  document.addEventListener('keydown', onKeyDown);
  document.body.addEventListener('click', onBodyClick);

  /* Render correct screen */
  if (state.screen === 'results') {
    renderResults(state);
  } else {
    renderQuiz(state.qIndex, state.answers);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}