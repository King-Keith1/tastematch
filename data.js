/* ============================================================
   All static constants: quiz questions, genre maps, keyword
   maps, and scoring weights. No logic lives here.
   ============================================================ */

'use strict';


/* ------------------------------------------------------------
   1. TMDB CONFIGURATION
   ------------------------------------------------------------ */

const TMDB_BASE   = 'https://api.themoviedb.org/3';
const TMDB_IMG    = 'https://image.tmdb.org/t/p/w342';
const TMDB_KEY    = '8265bd1679663a7ea12ac168da84d2e8'; // public read-only demo key

/* TMDB genre IDs for movies */
const TMDB_MOVIE_GENRES = {
  action:      28,
  adventure:   12,
  animation:   16,
  comedy:      35,
  crime:       80,
  documentary: 99,
  drama:       18,
  family:      10751,
  fantasy:     14,
  history:     36,
  horror:      27,
  music:       10402,
  mystery:     9648,
  romance:     10749,
  scifi:       878,
  thriller:    53,
  war:         10752,
  western:     37,
};

/* TMDB genre IDs for TV shows */
const TMDB_TV_GENRES = {
  action:      10759,   // Action & Adventure (TV uses combined)
  adventure:   10759,
  animation:   16,
  comedy:      35,
  crime:       80,
  documentary: 99,
  drama:       18,
  family:      10751,
  fantasy:     10765,   // Sci-Fi & Fantasy (TV uses combined)
  history:     36,
  horror:      27,      // not an official TV category but returned in results
  kids:        10762,
  mystery:     9648,
  news:        10763,
  reality:     10764,
  romance:     10749,
  scifi:       10765,
  soap:        10766,
  talk:        10767,
  thriller:    53,
  war:         10768,
  western:     37,
};


/* ------------------------------------------------------------
   2. ANILIST CONFIGURATION
   ------------------------------------------------------------ */

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

/* AniList accepts genre strings exactly as below */
const ANILIST_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi',
  'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music',
  'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life',
  'Sports', 'Supernatural', 'Thriller',
];

/* AniList tag names used for thematic filtering.
   These are matched against the tags[] field on each media item. */
const ANILIST_TAGS = {
  gore:         'Gore',
  superhero:    'Super Power',
  historical:   'Historical',
  survival:     'Survival',
  isekai:       'Isekai',
  timeTravel:   'Time Manipulation',
  found_family: 'Found Family',
  revenge:      'Revenge',
  school:       'School',
};


/* ------------------------------------------------------------
   3. QUIZ QUESTIONS
   Each question object:
     id       — key used in answers map
     step     — display label e.g. "1 of 7"
     text     — question heading
     type     — 'single' | 'multi'
     cols     — grid columns class: 'cols-1' | 'cols-2' | 'cols-3'
     options  — array of { value, label }
   ------------------------------------------------------------ */

const QUESTIONS = [
  {
    id:   'types',
    step: '1 of 7',
    text: 'What are you looking for tonight?',
    type: 'multi',
    cols: 'cols-1',
    options: [
      { value: 'movie', label: 'Movies' },
      { value: 'tv',    label: 'TV Shows' },
      { value: 'anime', label: 'Anime' },
    ],
  },

  {
    id:   'mood',
    step: '2 of 7',
    text: 'What is your mood right now?',
    type: 'single',
    cols: 'cols-2',
    options: [
      { value: 'funny',      label: 'I want to laugh' },
      { value: 'dark',       label: 'Dark and gritty' },
      { value: 'emotional',  label: 'Something emotional' },
      { value: 'action',     label: 'Non-stop action' },
      { value: 'mindBend',   label: 'Mess with my head' },
      { value: 'cozy',       label: 'Easy and cozy' },
    ],
  },

  {
    id:   'genres',
    step: '3 of 7',
    text: 'Which genres do you love? Pick as many as you like.',
    type: 'multi',
    cols: 'cols-2',
    options: [
      { value: 'action_adv', label: 'Action / Adventure' },
      { value: 'romance',    label: 'Romance' },
      { value: 'scifi',      label: 'Sci-Fi / Fantasy' },
      { value: 'thriller',   label: 'Thriller / Mystery' },
      { value: 'drama',      label: 'Drama' },
      { value: 'comedy',     label: 'Comedy' },
      { value: 'horror',     label: 'Horror' },
      { value: 'crime',      label: 'Crime / Heist' },
    ],
  },

  {
    id:   'themes',
    step: '4 of 7',
    text: 'Any themes you want to see?',
    type: 'multi',
    cols: 'cols-2',
    options: [
      { value: 'gore',        label: 'Gore / Violence' },
      { value: 'romance_th',  label: 'Romantic relationships' },
      { value: 'superhero',   label: 'Superheroes' },
      { value: 'crime_th',    label: 'Crime and investigation' },
      { value: 'supernatural',label: 'Supernatural / Occult' },
      { value: 'historical',  label: 'Historical / War' },
      { value: 'survival',    label: 'Survival' },
      { value: 'mindBend_th', label: 'Mind-bending twists' },
    ],
  },

  {
    id:   'maturity',
    step: '5 of 7',
    text: 'Content maturity level?',
    type: 'single',
    cols: 'cols-1',
    options: [
      { value: 'family', label: 'Family friendly — keep it clean' },
      { value: 'teen',   label: 'Teen and up — some edge is fine' },
      { value: 'adult',  label: 'Mature — no restrictions' },
    ],
  },

  {
    id:   'length',
    step: '6 of 7',
    text: 'How long are you willing to commit?',
    type: 'single',
    cols: 'cols-2',
    options: [
      { value: 'short',  label: 'Quick watch — under 100 minutes' },
      { value: 'feature',label: 'Standard movie length' },
      { value: 'series', label: 'Series binge — multiple episodes' },
      { value: 'any',    label: 'No preference at all' },
    ],
  },

  {
    id:   'vibe',
    step: '7 of 7',
    text: 'Finally — what kind of recommender are you?',
    type: 'single',
    cols: 'cols-2',
    options: [
      { value: 'quality',  label: 'Only the highest-rated' },
      { value: 'popular',  label: 'Popular right now' },
      { value: 'hidden',   label: 'Hidden gems and deep cuts' },
      { value: 'surprise', label: 'Completely surprise me' },
    ],
  },
];


