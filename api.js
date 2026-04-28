/* ============================================================
   TASTEMATCH — api.js
   All network calls to TMDb and AniList.
   Returns normalised item objects — no scoring done here.

   Normalised item shape:
   {
     id:       string   — prefixed: 'mov_123', 'tv_456', 'ani_789'
     type:     'movie' | 'tv' | 'anime'
     title:    string
     poster:   string | null    — full image URL
     rating:   number | null    — 0-10 scale
     votes:    number           — vote / score count
     year:     string | null    — 4-digit year
     overview: string
     genres:   number[]         — TMDB genre IDs or [] for anime
     rawScore: number           — raw API rating, used by engine.js
     popularity: number         — TMDB popularity float or AniList rank
   }
   ============================================================ */

'use strict';


/* ------------------------------------------------------------
   HELPERS
   ------------------------------------------------------------ */

/**
 * Deduplicate an array of genre IDs and return at most `max`.
 * @param  {number[]} ids
 * @param  {number}   max
 * @returns {number[]}
 */
function compactGenreIds(ids, max = 3) {
  return [...new Set(ids)].slice(0, max);
}

/**
 * Build a TMDB discover query-string from a params object.
 * Only includes keys whose value is non-empty / non-null.
 * @param  {Record<string, string|number|boolean>} params
 * @returns {string}
 */
function buildTmdbQuery(params) {
  const pairs = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  return pairs.join('&');
}

/**
 * Normalise a raw TMDB movie result into the shared item shape.
 * @param  {object} m  — raw TMDB movie object
 * @returns {object}
 */
function normaliseTmdbMovie(m) {
  return {
    id:         'mov_' + m.id,
    type:       'movie',
    title:      m.title || m.original_title || 'Untitled',
    poster:     m.poster_path ? TMDB_IMG + m.poster_path : null,
    rating:     m.vote_average ?? null,
    votes:      m.vote_count  ?? 0,
    year:       m.release_date ? m.release_date.slice(0, 4) : null,
    overview:   m.overview    || '',
    genres:     m.genre_ids   || [],
    rawScore:   m.vote_average ?? 0,
    popularity: m.popularity  ?? 0,
  };
}

/**
 * Normalise a raw TMDB TV result into the shared item shape.
 * @param  {object} s  — raw TMDB TV object
 * @returns {object}
 */
function normaliseTmdbTV(s) {
  return {
    id:         'tv_' + s.id,
    type:       'tv',
    title:      s.name || s.original_name || 'Untitled',
    poster:     s.poster_path ? TMDB_IMG + s.poster_path : null,
    rating:     s.vote_average ?? null,
    votes:      s.vote_count  ?? 0,
    year:       s.first_air_date ? s.first_air_date.slice(0, 4) : null,
    overview:   s.overview    || '',
    genres:     s.genre_ids   || [],
    rawScore:   s.vote_average ?? 0,
    popularity: s.popularity  ?? 0,
  };
}

/**
 * Normalise a raw AniList media result into the shared item shape.
 * AniList scores are 0-100; we convert to 0-10 for consistency.
 * @param  {object} a  — raw AniList media object
 * @returns {object}
 */
function normaliseAniList(a) {
  const score10 = a.averageScore ? a.averageScore / 10 : null;
  return {
    id:         'ani_' + a.id,
    type:       'anime',
    title:      (a.title && (a.title.english || a.title.romaji)) || 'Untitled',
    poster:     a.coverImage?.large || a.coverImage?.medium || null,
    rating:     score10,
    votes:      a.averageScore ?? 0,
    year:       a.startDate?.year ? String(a.startDate.year) : null,
    overview:   a.description
                  ? a.description.replace(/<[^>]+>/g, '').trim()
                  : '',
    genres:     a.genres || [],
    rawScore:   score10 ?? 0,
    popularity: a.popularity ?? 0,
  };
}


/* ------------------------------------------------------------
   TMDB — MOVIES
   ------------------------------------------------------------ */

/**
 * Fetch movies from TMDB /discover/movie.
 * Returns a normalised array; empty array on failure.
 *
 * @param  {object} answers   — quiz answers map
 * @param  {object} opts
 * @param  {number} [opts.page=1]
 * @returns {Promise<object[]>}
 */
