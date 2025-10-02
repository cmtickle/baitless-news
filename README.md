# Baitless News

An experiment demonstrating Cloudflare Pages plus a Cloudflare Worker that rewrites daily headlines into concise, non-clickbait summaries with GPT-5-nano.

## Repository layout

- `web/public/` – Static frontend served via Cloudflare Pages. Displays summaries fetched from `/api/news`.
- `worker/` – TypeScript Cloudflare Worker that pulls headlines and asks GPT-5-nano for calmer summaries.
- `wrangler.toml` – Worker configuration used by Wrangler for local development and deployment.

## Frontend (Cloudflare Pages)

The `web/public` directory is deployable as-is. For local iteration you can run a static file server, or use Wrangler's Pages tooling once configured:

```bash
wrangler pages dev web/public
```

When you connect the repository to Cloudflare Pages, set the build command to `null` (no build) and output directory to `web/public`.

## Worker API (`/api/news`)

The Worker now accepts `GET` requests and returns JSON shaped like:

```json
{
  "stories": [
    {
      "id": "story-1",
      "title": "Calmer headline",
      "summary": "Non-clickbait summary text.",
      "sourceUrl": "https://..."
    }
  ]
}
```

It fetches the latest UK headlines from the Daily Express RSS feed, spoofing a realistic desktop Chrome user agent so the site treats requests like a normal browser. The worker parses both the RSS and article HTML with `linkedom`'s `DOMParser` so it can iterate over Express' repeated `div[data-mrf-recirculation="Link Content Paragraph"]` blocks and recover proper article text before prompting GPT-5-nano for calmer rewrites. Network calls are made on demand; consider caching before shipping to production.

### Required environment values

Store this in Cloudflare (or a local `.dev.vars` file when using `wrangler dev`):

- `OPENAI_API_KEY` – GPT-5-nano access token. If omitted the Worker will return raw RSS content without rewrites.

### Local development

```bash
cd worker
npm install
# Optional: add OPENAI_API_KEY to .dev.vars before starting dev
npm run dev
```

The dev server binds to `http://localhost:8787`; hitting `http://localhost:8787/api/news` fetches the Express feed and, when configured, invokes GPT for rewrites. Running `npm install` pulls in the runtime dependency on `linkedom`, which supplies the DOMParser used to extract article bodies.

### Deployment

1. Configure `wrangler.toml` with your preferred project name and add a route, e.g.

   ```toml
   name = "baitless-news-worker"
   main = "worker/src/index.ts"
   compatibility_date = "2024-04-02"

   routes = [
     { pattern = "baitless-news.hypothetic.dev/api/news", zone_name = "hypothetic.dev" }
   ]
   ```

2. Store the OpenAI secret in Cloudflare:

   ```bash
   wrangler secret put OPENAI_API_KEY
   ```

3. Deploy:

   ```bash
   npm run deploy
   ```

### Next steps

- Add caching or scheduled jobs so GPT calls are reused instead of running on each request.
- Connect the Pages project and Worker route inside the Cloudflare dashboard.
- Add integration tests or monitoring before the live demo.