/* ------------------------------------------------------------
   4. GENRE ANSWER → TMDB ID MAPS
   Maps quiz answer values to arrays of TMDB genre IDs.
   Used by api.js to build discover queries.
   ------------------------------------------------------------ */

const GENRE_TO_TMDB_MOVIE = {
  action_adv: [TMDB_MOVIE_GENRES.action, TMDB_MOVIE_GENRES.adventure],
  romance:    [TMDB_MOVIE_GENRES.romance],
  scifi:      [TMDB_MOVIE_GENRES.scifi, TMDB_MOVIE_GENRES.fantasy],
  thriller:   [TMDB_MOVIE_GENRES.thriller, TMDB_MOVIE_GENRES.mystery],
  drama:      [TMDB_MOVIE_GENRES.drama],
  comedy:     [TMDB_MOVIE_GENRES.comedy],
  horror:     [TMDB_MOVIE_GENRES.horror],
  crime:      [TMDB_MOVIE_GENRES.crime],
};

const GENRE_TO_TMDB_TV = {
  action_adv: [TMDB_TV_GENRES.action],
  romance:    [TMDB_TV_GENRES.romance],
  scifi:      [TMDB_TV_GENRES.scifi],
  thriller:   [TMDB_TV_GENRES.thriller, TMDB_TV_GENRES.mystery],
  drama:      [TMDB_TV_GENRES.drama],
  comedy:     [TMDB_TV_GENRES.comedy],
  horror:     [TMDB_TV_GENRES.horror],
  crime:      [TMDB_TV_GENRES.crime],
};

/* Maps mood answer values to TMDB genre IDs (used as extra signal) */
const MOOD_TO_TMDB_GENRES = {
  funny:     [TMDB_MOVIE_GENRES.comedy],
  dark:      [TMDB_MOVIE_GENRES.drama, TMDB_MOVIE_GENRES.crime, TMDB_MOVIE_GENRES.thriller],
  emotional: [TMDB_MOVIE_GENRES.drama, TMDB_MOVIE_GENRES.romance],
  action:    [TMDB_MOVIE_GENRES.action, TMDB_MOVIE_GENRES.adventure],
  mindBend:  [TMDB_MOVIE_GENRES.scifi, TMDB_MOVIE_GENRES.mystery, TMDB_MOVIE_GENRES.thriller],
  cozy:      [TMDB_MOVIE_GENRES.comedy, TMDB_MOVIE_GENRES.romance, TMDB_MOVIE_GENRES.family],
};

const MOOD_TO_TMDB_TV_GENRES = {
  funny:     [TMDB_TV_GENRES.comedy],
  dark:      [TMDB_TV_GENRES.drama, TMDB_TV_GENRES.crime, TMDB_TV_GENRES.thriller],
  emotional: [TMDB_TV_GENRES.drama, TMDB_TV_GENRES.romance],
  action:    [TMDB_TV_GENRES.action],
  mindBend:  [TMDB_TV_GENRES.scifi, TMDB_TV_GENRES.mystery, TMDB_TV_GENRES.thriller],
  cozy:      [TMDB_TV_GENRES.comedy, TMDB_TV_GENRES.romance, TMDB_TV_GENRES.family],
};


/* ------------------------------------------------------------
   5. GENRE ANSWER → ANILIST GENRE MAPS
   ------------------------------------------------------------ */

