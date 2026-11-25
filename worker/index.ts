interface Env {
  TMDB_ACCESS_TOKEN?: string;
  MOVIES_TMDB_ENABLED?: string;
  MOVIES_TMDB_TERMS_APPROVED?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

type JsonRecord = Record<string, unknown>;
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGES = 'https://image.tmdb.org/t/p';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function positiveId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function imageUrl(value: unknown, size: 'w500' | 'w780' | 'w1280' = 'w500'): string | null {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(value) || value.includes('..')) return null;
  return `${TMDB_IMAGES}/${size}${value}`;
}
function mapSummary(value: unknown) {
  if (!isRecord(value)) return null;
  const id = positiveId(value.id);
  const title = stringOrNull(value.title);
  if (!id || !title) return null;
  const releaseDate = typeof value.release_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.release_date) ? value.release_date : null;
  return {
    providerId: 'tmdb', externalId: String(id), title,
    originalTitle: stringOrNull(value.original_title) ?? title,
    overview: stringOrNull(value.overview) ?? '', releaseDate,
    releaseYear: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    originalLanguage: stringOrNull(value.original_language),
    posterUrl: imageUrl(value.poster_path, 'w500'),
    backdropUrl: imageUrl(value.backdrop_path, 'w1280'),
    voteAverage: finite(value.vote_average, 0, 10), voteCount: positiveId(value.vote_count) ?? 0,
    popularity: finite(value.popularity) ?? 0, adult: value.adult === true,
  };
}
function mapGenres(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item)) return [];
    const id = positiveId(item.id); const name = stringOrNull(item.name);
    return id && name ? [{ externalId: String(id), name }] : [];
  });
}
function mapCredit(value: unknown, kind: 'cast' | 'crew', index: number) {
  if (!isRecord(value)) return null;
  const name = stringOrNull(value.name);
  if (!name) return null;
  const personId = positiveId(value.id);
  return {
    externalPersonId: personId ? String(personId) : null,
    name,
    department: stringOrNull(value.known_for_department) ?? stringOrNull(value.department),
    job: stringOrNull(value.job),
    character: kind === 'cast' ? stringOrNull(value.character) : null,
    profileUrl: imageUrl(value.profile_path, 'w500'),
    order: finite(value.order, 0, 100000) ?? index,
  };
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status >= 400
    ? { success: false, error: { code: status === 404 ? 'MOVIE_NOT_FOUND' : 'MOVIES_UNAVAILABLE', message: data } }
    : { success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function tmdb(path: string, params: Record<string, string>, env: Env, signal?: AbortSignal): Promise<unknown> {
  const token = env.TMDB_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('TMDB is not configured. Add TMDB_ACCESS_TOKEN as a Worker secret.');
  const url = new URL(TMDB_API + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal,
  });
  if (response.status === 404) throw Object.assign(new Error('TMDB has no matching movie.'), { status: 404 });
  if (response.status === 401 || response.status === 403) throw new Error('TMDB rejected the configured API credentials.');
  if (!response.ok) throw new Error(`TMDB request failed with status ${response.status}.`);
  return response.json();
}

function boundedPage(raw: string | null): number {
  const parsed = Number(raw ?? '1');
  return Number.isInteger(parsed) ? Math.max(1, Math.min(500, parsed)) : 1;
}
function mapPage(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.results)) throw new Error('TMDB returned an unexpected movie page.');
  const items = raw.results.flatMap(item => { const mapped = mapSummary(item); return mapped ? [mapped] : []; });
  return {
    items,
    page: positiveId(raw.page) ?? 1,
    totalPages: Math.min(500, positiveId(raw.total_pages) ?? 0),
    totalResults: positiveId(raw.total_results) ?? 0,
  };
}

