/* ============================================================
   TASTEMATCH — engine.js
   Scoring, filtering, variety enforcement, and result ranking.
   Operates purely on normalised item objects from api.js.
   No network calls. No DOM access.
   ============================================================ */



/* ------------------------------------------------------------
   1. FILTERING
   Remove items that fail hard requirements before scoring.
   ------------------------------------------------------------ */

/**
 * Check whether a single item passes the maturity gate.
 * TMDB does not reliably tag every adult item, so we use a
 * conservative heuristic: if maturity is 'family', drop anything
 * with a rating below 6.0 that also has thriller/horror genres.
 *
 * AniList items are filtered at the query level (isAdult flag),
 * so this check is mainly for TMDB.
 *
 * @param  {object} item
 * @param  {string} maturity  — 'family' | 'teen' | 'adult'
 * @returns {boolean}
 */
function passesMaturityFilter(item, maturity) {
  if (maturity === 'adult') return true;

  if (maturity === 'family') {
    const adultGenres = new Set([
      TMDB_MOVIE_GENRES.horror,
      TMDB_MOVIE_GENRES.thriller,
      TMDB_MOVIE_GENRES.crime,
    ]);
    const hasAdultGenre = item.genres.some(g => adultGenres.has(g));
    if (hasAdultGenre && (item.rating || 0) < 6.0) return false;
  }

  return true;
}

/**
 * Check whether an item passes the minimum quality threshold.
 * @param  {object} item
 * @returns {boolean}
 */
function passesQualityFilter(item) {
  if ((item.rating || 0) < WEIGHTS.minRating) return false;
  if (item.type !== 'anime' && item.votes < WEIGHTS.minVotesMovie) return false;
  return true;
}

/**
 * Filter a full result set against hard requirements.
 * Excludes items the user has added to Watch Later or Watching Now.
 *
 * @param  {object[]} items
 * @param  {object}   answers
 * @param  {Set}      watchLater     — ids saved for later
 * @param  {Set}      watchingNow    — ids currently being watched
 * @returns {object[]}
 */
function applyHardFilters(items, answers, watchLater, watchingNow) {
  const maturity = answers.maturity || 'teen';

  return items.filter(item => {
    if (watchLater.has(item.id))               return false;
    if (watchingNow.has(item.id))              return false;
    if (!passesQualityFilter(item))            return false;
    if (!passesMaturityFilter(item, maturity)) return false;
    return true;
  });
}


/* ------------------------------------------------------------
   2. SCORING
   Assigns a 0–100 match score to each item based on how well
   it aligns with the user's quiz answers and feedback history.
   ------------------------------------------------------------ */

/**
 * Score how well an item's genres overlap with the user's
 * selected genre answers.
 * TMDB items carry genre_ids; anime items carry genre strings.
 * We work with TMDB IDs for movies/TV and string matching for anime.
 *
 * @param  {object}   item
 * @param  {string[]} selectedGenres  — quiz answer values
 * @returns {number}
 */
function scoreGenreMatch(item, selectedGenres) {
  if (!selectedGenres.length) return 0;

  let bonus = 0;

  if (item.type === 'anime') {
    /* item.genres is a string[] from AniList */
    const itemGenreSet = new Set(item.genres.map(g => g.toLowerCase()));
    for (const answer of selectedGenres) {
      const aniGenres = GENRE_TO_ANILIST[answer] || [];
      if (aniGenres.some(g => itemGenreSet.has(g.toLowerCase()))) {
        bonus += WEIGHTS.genreMatchBonus;
      }
    }
  } else {
    /* item.genres is a number[] of TMDB IDs */
    const map = item.type === 'movie' ? GENRE_TO_TMDB_MOVIE : GENRE_TO_TMDB_TV;
    const itemGenreSet = new Set(item.genres);
    for (const answer of selectedGenres) {
      const tmdbIds = map[answer] || [];
      if (tmdbIds.some(id => itemGenreSet.has(id))) {
        bonus += WEIGHTS.genreMatchBonus;
      }
    }
  }

  return Math.min(bonus, WEIGHTS.genreMatchMax);
}

/**
 * Score how well an item's overview text matches the mood.
 * This is a lightweight keyword scan — not NLP.
 *
 * @param  {object} item
 * @param  {string} mood  — quiz answer value
 * @returns {number}
 */