const GENRE_TO_ANILIST = {
  action_adv: ['Action', 'Adventure'],
  romance:    ['Romance'],
  scifi:      ['Sci-Fi', 'Fantasy'],
  thriller:   ['Thriller', 'Mystery', 'Psychological'],
  drama:      ['Drama'],
  comedy:     ['Comedy'],
  horror:     ['Horror'],
  crime:      ['Mystery', 'Thriller'],
};

const MOOD_TO_ANILIST = {
  funny:     ['Comedy', 'Slice of Life'],
  dark:      ['Psychological', 'Drama', 'Thriller', 'Horror'],
  emotional: ['Drama', 'Romance'],
  action:    ['Action', 'Adventure'],
  mindBend:  ['Psychological', 'Mystery', 'Sci-Fi'],
  cozy:      ['Slice of Life', 'Comedy', 'Romance'],
};

const THEME_TO_ANILIST_TAG = {
  gore:         ANILIST_TAGS.gore,
  superhero:    ANILIST_TAGS.superhero,
  historical:   ANILIST_TAGS.historical,
  survival:     ANILIST_TAGS.survival,
  supernatural: null, // handled via genre 'Supernatural'
  mindBend_th:  ANILIST_TAGS.timeTravel,
  romance_th:   null, // handled via genre 'Romance'
  crime_th:     null, // handled via genre 'Mystery'
};

/* AniList genre overrides from theme answers (supplement genre list) */
const THEME_TO_ANILIST_GENRE = {
  supernatural: 'Supernatural',
  romance_th:   'Romance',
  crime_th:     'Mystery',
};


/* ------------------------------------------------------------
   6. SCORING WEIGHTS
   Used by engine.js when calculating match scores.
   All values are additive point bonuses on a 0-100 scale.
   ------------------------------------------------------------ */

const WEIGHTS = {
  /* Rating contribution: rating (0-10) * this = up to 60 pts */
  ratingMultiplier: 6,

  /* Mood keyword found in overview text */
  moodKeywordBonus: 12,

  /* Genre match (per matched genre) */
  genreMatchBonus: 10,
  genreMatchMax:   30,   // cap so no single category dominates

  /* Vibe modifiers */
  vibeHiddenThreshold: 7.2,   // min rating to get hidden gem bonus
  vibeHiddenBonus:     18,
  vibePopularBonus:    10,    // added if popularity rank is high
  vibeSurpriseRandom:  35,    // max random jitter for surprise mode

  /* Feedback adjustments */
  likeBonus:     25,
  dislikePenalty: 50,

  /* Minimum rating to include in results at all */
  minRating: 6.4,

  /* Minimum vote count to filter noise */
  minVotesMovie: 150,
  minVotesTV:    100,
  minScoreAnime: 60,   // out of 100 on AniList scale
};


/* ------------------------------------------------------------
   7. MOOD → OVERVIEW KEYWORDS
   Used by engine.js to scan overview text for mood signals
   when genre data is absent or insufficient.
   ------------------------------------------------------------ */

const MOOD_KEYWORDS = {
  funny:     ['comedy', 'laugh', 'humor', 'humour', 'funny', 'hilarious', 'witty', 'lighthearted'],
  dark:      ['gritty', 'dark', 'brutal', 'violent', 'corrupt', 'nihil', 'bleak', 'sinister'],
  emotional: ['grief', 'love', 'loss', 'heart', 'tears', 'touching', 'moving', 'emotional', 'bond'],
  action:    ['battle', 'fight', 'war', 'mission', 'chase', 'combat', 'explosion', 'heist', 'threat'],
  mindBend:  ['twist', 'reality', 'illusion', 'secret', 'memory', 'identity', 'conspiracy', 'truth'],
  cozy:      ['slice', 'everyday', 'family', 'friendship', 'warm', 'heartwarming', 'community'],
};


/* ------------------------------------------------------------
   8. CONTENT TYPE LABELS
   Human-readable labels for each content type value.
   ------------------------------------------------------------ */

const TYPE_LABELS = {
  movie: 'Movie',
  tv:    'TV Show',
  anime: 'Anime',
};

const TYPE_BADGE_CLASSES = {
  movie: 'badge-type-movie',
  tv:    'badge-type-tv',
  anime: 'badge-type-anime',
};


/* ------------------------------------------------------------
   9. PLACEHOLDER SVG (inline, no emoji)
   Shown when a poster image fails to load or is unavailable.
   One generic film-reel path used for all content types.
   ------------------------------------------------------------ */

const POSTER_PLACEHOLDER_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="2.5"/>
    <circle cx="12" cy="12" r="3"/>
    <path d="M2 7h2M20 7h2M2 12h2M20 12h2M2 17h2M20 17h2"/>
    <path d="M7 2v2M12 2v2M17 2v2M7 20v2M12 20v2M17 20v2"/>
  </svg>`;