async function fetchTmdbMovies(answers, { page = 1 } = {}) {
  const selectedGenres = answers.genres || [];
  const mood           = answers.mood   || null;
  const maturity       = answers.maturity || 'teen';
  const vibe           = answers.vibe   || 'quality';

  /* Combine genre answer IDs + mood IDs */
  const genreIds = [
    ...selectedGenres.flatMap(g => GENRE_TO_TMDB_MOVIE[g] || []),
    ...(mood ? (MOOD_TO_TMDB_GENRES[mood] || []) : []),
  ];
  const withGenres = compactGenreIds(genreIds, 3).join(',');

  const sortBy     = vibe === 'popular'  ? 'popularity.desc'
                   : vibe === 'hidden'   ? 'vote_average.desc'
                   : vibe === 'surprise' ? 'popularity.desc'
                   :                       'vote_average.desc';

  const minVotes   = vibe === 'hidden' ? 80  : WEIGHTS.minVotesMovie;
  const minRating  = vibe === 'hidden' ? 7.0 : WEIGHTS.minRating;
  const includeAdult = maturity === 'adult' ? 'true' : 'false';

  const query = buildTmdbQuery({
    api_key:              TMDB_KEY,
    sort_by:              sortBy,
    'vote_average.gte':   minRating,
    'vote_count.gte':     minVotes,
    include_adult:        includeAdult,
    with_genres:          withGenres,
    page,
  });

  try {
    const res  = await fetch(`${TMDB_BASE}/discover/movie?${query}`);
    if (!res.ok) throw new Error(`TMDB movies HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(normaliseTmdbMovie);
  } catch (err) {
    console.warn('[api] fetchTmdbMovies failed:', err.message);
    return [];
  }
}


/* ------------------------------------------------------------
   TMDB — TV SHOWS
   ------------------------------------------------------------ */

/**
 * Fetch TV shows from TMDB /discover/tv.
 * Returns a normalised array; empty array on failure.
 *
 * @param  {object} answers
 * @param  {object} opts
 * @param  {number} [opts.page=1]
 * @returns {Promise<object[]>}
 */
async function fetchTmdbTV(answers, { page = 1 } = {}) {
  const selectedGenres = answers.genres || [];
  const mood           = answers.mood   || null;
  const maturity       = answers.maturity || 'teen';
  const vibe           = answers.vibe   || 'quality';

  const genreIds = [
    ...selectedGenres.flatMap(g => GENRE_TO_TMDB_TV[g] || []),
    ...(mood ? (MOOD_TO_TMDB_TV_GENRES[mood] || []) : []),
  ];
  const withGenres = compactGenreIds(genreIds, 3).join(',');

  const sortBy    = vibe === 'popular'  ? 'popularity.desc'
                  : vibe === 'hidden'   ? 'vote_average.desc'
                  : vibe === 'surprise' ? 'popularity.desc'
                  :                       'vote_average.desc';

  const minVotes  = vibe === 'hidden' ? 60  : WEIGHTS.minVotesTV;
  const minRating = vibe === 'hidden' ? 7.0 : WEIGHTS.minRating;

  /* TMDB TV discover does not have an include_adult flag in the same
     way movies do; we omit it rather than sending an invalid param. */
  const query = buildTmdbQuery({
    api_key:             TMDB_KEY,
    sort_by:             sortBy,
    'vote_average.gte':  minRating,
    'vote_count.gte':    minVotes,
    with_genres:         withGenres,
    page,
  });

  try {
    const res  = await fetch(`${TMDB_BASE}/discover/tv?${query}`);
    if (!res.ok) throw new Error(`TMDB TV HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(normaliseTmdbTV);
  } catch (err) {
    console.warn('[api] fetchTmdbTV failed:', err.message);
    return [];
  }
}


/* ------------------------------------------------------------
   TMDB — POPULAR FALLBACK
   Used when discover returns too few results, or for
   "Surprise me" mode where we want variety over relevance.
   ------------------------------------------------------------ */

/**
 * Fetch a page of popular movies and/or TV from TMDB trending.
 * @param  {'movie'|'tv'|'all'} mediaType
 * @param  {number}             page
 * @returns {Promise<object[]>}
 */
async function fetchTmdbTrending(mediaType = 'all', page = 1) {
  /* TMDB trending endpoint: /trending/{media_type}/{time_window} */
  const url = `${TMDB_BASE}/trending/${mediaType}/week?api_key=${TMDB_KEY}&page=${page}`;
  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`TMDB trending HTTP ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(item => {
      if (item.media_type === 'movie' || item.title) return normaliseTmdbMovie(item);
      if (item.media_type === 'tv'    || item.name)  return normaliseTmdbTV(item);
      return null;
    }).filter(Boolean);
  } catch (err) {
    console.warn('[api] fetchTmdbTrending failed:', err.message);
    return [];
  }
}


/* ------------------------------------------------------------
   ANILIST — ANIME
   ------------------------------------------------------------ */

/**
 * Build the AniList GraphQL query string.
 * Accepts genre and tag arrays to filter results.
 *
 * @param  {string[]} genres     — AniList genre strings
 * @param  {string[]} tags       — AniList tag names
 * @param  {boolean}  isAdult
 * @param  {string}   sortField  — AniList sort enum value
 * @param  {number}   minScore   — 0-100
 * @param  {number}   page
 * @returns {string}  GraphQL query
 */
function buildAniListQuery(genres, tags, isAdult, sortField, minScore, page) {
  const genreFilter = genres.length
    ? `genre_in: ${JSON.stringify(genres)}`
    : '';
  const tagFilter = tags.length
    ? `tag_in: ${JSON.stringify(tags)}`
    : '';
  const adultFilter = `isAdult: ${isAdult}`;

  return `
    query {
      Page(page: ${page}, perPage: 15) {
        media(
          type: ANIME
          sort: [${sortField}]
          ${genreFilter}
          ${tagFilter}
          ${adultFilter}
          averageScore_greater: ${minScore}
          status_in: [FINISHED, RELEASING]
          countryOfOrigin: "JP"
        ) {
          id
          title { romaji english }
          coverImage { large medium }
          averageScore
          popularity
          genres
          description(asHtml: false)
          startDate { year }
          tags { name rank }
        }
      }
    }
  `;
}

/**
 * Fetch anime from AniList GraphQL API.
 * Returns a normalised array; empty array on failure.
 *
 * @param  {object} answers
 * @param  {object} opts
 * @param  {number} [opts.page=1]
 * @returns {Promise<object[]>}
 */
async function fetchAniList(answers, { page = 1 } = {}) {
  const selectedGenres = answers.genres || [];
  const themes         = answers.themes || [];
  const mood           = answers.mood   || null;
  const maturity       = answers.maturity || 'teen';
  const vibe           = answers.vibe   || 'quality';
  const isAdult        = maturity === 'adult';

  /* Build genre list from genre answers + mood */
  const genreSet = new Set([
    ...selectedGenres.flatMap(g => GENRE_TO_ANILIST[g]    || []),
    ...(mood           ? (MOOD_TO_ANILIST[mood]            || []) : []),
    ...themes.map(t => THEME_TO_ANILIST_GENRE[t]).filter(Boolean),
  ]);
  const genres = [...genreSet].slice(0, 4);

  /* Build tag list from theme answers */
  const tags = themes
    .map(t => THEME_TO_ANILIST_TAG[t])
    .filter(Boolean)
    .slice(0, 3);

  const sortField = vibe === 'popular'  ? 'POPULARITY_DESC'
                  : vibe === 'hidden'   ? 'SCORE_DESC'
                  : vibe === 'surprise' ? 'POPULARITY_DESC'
                  :                       'SCORE_DESC';

  const minScore = vibe === 'hidden' ? 72 : WEIGHTS.minScoreAnime;

  const query = buildAniListQuery(genres, tags, isAdult, sortField, minScore, page);

  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
    const data = await res.json();

    if (data.errors) {
      console.warn('[api] AniList GraphQL errors:', data.errors);
      /* Return whatever partial data we got, if any */
    }

    const media = data?.data?.Page?.media || [];
    return media.map(normaliseAniList);
  } catch (err) {
    console.warn('[api] fetchAniList failed:', err.message);
    return [];
  }
}


/* ------------------------------------------------------------
   ANILIST — TRENDING FALLBACK
   ------------------------------------------------------------ */

/**
 * Fetch trending anime from AniList regardless of genre filters.
 * Used as a fallback when genre-filtered results are too sparse.
 *
 * @param  {boolean} isAdult
 * @param  {number}  page
 * @returns {Promise<object[]>}
 */
async function fetchAniListTrending(isAdult = false, page = 1) {
  const query = `
    query {
      Page(page: ${page}, perPage: 15) {
        media(
          type: ANIME
          sort: [TRENDING_DESC]
          isAdult: ${isAdult}
          averageScore_greater: 60
          status_in: [FINISHED, RELEASING]
        ) {
          id
          title { romaji english }
          coverImage { large medium }
          averageScore
          popularity
          genres
          description(asHtml: false)
          startDate { year }
        }
      }
    }
  `;
  try {
    const res = await fetch(ANILIST_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`AniList trending HTTP ${res.status}`);
    const data = await res.json();
    return (data?.data?.Page?.media || []).map(normaliseAniList);
  } catch (err) {
    console.warn('[api] fetchAniListTrending failed:', err.message);
    return [];
  }
}


/* ------------------------------------------------------------
   MAIN FETCH ORCHESTRATOR
   Called by app.js after the quiz completes.
   Fires all relevant requests in parallel, merges results,
   and applies a deduplication pass before returning.

   @param  {object} answers  — full answers map from state
   @returns {Promise<object[]>}  — normalised, deduplicated items
   ------------------------------------------------------------ */

async function fetchAllResults(answers) {
  const types    = answers.types    || ['movie'];
  const maturity = answers.maturity || 'teen';
  const isAdult  = maturity === 'adult';
  const vibe     = answers.vibe     || 'quality';

  const tasks = [];

  /* ---- TMDB movies ---- */
  if (types.includes('movie')) {
    tasks.push(fetchTmdbMovies(answers, { page: 1 }));
    /* For surprise mode, also pull trending for variety */
    if (vibe === 'surprise') {
      tasks.push(fetchTmdbTrending('movie', Math.ceil(Math.random() * 5)));
    }
  }

  /* ---- TMDB TV ---- */
  if (types.includes('tv')) {
    tasks.push(fetchTmdbTV(answers, { page: 1 }));
    if (vibe === 'surprise') {
      tasks.push(fetchTmdbTrending('tv', Math.ceil(Math.random() * 5)));
    }
  }

  /* ---- AniList anime ---- */
  if (types.includes('anime')) {
    tasks.push(fetchAniList(answers, { page: 1 }));
    if (vibe === 'surprise') {
      tasks.push(fetchAniListTrending(isAdult, Math.ceil(Math.random() * 3)));
    }
  }

  /* Run all in parallel; individual failures return [] so
     Promise.allSettled is not needed — errors are swallowed per-task */
  const batches = await Promise.all(tasks);
  const all     = batches.flat();

  /* Deduplicate by id */
  const seen = new Set();
  const deduped = all.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  /* If we got nothing at all, fall back to TMDB trending */
  if (deduped.length === 0) {
    console.warn('[api] All queries returned empty — using trending fallback');
    const fallback = await fetchTmdbTrending('all', 1);
    return fallback;
  }

  return deduped;
}


/* ------------------------------------------------------------
   LOAD MORE
   Fetches an additional page for the types that were
   originally selected, merges with existing ids to avoid dupes.

   @param  {object}   answers      — original quiz answers
   @param  {Set}      existingIds  — ids already in state.results
   @param  {number}   page         — page number to load
   @returns {Promise<object[]>}
   ------------------------------------------------------------ */

async function fetchMoreResults(answers, existingIds, page = 2) {
  const types = answers.types || ['movie'];
  const tasks = [];

  if (types.includes('movie')) tasks.push(fetchTmdbMovies(answers, { page }));
  if (types.includes('tv'))    tasks.push(fetchTmdbTV(answers,    { page }));
  if (types.includes('anime')) tasks.push(fetchAniList(answers,   { page }));

  const batches = await Promise.all(tasks);
  const all     = batches.flat();

  return all.filter(item => !existingIds.has(item.id));
}