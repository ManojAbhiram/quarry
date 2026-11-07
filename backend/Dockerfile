FROM python:3.13-slim

WORKDIR /app

# Install the Chromium browser + OS deps used by the Playwright scraper fallback
# FIRST, as its own cached layer. Because it doesn't depend on requirements.txt,
# editing dependencies later won't trigger a slow browser re-download.
# Remove this line (and set ENABLE_PLAYWRIGHT=false) for a lighter/faster image.
RUN pip install playwright && playwright install --with-deps chromium

COPY requirements.txt .

#for dev environment cache , for production we can remove the cache and install directly
RUN pip install -r requirements.txt

COPY . .

# Production-safe default: NO --reload.
#
# The image CI builds is the image that runs in the cluster, so its default CMD
# must not be a dev server. The reload loop watches the filesystem, costs extra
# memory, and re-execs the process on any write — none of which belongs in a pod.
#
# k8s/base/backend.yaml already overrides command/args, but relying on that means
# the image is only safe by accident. Dev reload is opted into explicitly by
# docker-compose.yml, which bind-mounts the source.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
