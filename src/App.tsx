import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Compass, Film, Flame,
  Home, Play, Search, ThumbsUp,
} from 'lucide-react';

const API = '/api/v1/movies';
const CINESRC = 'https://cinesrc.st';
const LIBRARY_KEY = 'crude-movies-library:v1:guest';
const PLAYBACK_PREFIX = 'crude-media-playback:v1:guest:movie:';

type Movie = {
  providerId: string; externalId: string; title: string; originalTitle: string; overview: string;
  releaseDate: string | null; releaseYear: number | null; originalLanguage: string | null;
  posterUrl: string | null; backdropUrl: string | null; voteAverage: number | null;
  voteCount: number; popularity: number; adult: boolean;
};
type Genre = { externalId: string; name: string };
type Credit = { externalPersonId: string | null; name: string; department: string | null; job: string | null; character: string | null; profileUrl: string | null; order: number };
type MovieDetail = Movie & {
  tagline: string; runtimeMinutes: number | null; releaseStatus: string | null; homepageUrl: string | null;
  imdbId: string | null; genres: Genre[]; productionCountries: { code: string; name: string }[];
  spokenLanguages: { code: string; name: string; englishName: string | null }[]; cast: Credit[]; crew: Credit[];
};
type MoviePage = { items: Movie[]; page: number; totalPages: number; totalResults: number };
type SavedMovie = Movie & { status: 'watchlist' | 'watched' | null; isFavorite: boolean; updatedAt: number };
type PlayerSnapshot = { progressSeconds: number; durationSeconds: number | null; completed: boolean; volume?: number; muted?: boolean; playbackRate?: number; sourceId?: string; updatedAt: number };

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + path, { headers: { Accept: 'application/json' }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Could not reach the movie catalogue. Check your connection and Worker configuration.');
  }
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; error?: { message?: string } } | null;
  if (!response.ok || !payload?.success || payload.data === undefined) throw new Error(payload?.error?.message ?? `Request failed (${response.status}).`);
  return payload.data;
}
function movieYear(movie: Pick<Movie, 'releaseYear' | 'releaseDate'>): string | null {
  return movie.releaseYear ? String(movie.releaseYear) : movie.releaseDate?.slice(0, 4) ?? null;
}
function moviePath(movie: Pick<Movie, 'externalId'>): string { return `/movies/${encodeURIComponent(movie.externalId)}`; }
function watchPath(movie: Pick<Movie, 'externalId'>): string { return moviePath(movie) + '/watch'; }
function imageOf(movie: Movie, poster = false): string | null { return poster ? movie.posterUrl || movie.backdropUrl : movie.backdropUrl || movie.posterUrl; }

function readLibrary(): SavedMovie[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedMovie => Boolean(item && typeof item === 'object' && typeof (item as SavedMovie).externalId === 'string' && typeof (item as SavedMovie).title === 'string'));
  } catch { return []; }
}
function writeLibrary(items: SavedMovie[]): void {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(items.slice(0, 500))); } catch { /* Local storage may be disabled. */ }
  window.dispatchEvent(new Event('crude:movie-library-change'));
}
function savedFor(movie: Movie): SavedMovie | undefined {
  return readLibrary().find(item => item.providerId === movie.providerId && item.externalId === movie.externalId);
}
function updateSaved(movie: Movie, patch: { status?: 'watchlist' | 'watched' | null; isFavorite?: boolean }): void {
  const current = savedFor(movie);
  const next: SavedMovie = {
    ...movie,
    status: patch.status === undefined ? current?.status ?? null : patch.status,
    isFavorite: patch.isFavorite === undefined ? current?.isFavorite ?? false : patch.isFavorite,
    updatedAt: Date.now(),
  };
  const rest = readLibrary().filter(item => item.providerId !== movie.providerId || item.externalId !== movie.externalId);
  if (next.status !== null || next.isFavorite) rest.unshift(next);
  writeLibrary(rest);
}
function readPlayback(id: string): PlayerSnapshot | null {
  try {
    const raw = localStorage.getItem(PLAYBACK_PREFIX + encodeURIComponent(id));
    if (!raw) return null;
    const value = JSON.parse(raw) as PlayerSnapshot;
    return Number.isFinite(value.progressSeconds) ? value : null;
  } catch { return null; }
}
function writePlayback(id: string, value: PlayerSnapshot): void {
  try { localStorage.setItem(PLAYBACK_PREFIX + encodeURIComponent(id), JSON.stringify(value)); } catch { /* Optional local persistence. */ }
}

