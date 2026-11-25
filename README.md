# Crude Movies — standalone site

Crude is a standalone Movies-only website with a grayscale, Netflix-inspired interface. It includes its own small Cloudflare Worker for the movie catalogue API and does not depend on another application being deployed.

## Included

- Movies home with featured artwork, Top 10, Trending, Popular, Top Rated, New Releases, Coming Soon, and genre rows.
- Browse pages for trending, popular, top-rated, upcoming, now-playing, and individual genres.
- Movie search, title details, cast and crew, genre links, and similar titles.
- Browser-local My List, likes, watched state, and playback resume data.
- CineSrc as the only playback embed provider.
- A read-only TMDB API Worker for discovery, search, genres, and title details.

## Standalone behavior

Crude runs as a guest-only site. My List, likes, watched status, and playback position are stored in the visitor's browser with `localStorage`. They do not sync across devices or browsers. There is no login, account system, D1 database, or account-wide sync.

The app has its own Movies navigation and search header. It does not include other platform sections or depend on another platform's Worker, APIs, database, or authentication configuration.

## Requirements

- Node.js 22 LTS (Node 20.19+ should also work with the Vite toolchain).
- npm.
- A TMDB API Read Access Token for the server-side Worker.
- A Cloudflare account for deployment; local development does not need a Cloudflare account.

## 1. Install

Unzip the archive, open a terminal inside the `crude` folder, and run:

```bash
npm install
```

## 2. Configure TMDB locally

Copy the example Worker secrets file:

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and replace the placeholder with your TMDB API Read Access Token:

```dotenv
TMDB_ACCESS_TOKEN=your_tmdb_read_access_token
```

Keep this token in `.dev.vars` or as a Cloudflare Worker secret. Never add it to `VITE_*` variables, frontend code, or a committed file. `.dev.vars` is ignored by Git.

The Worker has two feature/terms switches in `wrangler.jsonc`:

- `MOVIES_TMDB_ENABLED=true`
- `MOVIES_TMDB_TERMS_APPROVED=true`

Both must remain enabled for catalogue requests to work. Review TMDB's current terms before enabling the API for your intended use.

## 3. Run locally

```bash
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`. The Cloudflare Vite plugin runs the local Worker alongside the frontend. API requests use the same origin at `/api/v1/movies/*`; the TMDB token stays in the Worker environment.

## 4. Build and preview

```bash
npm run typecheck
npm run build
npm run preview
```

`npm run build` runs TypeScript project checks and creates the production build. The preview server is useful for checking the generated frontend bundle; the Worker API itself should also be tested in the Cloudflare development or deployed environment.

## 5. Deploy from GitHub to Cloudflare (production only)

The repository can be connected directly to Cloudflare Workers Builds. Use these settings for a single production deployment with no staging/preview deployment:

| Setting | Value |
|---|---|
| GitHub repository | `UnpainLlama/crude` |
| Production branch | `main` (or the repository's chosen production branch) |
| Root directory | `/` or the repository root |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Preview builds | Disabled |
| Worker name | `crude` (already set in `wrangler.jsonc`) |

Do not add the TMDB token as a build variable. After the Worker is created, add it as a **runtime Secret** in Cloudflare:

1. Open **Workers & Pages → crude → Settings → Variables and Secrets**.
2. Add a variable with type **Secret** and name `TMDB_ACCESS_TOKEN`.
3. Paste your TMDB API Read Access Token as its value and save.
4. Redeploy the Worker if Cloudflare does not automatically deploy the configuration change.

The two non-sensitive `MOVIES_TMDB_*` switches are already declared in `wrangler.jsonc`. No D1 or KV binding is required.

For command-line deployment instead, run:

```bash
npx wrangler login
npx wrangler secret put TMDB_ACCESS_TOKEN
npm run deploy
```

The deploy target is the separate Cloudflare Worker named `crude`.

## API surface

The included Worker provides the API shape expected by the Movies UI:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/movies/discover?kind=trending_week&page=1` | Discovery lists |
| GET | `/api/v1/movies/discover?kind=popular&page=1&genres=18` | Genre-specific discovery |
| GET | `/api/v1/movies/search?q=dune&page=1` | Search |
| GET | `/api/v1/movies/genres?language=en-US` | Genre list |
| GET | `/api/v1/movies/{tmdb_id}` | Title details, credits, and metadata |

Supported discovery kinds: `trending_day`, `trending_week`, `popular`, `top_rated`, `upcoming`, and `now_playing`. Responses use the `{ success, data }` envelope expected by the frontend.

The API is read-only. It does not store catalogue responses, run ingestion jobs, use D1, or expose user/account routes.

## Providers and attribution

**Catalogue and artwork:** TMDB. The Read Access Token is used only by the Worker. The site footer displays TMDB's required notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.” Before public deployment, add the official TMDB logo in the app credits/about area and confirm that your intended use meets TMDB's current terms. This extraction is intended for personal, non-commercial use; commercial use requires separate permission from TMDB.

**Playback:** CineSrc only. The player uses the documented movie embed at `https://cinesrc.st/embed/movie/{tmdb_id}`. No CineSrc API key or stream resolver is included. Playback availability, sources, and embed restrictions are controlled by CineSrc; this package does not scrape or extract stream URLs. See [CineSrc's official documentation](https://cinesrc.st/docs).

## Troubleshooting

- **Movies API returns 503:** check `.dev.vars` locally or the `TMDB_ACCESS_TOKEN` Worker secret after deployment; confirm both TMDB switches in `wrangler.jsonc` are `true`.
- **TMDB returns 401/403:** check the TMDB Read Access Token and update the Worker secret.
- **Images do not load:** check network access to `image.tmdb.org` and the browser console.
- **A title does not play:** open its CineSrc embed URL directly. If CineSrc has no playable source for that TMDB ID, Crude cannot supply another provider.
- **My List / progress disappeared:** browser storage is local to the browser profile and site origin. Clearing site data, using private browsing, or switching devices/browsers will not carry saved entries over.

## Source and scope

This package is a standalone Movies-only extraction, adapted from a source snapshot on the default branch at commit `f9bc73ad38dca01ebbaa628a642dd46fedc68fba` (25 November 2026). The Movies feature boundary and provider choices are retained; shared platform navigation and account plumbing are replaced with Crude's own guest-only shell and API Worker.
