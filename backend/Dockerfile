# Backend image: FastAPI served by uvicorn on port 8000.
#
# Build from the backend/ folder:   docker build -t pixeltrip-backend .
# Run locally:                      docker run --rm -p 8000:8000 --env-file .env pixeltrip-backend
#
# Settings come from environment variables (see .env.example); no secret is baked in.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# Dependencies first, so a code-only change reuses this layer.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Run as an unprivileged user.
RUN useradd --system --no-create-home pixeltrip
USER pixeltrip

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# One worker on purpose: AI runs continue in this process after the request returns,
# and the flight-provider rest timers live in its memory. Do not add workers or copies.
# --proxy-headers: Caddy terminates HTTPS in front of this container.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
