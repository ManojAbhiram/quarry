# Deployment

Quarry ships as two containers: `api` (FastAPI, SQLite) and `web` (static React build behind nginx, which also proxies
`/api` to the API so cookies are same-origin).

## Run locally, production-like

```bash
cp .env.production.example .env.production   # set SECRET_KEY and SERPER_API_KEY at minimum
docker compose up --build
```

* Web: http://localhost:8080 (also proxies `/api`)
* API health: http://localhost:8000/api/health
* The SQLite database lives in the `quarry-data` volume (`/data/quarry.db`) and survives restarts and rebuilds.

`.env.production.example` documents every environment variable the app reads. Real values go only in
`.env.production`, which is git-ignored.

## Notes

* Schema migrations run automatically at API startup (see `apps/api/README.md`, "Schema migrations"). Back up the
  volume before upgrading a database that holds real data.
* Run a single API worker: the job queue, schedulers and SQLite write lock are in-process.
* Over https set `FRONTEND_URL` and `PUBLIC_API_URL` to the public URLs and `COOKIE_SECURE=true`. If the web app and
  API are on different sites, use `COOKIE_SAMESITE=none` (forces Secure), and build the web image with
  `--build-arg VITE_API_URL=https://api.example.com/api`.
* Terminate TLS in front of the containers (load balancer or reverse proxy); nginx here listens on plain HTTP.
* Out of scope for now: Postgres, mailbox OAuth for Gmail/Microsoft.
