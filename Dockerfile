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
RUN useradd --system --uid 10001 --no-create-home verity && mkdir -p /app/data
WORKDIR /app/api
EXPOSE 3000
# Fix ownership of the (possibly bind-mounted) data dir, then drop root.
CMD ["sh", "-c", "chown -R verity /app/data && exec setpriv --reuid=verity --regid=verity --init-groups uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}"]