async function routeApi(request: Request, env: Env): Promise<Response> {
  if (env.MOVIES_TMDB_ENABLED !== 'true' || env.MOVIES_TMDB_TERMS_APPROVED !== 'true') {
    return json('Movies are disabled until TMDB access and terms are explicitly enabled.', 503);
  }
  if (!env.TMDB_ACCESS_TOKEN?.trim()) return json('TMDB is not configured. Add TMDB_ACCESS_TOKEN as a Worker secret.', 503);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/v1\/movies/, '') || '/';
  try {
    if (request.method !== 'GET') return json('Only GET requests are supported by this read-only API.', 405);
    if (path === '/discover') {
      const kind = url.searchParams.get('kind') ?? 'popular';
      const allowed = ['trending_day', 'trending_week', 'popular', 'top_rated', 'upcoming', 'now_playing'];
      if (!allowed.includes(kind)) return json('Unsupported movie discovery category.', 400);
      const page = boundedPage(url.searchParams.get('page'));
      const genres = (url.searchParams.get('genres') ?? '').split(',').filter(value => /^\d{1,8}$/.test(value)).slice(0, 10);
      const params: Record<string, string> = { page: String(page) };
      let endpoint = '/movie/popular';
      const direct: Record<string, string> = {
        trending_day: '/trending/movie/day', trending_week: '/trending/movie/week',
        popular: '/movie/popular', top_rated: '/movie/top_rated',
        upcoming: '/movie/upcoming', now_playing: '/movie/now_playing',
      };
      endpoint = direct[kind];
      if (genres.length) {
        endpoint = '/discover/movie';
        params.with_genres = genres.join(',');
        const sort: Record<string, string> = {
          trending_day: 'popularity.desc', trending_week: 'popularity.desc', popular: 'popularity.desc',
          top_rated: 'vote_average.desc', upcoming: 'primary_release_date.asc', now_playing: 'popularity.desc',
        };
        params.sort_by = sort[kind];
        params.include_adult = 'false';
        if (kind === 'top_rated') params['vote_count.gte'] = '50';
      }
      return json(mapPage(await tmdb(endpoint, params, env, request.signal)));
    }
    if (path === '/search') {
      const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
      if (query.length < 1) return json({ items: [], page: 1, totalPages: 0, totalResults: 0 });
      return json(mapPage(await tmdb('/search/movie', {
        query, page: String(boundedPage(url.searchParams.get('page'))), include_adult: 'false',
        language: url.searchParams.get('language') ?? 'en-US',
      }, env, request.signal)));
    }
    if (path === '/genres') {
      const language = url.searchParams.get('language') ?? 'en-US';
      const raw = await tmdb('/genre/movie/list', { language }, env, request.signal);
      return json({ items: mapGenres(isRecord(raw) ? raw.genres : null) });
    }
    const id = path.startsWith('/') ? path.slice(1) : path;
    if (!/^[1-9]\d{0,11}$/.test(id)) return json('The requested movie was not found.', 404);
    const raw = await tmdb(`/movie/${id}`, { append_to_response: 'credits,external_ids', language: 'en-US' }, env, request.signal);
    if (!isRecord(raw)) throw new Error('TMDB returned an unexpected movie detail.');
    const summary = mapSummary(raw);
    if (!summary) return json('The requested movie was not found.', 404);
    const credits = isRecord(raw.credits) ? raw.credits : {};
    const external = isRecord(raw.external_ids) ? raw.external_ids : {};
    const imdb = stringOrNull(external.imdb_id) ?? stringOrNull(raw.imdb_id);
    const detail = {
      ...summary,
      tagline: stringOrNull(raw.tagline) ?? '',
      runtimeMinutes: positiveId(raw.runtime),
      releaseStatus: stringOrNull(raw.status),
      homepageUrl: typeof raw.homepage === 'string' && raw.homepage.startsWith('https://') ? raw.homepage : null,
      imdbId: imdb && /^tt\d+$/.test(imdb) ? imdb : null,
      genres: mapGenres(raw.genres),
      productionCountries: Array.isArray(raw.production_countries) ? raw.production_countries.flatMap(item => isRecord(item) && typeof item.iso_3166_1 === 'string' && typeof item.name === 'string' ? [{ code: item.iso_3166_1, name: item.name }] : []) : [],
      spokenLanguages: Array.isArray(raw.spoken_languages) ? raw.spoken_languages.flatMap(item => isRecord(item) && typeof item.iso_639_1 === 'string' && typeof item.name === 'string' ? [{ code: item.iso_639_1, name: item.name, englishName: stringOrNull(item.english_name) }] : []) : [],
      cast: Array.isArray(credits.cast) ? credits.cast.slice(0, 40).flatMap((item, index) => { const credit = mapCredit(item, 'cast', index); return credit ? [credit] : []; }) : [],
      crew: Array.isArray(credits.crew) ? credits.crew.slice(0, 80).flatMap((item, index) => { const credit = mapCredit(item, 'crew', index); return credit ? [credit] : []; }) : [],
    };
    return json(detail);
  } catch (error) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 502;
    const message = error instanceof Error ? error.message : 'The movie catalogue is temporarily unavailable.';
    return json(message, status);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/v1/movies')) return routeApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