function scoreMoodMatch(item, mood) {
  if (!mood) return 0;
  const keywords = MOOD_KEYWORDS[mood];
  if (!keywords || !item.overview) return 0;

  const text = item.overview.toLowerCase();
  const hits  = keywords.filter(kw => text.includes(kw)).length;
  if (hits === 0) return 0;

  /* Diminishing returns: 1 hit = 1×, 2 hits = 1.5×, 3+ = 2× */
  const multiplier = hits === 1 ? 1 : hits === 2 ? 1.5 : 2;
  return Math.round(WEIGHTS.moodKeywordBonus * multiplier);
}

/**
 * Score the item's raw rating contribution.
 * Maps a 0-10 rating to roughly 0-60 points.
 *
 * @param  {object} item
 * @returns {number}
 */
function scoreRating(item) {
  return (item.rawScore || 0) * WEIGHTS.ratingMultiplier;
}

/**
 * Apply vibe-mode adjustments.
 *
 * @param  {object} item
 * @param  {string} vibe
 * @returns {number}
 */
function scoreVibe(item, vibe) {
  if (!vibe) return 0;

  switch (vibe) {
    case 'popular':
      /* Bonus for high TMDB popularity score.
         Popularity can be in the thousands; we cap contribution. */
      return Math.min(item.popularity / 100, WEIGHTS.vibePopularBonus);

    case 'hidden':
      /* Reward well-rated items that aren't super popular */
      if ((item.rawScore || 0) >= WEIGHTS.vibeHiddenThreshold) {
        const obscurityBonus = item.popularity < 20 ? 8 : 0;
        return WEIGHTS.vibeHiddenBonus + obscurityBonus;
      }
      return 0;

    case 'surprise':
      /* Inject randomness so results feel shuffled each time */
      return Math.random() * WEIGHTS.vibeSurpriseRandom;

    case 'quality':
    default:
      return 0;
  }
}

/**
 * Apply feedback adjustments from a previous session or
 * within-session like/dislike actions.
 *
 * @param  {object}  item
 * @param  {object}  feedback  — map of id → 'like' | 'dislike' | null
 * @returns {number}
 */
function scoreFeedback(item, feedback) {
  const fb = feedback[item.id];
  if (fb === 'like')    return  WEIGHTS.likeBonus;
  if (fb === 'dislike') return -WEIGHTS.dislikePenalty;
  return 0;
}

/**
 * Score genre affinity based on what the user is Watching Now.
 * Items whose genres overlap with anything in watchingNow get
 * a bonus — the engine infers taste from active viewing choices.
 * Watch Later gets a smaller signal (intent, not confirmed taste).
 *
 * @param  {object}   item
 * @param  {object[]} allItems      — full results pool (to look up genres)
 * @param  {Set}      watchingNow
 * @param  {Set}      watchLater
 * @returns {number}
 */
function scoreListAffinity(item, allItems, watchingNow, watchLater) {
  if (!watchingNow.size && !watchLater.size) return 0;

  /* Build a genre fingerprint from the user's lists */
  const nowGenres    = new Set();
  const laterGenres  = new Set();

  for (const other of allItems) {
    if (watchingNow.has(other.id)) {
      (other.genres || []).forEach(g => nowGenres.add(String(g)));
    }
    if (watchLater.has(other.id)) {
      (other.genres || []).forEach(g => laterGenres.add(String(g)));
    }
  }

  const itemGenres = (item.genres || []).map(g => String(g));
  let bonus = 0;

  for (const g of itemGenres) {
    if (nowGenres.has(g))   bonus += 8;   // strong signal
    if (laterGenres.has(g)) bonus += 4;   // weaker signal
  }

  return Math.min(bonus, 24); // cap contribution
}

/**
 * Calculate the final match score for a single item.
 * Score is clamped to [1, 99].
 *
 * @param  {object}   item
 * @param  {object}   answers
 * @param  {object}   feedback
 * @param  {object[]} allItems     — full pool, for list affinity
 * @param  {Set}      watchingNow
 * @param  {Set}      watchLater
 * @returns {number}
 */