function Sidebar() {
  const links = [
    { to: '/movies', label: 'Home', Icon: Home, end: true },
    { to: '/movies/browse/trending', label: 'Trending', Icon: Flame },
    { to: '/movies/browse/popular', label: 'Discover', Icon: Compass },
    { to: '/movies/search', label: 'Search', Icon: Search },
    { to: '/movies/library', label: 'My List', Icon: Bookmark },
  ];
  return <aside className="cr-rail" aria-label="Movies navigation">
    <Link to="/movies" className="cr-brand" aria-label="Crude Movies"><span className="cr-brand-mark">C</span></Link>
    <nav className="cr-rail-links">{links.map(({ to, label, Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `cr-rail-link${isActive ? ' active' : ''}`} aria-label={label}><Icon size={20} strokeWidth={1.8} /><span className="cr-rail-tooltip">{label}</span></NavLink>)}</nav>
  </aside>;
}
function SearchHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(location.pathname === '/movies/search' ? new URLSearchParams(location.search).get('q') ?? '' : '');
  }, [location.pathname, location.search]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = value.trim().slice(0, 120);
    navigate(query ? `/movies/search?q=${encodeURIComponent(query)}` : '/movies/search');
  };
  return <header className="cr-topbar"><div className="cr-topbar-inner">
    <form className="cr-search-wrap" role="search" onSubmit={submit}>
      <div className="cr-top-search"><input aria-label="Search movies" placeholder="Search movies..." maxLength={120} value={value} onChange={event => setValue(event.target.value)} /><button type="submit" className="cr-top-go" aria-label="Search"><Search size={17} /></button></div>
    </form>
    <span className="cr-topbar-label"><Film size={16} /> MOVIES</span>
  </div></header>;
}
function Shell() {
  const location = useLocation();
  const isWatch = location.pathname.endsWith('/watch');
  return <div className={`cr-app mv-app${isWatch ? ' mv-watch-app' : ''}`}>
    {!isWatch && <><Sidebar /><SearchHeader /></>}
    <main id="main" className="cr-main" tabIndex={-1}>
      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route path="/movies" element={<HomePage />} />
        <Route path="/movies/search" element={<SearchPage />} />
        <Route path="/movies/library" element={<LibraryPage />} />
        <Route path="/movies/browse/:category" element={<BrowsePage />} />
        <Route path="/movies/:externalId/watch" element={<WatchPage />} />
        <Route path="/movies/:externalId" element={<DetailPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </main>
  </div>;
}

function MyListButton({ movie, watched = false }: { movie: Movie; watched?: boolean }) {
  const [saved, setSaved] = useState(() => savedFor(movie));
  useEffect(() => {
    const refresh = () => setSaved(savedFor(movie));
    window.addEventListener('crude:movie-library-change', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('crude:movie-library-change', refresh); window.removeEventListener('storage', refresh); };
  }, [movie.providerId, movie.externalId]);
  const inList = watched ? saved?.status === 'watched' : saved?.status === 'watchlist';
  return <button type="button" className="nf-round" aria-pressed={inList} title={inList ? 'Remove from My List' : 'Add to My List'} aria-label={inList ? 'Remove from My List' : 'Add to My List'} onClick={() => updateSaved(movie, { status: inList ? null : (watched ? 'watched' : 'watchlist') })}>{inList ? <Check size={16} /> : <Bookmark size={15} />}</button>;
}
function LikeButton({ movie }: { movie: Movie }) {
  const [liked, setLiked] = useState(() => savedFor(movie)?.isFavorite ?? false);
  useEffect(() => {
    const refresh = () => setLiked(savedFor(movie)?.isFavorite ?? false);
    window.addEventListener('crude:movie-library-change', refresh);
    return () => window.removeEventListener('crude:movie-library-change', refresh);
  }, [movie.providerId, movie.externalId]);
  return <button type="button" className="nf-round" aria-pressed={liked} aria-label={liked ? 'Unlike' : 'Like'} title={liked ? 'Unlike' : 'Like'} onClick={() => updateSaved(movie, { isFavorite: !liked })}><ThumbsUp size={14} fill={liked ? 'currentColor' : 'none'} /></button>;
}
function MovieCard({ movie, poster = false }: { movie: Movie; poster?: boolean }) {
  const image = imageOf(movie, poster);
  const rating = movie.voteAverage ? Math.round(movie.voteAverage * 10) : null;
  const year = movieYear(movie);
  return <article className={`nf-card${poster ? ' nf-poster' : ' nf-landscape'}`}>
    <div className="nf-card-box">
      <Link to={moviePath(movie)} className="nf-thumb" aria-label={`More info: ${movie.title}`}>
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="nf-thumb-fallback">{movie.title}</span>}
        {!poster && <span className="nf-thumb-title">{movie.title}</span>}
      </Link>
      <div className="nf-panel"><div className="nf-panel-actions"><Link to={watchPath(movie)} className="nf-round solid" aria-label={`Play ${movie.title}`}><Play size={14} fill="currentColor" /></Link><MyListButton movie={movie} /><LikeButton movie={movie} /><Link to={moviePath(movie)} className="nf-round nf-more" aria-label={`More about ${movie.title}`}><ChevronRight size={15} /></Link></div>
        <p className="nf-panel-title">{movie.title}</p><p className="nf-panel-meta">{rating ? <b>{rating}% rated</b> : null}{year ? <span>{year}</span> : null}{movie.originalLanguage ? <span className="nf-box">{movie.originalLanguage.toUpperCase()}</span> : null}</p>
      </div>
    </div>
  </article>;
}
function MovieRail({ title, items, to, topTen = false }: { title: string; items: Movie[]; to?: string; topTen?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const move = (direction: number) => track.current?.scrollBy({ left: direction * Math.max(400, track.current.clientWidth * 0.82), behavior: 'smooth' });
  return <section className="nf-row">
    <div className="nf-row-head"><h2 className="nf-row-title">{to ? <Link to={to}><span>{title}</span><span className="nf-explore">Explore All <ChevronRight size={14} /></span></Link> : title}</h2>
      <div className="nf-rail-arrows"><button type="button" onClick={() => move(-1)} aria-label={`Previous ${title}`}><ChevronLeft size={20} /></button><button type="button" onClick={() => move(1)} aria-label={`Next ${title}`}><ChevronRight size={20} /></button></div>
    </div>
    <div className={`nf-slider${topTen ? ' nf-top-ten' : ''}`}><div className="nf-track" ref={track}>
      {items.map((movie, index) => <div className={`nf-cell${topTen ? ' nf-ten' : ''}`} key={movie.providerId + ':' + movie.externalId}>{topTen && <span className="nf-rank">{index + 1}</span>}<MovieCard movie={movie} poster={topTen} /></div>)}
    </div></div>
  </section>;
}
function MovieGrid({ items }: { items: Movie[] }) {
  return <div className="nf-grid">{items.map(movie => <div className="nf-gcell" key={movie.providerId + ':' + movie.externalId}><MovieCard movie={movie} /></div>)}</div>;
}
function LoadingRows() {
  return <div className="nf-rows">{['Top 10 Movies This Week', 'Popular Movies', 'Top Rated Movies'].map(title => <section className="nf-row" key={title}><div className="nf-row-head"><span className="nf-skel nf-skel-title" /></div><div className="nf-slider"><div className="nf-track">{Array.from({ length: 6 }, (_, index) => <div className="nf-cell" key={index}><div className="nf-skel nf-skel-card" /></div>)}</div></div></section>)}</div>;
}
function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="nf-message" role="alert"><h2>Something went wrong</h2><p>{message}</p>{retry && <button type="button" className="nf-btn play" onClick={retry}>Try again</button>}</div>;
}

