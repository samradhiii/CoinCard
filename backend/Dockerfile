# Build context is the REPO ROOT (see docker-compose.yml) so the dataset can be
# baked into the image. That makes the seed runnable on a hosted backend, where
# there is no local folder to bind-mount.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY data /data

EXPOSE 8000

# Render/Railway inject $PORT; default to 8000 for local compose.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