function calculateScore(item, answers, feedback, allItems, watchingNow, watchLater) {
  const selectedGenres = answers.genres || [];
  const mood           = answers.mood   || null;
  const vibe           = answers.vibe   || 'quality';

  const base        = scoreRating(item);
  const genre       = scoreGenreMatch(item, selectedGenres);
  const moodBonus   = scoreMoodMatch(item, mood);
  const vibeBonus   = scoreVibe(item, vibe);
  const fbAdjust    = scoreFeedback(item, feedback);
  const listAffinity = scoreListAffinity(item, allItems, watchingNow, watchLater);

  const raw = base + genre + moodBonus + vibeBonus + fbAdjust + listAffinity;
  return Math.max(1, Math.min(99, Math.round(raw)));
}

/**
 * Score an entire array of items in place, attaching a `score`
 * property to each. Returns the same array.
 *
 * @param  {object[]} items
 * @param  {object}   answers
 * @param  {object}   feedback
 * @returns {object[]}
 */
function scoreAll(items, answers, feedback, watchingNow, watchLater) {
  const wn = watchingNow || new Set();
  const wl = watchLater  || new Set();
  for (const item of items) {
    item.score = calculateScore(item, answers, feedback, items, wn, wl);
  }
  return items;
}


/* ------------------------------------------------------------
   3. SORTING
   ------------------------------------------------------------ */

/**
 * Sort items by score descending, with popularity as a
 * tie-breaker to ensure deterministic ordering.
 *
 * @param  {object[]} items — already scored
 * @returns {object[]}
 */
function sortByScore(items) {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.popularity || 0) - (a.popularity || 0);
  });
}


/* ------------------------------------------------------------
   4. VARIETY ENFORCEMENT
   Prevent any single content type from monopolising the top
   results when the user selected multiple types.
   ------------------------------------------------------------ */

/**
 * Interleave items so no type appears more than `maxRun`
 * times consecutively in the top N results.
 *
 * Works by maintaining separate queues per type and round-
 * robin pulling from the heaviest queue that hasn't hit its
 * run limit.
 *
 * @param  {object[]} sorted     — score-sorted items
 * @param  {string[]} types      — selected types e.g. ['movie','anime']
 * @param  {number}   maxRun     — max consecutive items of same type
 * @returns {object[]}
 */
function enforceVariety(sorted, types, maxRun = 3) {
  if (types.length <= 1) return sorted;

  /* Build per-type queues preserving score order */
  const queues = {};
  for (const t of types) queues[t] = [];
  for (const item of sorted) {
    if (queues[item.type]) queues[item.type].push(item);
  }

  const result  = [];
  let   lastType = null;
  let   runLen   = 0;

  while (result.length < sorted.length) {
    /* Find which type has the most items left and hasn't hit maxRun */
    let chosen = null;
    let bestCount = -1;

    for (const t of types) {
      if (queues[t].length === 0) continue;

      const wouldContinueRun = (t === lastType);
      if (wouldContinueRun && runLen >= maxRun) continue;

      if (queues[t].length > bestCount) {
        bestCount = queues[t].length;
        chosen    = t;
      }
    }

    /* If every non-exhausted type is blocked by maxRun, relax the rule */
    if (chosen === null) {
      for (const t of types) {
        if (queues[t].length > 0) { chosen = t; break; }
      }
    }

    if (chosen === null) break; /* All queues empty */

    const item = queues[chosen].shift();
    result.push(item);

    if (chosen === lastType) {
      runLen++;
    } else {
      lastType = chosen;
      runLen   = 1;
    }
  }

  return result;
}


/* ------------------------------------------------------------
   5. RE-SCORE ON FEEDBACK
   Called whenever a user likes or dislikes a card so the
   visible list updates its ordering without a new API fetch.
   ------------------------------------------------------------ */

/**
 * Re-score and re-sort an existing result array after feedback
 * or list changes.
 *
 * @param  {object[]} items
 * @param  {object}   answers
 * @param  {object}   feedback
 * @param  {Set}      watchLater
 * @param  {Set}      watchingNow
 * @returns {object[]}
 */
