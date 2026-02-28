# Deployment Guide

## Option A: Deploy to a VPS (AWS EC2 / DigitalOcean) with Docker

1. Copy repo to server and enter folder.
2. Create env file from template:
   - `cp .env.production.example .env`
3. Edit `.env` with your real domains and JWT secret.
4. Start stack:
   - `docker compose -f docker-compose.prod.yml --env-file .env up -d --build`
5. Verify:
   - Web: `http://<server-ip>:3600`
   - API health: `http://<server-ip>:4600/health`
   - ML health: `http://<server-ip>:8600/health`
6. Put Nginx/Caddy in front for TLS and domain routing:
   - `app.yourdomain.com` -> `localhost:3600`
   - `api.yourdomain.com` -> `localhost:4600`

## Option B: Railway (recommended quick cloud deploy)

Create 5 services in one Railway project:
1. `web` (Dockerfile: `Dockerfile.web`)
2. `api` (Dockerfile: `Dockerfile.api`)
3. `ml` (Dockerfile: `Dockerfile.ml`)
4. `redis` (Railway Redis plugin)
5. `postgres` (Railway Postgres plugin)

### API service env vars
- `JWT_SECRET` = strong random secret
- `POSTGRES_URL` = Railway Postgres connection string
- `REDIS_URL` = Railway Redis connection string
- `ML_SERVICE_URL` = URL of ML service
- `NEXT_PUBLIC_APP_URL` = URL of web service
- `SNAPSHOT_INTERVAL_SECONDS` = `30`
- `PORT` = `4600` (or omit and use Railway PORT mapping with start command)

### Web service env vars
- `NEXT_PUBLIC_API_URL` = URL of API service
- `NEXT_PUBLIC_WS_URL` = same URL as API service
- `PORT` = `3000`

### ML service env vars
- `PORT` = `8600`

After deploy, set:
- Custom domain for `web`
- Custom domain for `api`

## Post-deploy smoke test
1. Open web app.
2. Register user.
3. Create room.
4. Open room in two tabs and verify live sync.
5. Click `Analyze Now` and verify AI panel returns results.
6. Open session replay from dashboard and verify snapshots render.