function HomePage() {
  const [data, setData] = useState<{ trending: Movie[]; popular: Movie[]; topRated: Movie[]; upcoming: Movie[]; nowPlaying: Movie[]; genres: Genre[] }>({ trending: [], popular: [], topRated: [], upcoming: [], nowPlaying: [], genres: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const load = useCallback((signal: AbortSignal) => {
    setLoading(true); setError('');
    Promise.all([
      apiGet<MoviePage>('/discover?kind=trending_week&page=1', signal),
      apiGet<MoviePage>('/discover?kind=popular&page=1', signal),
      apiGet<MoviePage>('/discover?kind=top_rated&page=1', signal),
      apiGet<MoviePage>('/discover?kind=upcoming&page=1', signal),
      apiGet<MoviePage>('/discover?kind=now_playing&page=1', signal),
      apiGet<{ items: Genre[] }>('/genres?language=en-US', signal),
    ]).then(([trending, popular, topRated, upcoming, nowPlaying, genres]) => {
      if (!signal.aborted) setData({ trending: trending.items, popular: popular.items, topRated: topRated.items, upcoming: upcoming.items, nowPlaying: nowPlaying.items, genres: genres.items });
    }).catch(error => { if (!signal.aborted) setError(error instanceof Error ? error.message : 'Could not load movies.'); }).finally(() => { if (!signal.aborted) setLoading(false); });
  }, []);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load, retry]);
  const featured = data.trending.find(movie => movie.backdropUrl) ?? data.popular.find(movie => movie.backdropUrl) ?? null;
  return <div className="nf nf-bleed nf-home">
    {featured ? <header className="nf-billboard">{featured.backdropUrl && <img className="nf-bb-art" src={featured.backdropUrl} alt="" fetchPriority="high" referrerPolicy="no-referrer" />}<div className="nf-bb-fade" /><div className="nf-bb-info"><p className="nf-bb-tag"><i />MOVIE</p><h1 className="nf-bb-title"><Link to={moviePath(featured)}>{featured.title}</Link></h1><div className="nf-bb-buttons"><Link to={watchPath(featured)} className="nf-btn play"><Play size={18} fill="currentColor" /> Play</Link><MyListButton movie={featured} /></div>{featured.overview && <p className="nf-bb-text">{featured.overview}</p>}</div></header> : loading ? <div className="nf-billboard nf-skel" /> : <div className="nf-top-space" />}
    {error && <ErrorMessage message={error} retry={() => setRetry(value => value + 1)} />}
    {loading ? <LoadingRows /> : <div className="nf-rows">
      <MovieRail title="Top 10 Movies This Week" items={data.trending.slice(0, 10)} to="/movies/browse/trending" topTen />
      <MovieRail title="Popular Movies" items={data.popular} to="/movies/browse/popular" />
      <MovieRail title="Trending Now" items={data.trending.slice(10)} to="/movies/browse/trending" />
      <MovieRail title="Top Rated" items={data.topRated} to="/movies/browse/top-rated" />
      <MovieRail title="New Releases" items={data.nowPlaying} to="/movies/browse/now-playing" />
      <MovieRail title="Coming Soon" items={data.upcoming} to="/movies/browse/upcoming" />
      {data.genres.slice(0, 8).map(genre => <GenreRail key={genre.externalId} genre={genre} />)}
      {data.trending.length === 0 && !error && <div className="nf-message"><h2>No movies available right now.</h2><p>Try again later or search for a title.</p><Link to="/movies/search" className="nf-btn play">Search</Link></div>}
    </div>}
    {!loading && <footer className="nf-footer"><div className="nf-footer-in"><nav className="nf-footer-links"><Link to="/movies/browse/trending">Trending Now</Link><Link to="/movies/browse/popular">Popular Movies</Link><Link to="/movies/browse/top-rated">Top Rated</Link><Link to="/movies/search">Search</Link><Link to="/movies/library">My List</Link></nav><p className="nf-footer-note">Movie data and images are provided by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div></footer>}
  </div>;
}
function GenreRail({ genre }: { genre: Genre }) {
  const [items, setItems] = useState<Movie[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    const controller = new AbortController();
    const load = () => {
      apiGet<MoviePage>(`/discover?kind=popular&page=1&genres=${genre.externalId}`, controller.signal)
        .then(page => { if (!controller.signal.aborted) setItems(page.items); })
        .catch(() => { if (!controller.signal.aborted) setItems([]); });
    };
    if (!node || typeof IntersectionObserver === 'undefined') { load(); return () => controller.abort(); }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '450px 0px' });
    observer.observe(node);
    return () => { observer.disconnect(); controller.abort(); };
  }, [genre.externalId]);
  return <div ref={ref}>{items === null ? <section className="nf-row"><div className="nf-row-head"><span className="nf-skel nf-skel-title" /></div><div className="nf-slider"><div className="nf-track">{Array.from({ length: 6 }, (_, i) => <div className="nf-cell" key={i}><div className="nf-skel nf-skel-card" /></div>)}</div></div></section> : <MovieRail title={`${genre.name} Movies`} items={items} to={`/movies/browse/genre-${genre.externalId}`} />}</div>;
}