function rescoreAfterFeedback(items, answers, feedback, watchLater, watchingNow, exploreMode) {
  const wl = watchLater  || new Set();
  const wn = watchingNow || new Set();
  const active = items.filter(item => !wl.has(item.id) && !wn.has(item.id));
  const scoreAnswers = exploreMode
    ? Object.assign({}, answers, { genres: [], mood: null })
    : answers;
  scoreAll(active, scoreAnswers, feedback, wn, wl);
  const types = answers.types || ['movie'];
  const sorted = sortByScore(active);
  return enforceVariety(sorted, types);
}


/* ------------------------------------------------------------
   6. FULL PIPELINE
   The single function app.js calls after fetchAllResults().
   Applies filters → scores → sorts → enforces variety.
   ------------------------------------------------------------ */

/**
 * Run the complete recommendation pipeline.
 *
 * @param  {object[]} rawItems     — normalised items from api.js
 * @param  {object}   answers      — quiz answers map
 * @param  {object}   feedback     — feedback map (may be empty)
 * @param  {Set}      watchLater   — ids to exclude (saved for later)
 * @param  {Set}      watchingNow  — ids to exclude (currently watching)
 * @returns {object[]}             — final ordered recommendation list
 */
function runEngine(rawItems, answers, feedback, watchLater, watchingNow, exploreMode) {
  if (!rawItems.length) return [];

  const wl    = watchLater  || new Set();
  const wn    = watchingNow || new Set();
  const types = answers.types || ['movie'];

  /* In explore mode loosen genre filtering by using a diluted answers
     copy with genres cleared — scoring still works but genre bonus is
     zero, so low-genre-overlap items rank higher relative to each other */
  const scoreAnswers = exploreMode
    ? Object.assign({}, answers, { genres: [], mood: null })
    : answers;

  /* Step 1: hard filters (same regardless of explore mode) */
  const filtered = applyHardFilters(rawItems, answers, wl, wn);

  /* Step 2: score */
  scoreAll(filtered, scoreAnswers, feedback, wn, wl);

  /* Step 3: sort */
  const sorted = sortByScore(filtered);

  /* Step 4: variety */
  const varied = enforceVariety(sorted, types);

  return varied;
}


/* ------------------------------------------------------------
   7. TASTE PROFILE SUMMARY
   Derives a small human-readable profile from quiz answers.
   Used by ui.js to render the taste strip above results.
   ------------------------------------------------------------ */

/**
 * Build an array of { label, value } pairs summarising the
 * user's taste profile.
 *
 * @param  {object} answers
 * @returns {{ label: string, value: string }[]}
 */
function buildTasteProfile(answers) {
  const chips = [];

  /* Content types */
  const types = (answers.types || []).map(t => TYPE_LABELS[t]).filter(Boolean);
  if (types.length) chips.push({ label: 'Watching', value: types.join(', ') });

  /* Mood */
  const moodLabels = {
    funny:     'Funny',
    dark:      'Dark',
    emotional: 'Emotional',
    action:    'Action',
    mindBend:  'Mind-bending',
    cozy:      'Cozy',
  };
  const mood = answers.mood;
  if (mood) chips.push({ label: 'Mood', value: moodLabels[mood] || mood });

  /* Top genres (cap at 3) */
  const genreLabels = {
    action_adv: 'Action',
    romance:    'Romance',
    scifi:      'Sci-Fi',
    thriller:   'Thriller',
    drama:      'Drama',
    comedy:     'Comedy',
    horror:     'Horror',
    crime:      'Crime',
  };
  const genres = (answers.genres || [])
    .map(g => genreLabels[g])
    .filter(Boolean)
    .slice(0, 3);
  if (genres.length) chips.push({ label: 'Genres', value: genres.join(', ') });

  /* Maturity */
  const maturityLabels = { family: 'Family', teen: 'PG-13', adult: '18+' };
  const maturity = answers.maturity;
  if (maturity) chips.push({ label: 'Rating', value: maturityLabels[maturity] || maturity });

  /* Vibe */
  const vibeLabels = {
    quality:  'Best rated',
    popular:  'Popular now',
    hidden:   'Hidden gems',
    surprise: 'Surprise me',
  };
  const vibe = answers.vibe;
  if (vibe) chips.push({ label: 'Vibe', value: vibeLabels[vibe] || vibe });

  return chips;
}