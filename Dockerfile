# ---- stage 1: build the web app ----
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ---- stage 2: API + built web app ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=3000
WORKDIR /app
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api/ api/
COPY seed/ seed/
COPY --from=web /web/dist web/dist
# Unprivileged user owns only the data dir; the code stays root-owned and read-only to it.
# /app/data is a named volume in docker-compose.yml, which inherits this ownership on first use.
RUN useradd --system --uid 10001 --no-create-home verity \
 && mkdir -p /app/data && chown verity:verity /app/data
WORKDIR /app/api
USER verity
EXPOSE 3000
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