const CATEGORIES: Record<string, { title: string; kind: string }> = {
  trending: { title: 'Trending Now', kind: 'trending_week' }, popular: { title: 'Popular Movies', kind: 'popular' },
  'top-rated': { title: 'Top Rated', kind: 'top_rated' }, upcoming: { title: 'Coming Soon', kind: 'upcoming' },
  'now-playing': { title: 'New Releases', kind: 'now_playing' },
};
function BrowsePage() {
  const { category = 'popular' } = useParams();
  const genreId = category.startsWith('genre-') ? category.slice(6) : null;
  const config = CATEGORIES[category];
  const valid = Boolean(config || (genreId && /^\d{1,8}$/.test(genreId)));
  const [items, setItems] = useState<Movie[]>([]); const [genres, setGenres] = useState<Genre[]>([]);
  const [page, setPage] = useState(1); const [totalPages, setTotalPages] = useState(1); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); apiGet<{ items: Genre[] }>('/genres?language=en-US', controller.signal).then(result => setGenres(result.items)).catch(() => undefined); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!valid) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    const kind = config?.kind ?? 'popular';
    apiGet<MoviePage>(`/discover?kind=${kind}&page=${page}${genreId ? `&genres=${genreId}` : ''}`, controller.signal).then(result => {
      if (controller.signal.aborted) return; setTotalPages(Math.min(result.totalPages, 500)); setItems(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.externalId === item.externalId))]);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load this collection.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [category, config?.kind, genreId, page, retry, valid]);
  const title = genreId ? genres.find(genre => genre.externalId === genreId)?.name + ' Movies' : config?.title ?? 'Movies';
  if (!valid) return <div className="nf nf-bleed nf-page"><div className="nf-message"><h2>Page not found</h2><Link to="/movies" className="nf-btn play">Back to Movies</Link></div></div>;
  return <div className="nf nf-bleed nf-page"><header className="nf-page-head"><h1>{title}</h1><GenreMenu genres={genres} activeId={genreId} /></header>
    {error && <ErrorMessage message={error} retry={() => setRetry(value => value + 1)} />}
    {items.length > 0 && <MovieGrid items={items} />}
    {!loading && !error && !items.length && <div className="nf-message"><h2>No titles found here.</h2><p>Try another category or search for a movie.</p><Link to="/movies/search" className="nf-btn play">Search</Link></div>}
    {loading && <GridLoading />}
    {!loading && page < totalPages && <div className="nf-load-more"><button type="button" className="nf-btn info" onClick={() => setPage(value => value + 1)}>Load more</button></div>}
  </div>;
}
function GenreMenu({ genres, activeId }: { genres: Genre[]; activeId: string | null }) {
  const [open, setOpen] = useState(false);
  return <div className="nf-genre"><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>Genres <ChevronRight size={15} /></button>{open && <div className="nf-genre-menu"><Link to="/movies/browse/popular" onClick={() => setOpen(false)} className={!activeId ? 'on' : ''}>All Genres</Link>{genres.map(genre => <Link key={genre.externalId} to={`/movies/browse/genre-${genre.externalId}`} className={genre.externalId === activeId ? 'on' : ''} onClick={() => setOpen(false)}>{genre.name}</Link>)}</div>}</div>;
}
function GridLoading() { return <div className="nf-grid">{Array.from({ length: 12 }, (_, i) => <div className="nf-skel nf-skel-card" key={i} />)}</div>; }

function SearchPage() {
  const [params] = useSearchParams(); const query = (params.get('q') ?? '').trim().slice(0, 120);
  const [items, setItems] = useState<Movie[]>([]); const [page, setPage] = useState(1); const [totalPages, setTotalPages] = useState(1); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setItems([]); setPage(1); }, [query]);
  useEffect(() => {
    if (!query) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    apiGet<MoviePage>(`/search?${new URLSearchParams({ q: query, page: String(page) })}`, controller.signal).then(result => {
      if (controller.signal.aborted) return; setTotalPages(Math.min(result.totalPages, 500)); setItems(previous => page === 1 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.externalId === item.externalId))]);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Search is unavailable.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page]);
  return <div className="nf nf-bleed nf-page">
    {!query ? <div className="nf-message"><h2>Search for movies</h2><p>Use the search bar above to find a title, actor or keyword.</p><Link to="/movies/browse/trending" className="nf-btn play">See what&apos;s trending</Link></div> : <>
      {!loading && items.length > 0 && <p className="nf-search-line">Explore titles related to: <b>{query}</b></p>}
      {error && <ErrorMessage message={error} />}
      {items.length > 0 && <MovieGrid items={items} />}
      {!loading && !error && items.length === 0 && <div className="nf-message nf-nomatch"><p>Your search for “{query}” did not have any matches.</p><p className="nf-sub">Suggestions:</p><ul><li>Try different keywords</li><li>Search by the title</li><li>Try an actor or director</li></ul></div>}
      {loading && <GridLoading />}
      {!loading && page < totalPages && <div className="nf-load-more"><button type="button" className="nf-btn info" onClick={() => setPage(value => value + 1)}>Load more</button></div>}
    </>}
  </div>;
}
function LibraryPage() {
  const [items, setItems] = useState<SavedMovie[]>(readLibrary); const [filter, setFilter] = useState<'all' | 'watchlist' | 'watched' | 'liked'>('all');
  useEffect(() => { const refresh = () => setItems(readLibrary()); window.addEventListener('crude:movie-library-change', refresh); window.addEventListener('storage', refresh); return () => { window.removeEventListener('crude:movie-library-change', refresh); window.removeEventListener('storage', refresh); }; }, []);
  const filtered = items.filter(item => filter === 'all' || (filter === 'watchlist' && item.status === 'watchlist') || (filter === 'watched' && item.status === 'watched') || (filter === 'liked' && item.isFavorite));
  return <div className="nf nf-bleed nf-page"><header className="nf-page-head"><h1>My List</h1><div className="nf-chips">{(['all', 'watchlist', 'watched', 'liked'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{({ all: 'All', watchlist: 'My List', watched: 'Watched', liked: 'Liked' })[value]}</button>)}</div></header>
    {filtered.length ? <MovieGrid items={filtered} /> : <div className="nf-message"><h2>{items.length ? 'Nothing here yet.' : "You haven't added any titles yet."}</h2><p>Add films with the bookmark or like control and they will appear here.</p><Link to="/movies" className="nf-btn play">Browse Movies</Link></div>}
  </div>;
}

function DetailPage() {
  const { externalId = '' } = useParams(); const navigate = useNavigate();
  const [movie, setMovie] = useState<MovieDetail | null>(null); const [similar, setSimilar] = useState<Movie[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setMovie(null);
    apiGet<MovieDetail>('/' + encodeURIComponent(externalId), controller.signal).then(result => {
      if (controller.signal.aborted) return; setMovie(result);
      if (result.genres[0]) apiGet<MoviePage>(`/discover?kind=popular&page=1&genres=${result.genres[0].externalId}`, controller.signal).then(page => setSimilar(page.items.filter(item => item.externalId !== result.externalId).slice(0, 12))).catch(() => undefined);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load this title.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [externalId]);
  if (loading) return <div className="nf nf-bleed nf-page"><div className="nf-message"><span className="nf-spinner" /></div></div>;
  if (error || !movie) return <div className="nf nf-bleed nf-page"><ErrorMessage message={error || 'Movie not found.'} retry={() => navigate(0)} /></div>;
  const directors = movie.crew.filter(person => person.job === 'Director').slice(0, 4);
  const year = movieYear(movie);
  return <div className="nf nf-bleed nf-detail-page"><Link to="/movies" className="nf-back"><ArrowLeft size={18} /> Browse</Link><div className="nf-modal">
    <div className="nf-detail"><div className="nf-detail-hero">{movie.backdropUrl && <img src={movie.backdropUrl} alt="" referrerPolicy="no-referrer" />}<span className="nf-detail-fade" /><div className="nf-detail-head"><h1>{movie.title}</h1><div className="nf-detail-actions"><Link to={watchPath(movie)} className="nf-btn play"><Play size={19} fill="currentColor" /> Play</Link><MyListButton movie={movie} /><LikeButton movie={movie} /><button className="nf-round big" aria-label="Mark watched" title="Mark watched" onClick={() => updateSaved(movie, { status: savedFor(movie)?.status === 'watched' ? null : 'watched' })}><Check size={18} /></button></div></div></div>
      <div className="nf-detail-pad nf-detail-cols"><div className="nf-detail-main"><p className="nf-detail-meta">{movie.voteAverage ? <b>{Math.round(movie.voteAverage * 10)}% rated</b> : null}{year && <span>{year}</span>}{movie.runtimeMinutes ? <span>{Math.floor(movie.runtimeMinutes / 60)}h {movie.runtimeMinutes % 60}m</span> : null}{movie.adult && <span className="nf-box">18+</span>}</p>{movie.tagline && <p className="nf-detail-tagline">{movie.tagline}</p>}<p className="nf-detail-overview">{movie.overview || 'No synopsis is available for this title yet.'}</p></div>
        <dl className="nf-detail-side">{movie.cast.length > 0 && <div><dt>Cast:</dt><dd>{movie.cast.slice(0, 4).map(person => person.name).join(', ')}</dd></div>}{movie.genres.length > 0 && <div><dt>Genres:</dt><dd>{movie.genres.map((genre, index) => <span key={genre.externalId}>{index > 0 ? ', ' : ''}<Link to={`/movies/browse/genre-${genre.externalId}`}>{genre.name}</Link></span>)}</dd></div>}{directors.length > 0 && <div><dt>Director:</dt><dd>{directors.map(person => person.name).join(', ')}</dd></div>}</dl>
      </div>
      {similar.length > 0 && <section className="nf-detail-pad"><h2 className="nf-detail-h2">More Like This</h2><div className="nf-more-grid">{similar.map(item => <div className="nf-more-card" key={item.externalId}><Link className="nf-more-thumb" to={moviePath(item)}>{imageOf(item) && <img src={imageOf(item)!} alt="" loading="lazy" />}<b>{item.title}</b></Link><div className="nf-more-body"><div className="nf-more-top"><span>{movieYear(item) ?? ''}</span><MyListButton movie={item} /></div><p>{item.overview}</p></div></div>)}</div></section>}
      <section className="nf-detail-pad nf-about"><h2 className="nf-detail-h2">About <b>{movie.title}</b></h2><dl>{directors.length > 0 && <div><dt>Director:</dt><dd>{directors.map(person => person.name).join(', ')}</dd></div>}{movie.cast.length > 0 && <div><dt>Cast:</dt><dd>{movie.cast.slice(0, 8).map(person => person.name).join(', ')}</dd></div>}{movie.genres.length > 0 && <div><dt>Genres:</dt><dd>{movie.genres.map(genre => genre.name).join(', ')}</dd></div>}{movie.productionCountries.length > 0 && <div><dt>Made in:</dt><dd>{movie.productionCountries.map(country => country.name).join(', ')}</dd></div>}</dl></section>
    </div>
  </div></div>;
}

function WatchPage() {
  const { externalId = '' } = useParams(); const navigate = useNavigate();
  const [movie, setMovie] = useState<MovieDetail | null>(null); const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setMovie(null);
    apiGet<MovieDetail>('/' + encodeURIComponent(externalId), controller.signal).then(result => { if (!controller.signal.aborted) { setMovie(result); setSnapshot(readPlayback(result.externalId)); } }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load the movie.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [externalId]);
  const embedUrl = useMemo(() => {
    if (!movie || !/^[1-9]\d{0,11}$/.test(movie.externalId)) return null;
    const params = new URLSearchParams({ autoplay: 'true', back: 'close', color: '#e5e5e5' });
    if (snapshot && snapshot.progressSeconds > 15) { params.set('t', String(Math.floor(snapshot.progressSeconds))); params.set('continueprompt', 'false'); }
    if (snapshot?.sourceId && /^[A-Za-z0-9_-]{1,100}$/.test(snapshot.sourceId)) params.set('lastserver', snapshot.sourceId);
    return `${CINESRC}/embed/movie/${movie.externalId}?${params.toString()}`;
  }, [movie, snapshot?.progressSeconds, snapshot?.sourceId]);
  const update = useCallback((patch: Partial<PlayerSnapshot>) => {
    if (!movie) return;
    const next: PlayerSnapshot = { progressSeconds: 0, durationSeconds: null, completed: false, ...snapshot, ...patch, updatedAt: Date.now() };
    setSnapshot(next); writePlayback(movie.externalId, next);
  }, [movie, snapshot]);
  const goBack = () => navigate(moviePath({ externalId }), { replace: true });
  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      if (event.origin !== CINESRC || event.source !== frameRef.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Record<string, unknown>;
      if (data.type === 'cinesrc:timeupdate' || data.type === 'cinesrc:seeked' || data.type === 'cinesrc:pause') {
        const time = Number(data.currentTime); const duration = Number(data.duration);
        if (Number.isFinite(time) && time >= 0) update({ progressSeconds: time, durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : snapshot?.durationSeconds ?? null, completed: Number.isFinite(duration) && duration > 0 && time >= duration - 2 });
      } else if (data.type === 'cinesrc:ended') update({ completed: true, durationSeconds: Number(data.duration) || snapshot?.durationSeconds || null, progressSeconds: Number(data.duration) || snapshot?.progressSeconds || 0 });
      else if (data.type === 'cinesrc:volumechange') update({ volume: Number.isFinite(Number(data.volume)) ? Math.max(0, Math.min(1, Number(data.volume))) : snapshot?.volume, muted: typeof data.muted === 'boolean' ? data.muted : snapshot?.muted });
      else if (data.type === 'cinesrc:ratechange') update({ playbackRate: Number.isFinite(Number(data.playbackRate)) ? Number(data.playbackRate) : snapshot?.playbackRate });
      else if (data.type === 'cinesrc:sourceused' && typeof data.sourceId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(data.sourceId)) update({ sourceId: data.sourceId });
      else if (data.type === 'cinesrc:close') goBack();
    };
    const pagehide = () => { if (movie && snapshot) writePlayback(movie.externalId, { ...snapshot, updatedAt: Date.now() }); };
    window.addEventListener('message', listener); window.addEventListener('pagehide', pagehide);
    return () => { window.removeEventListener('message', listener); window.removeEventListener('pagehide', pagehide); };
  }, [movie, snapshot, update]);
  if (loading) return <div className="nf nf-player"><span className="nf-spinner" /></div>;
  if (error || !movie || !embedUrl) return <div className="nf nf-player"><button className="nf-player-back" onClick={goBack} aria-label="Back"><ArrowLeft size={30} /></button><div className="nf-player-msg"><h2>We can&apos;t play this title right now</h2><p>{error || 'The movie could not be found.'}</p><Link to="/movies" className="nf-btn play">Back to Movies</Link></div></div>;
  return <div className="nf nf-player"><button className="nf-player-back" onClick={goBack} aria-label="Back to movie details"><ArrowLeft size={30} /></button><iframe ref={frameRef} className="nf-player-frame" src={embedUrl} title={movie.title} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>;
}
function NotFound() { return <div className="nf nf-bleed nf-page"><div className="nf-message"><h2>Page not found</h2><Link className="nf-btn play" to="/movies">Return to Movies</Link></div></div>; }

export default function App() { return <Shell />; }
