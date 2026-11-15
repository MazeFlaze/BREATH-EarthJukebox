# ------------------------------------------------------------
# BREATHE – FastAPI Backend Dockerfile
# ------------------------------------------------------------
FROM python:3.12-slim AS builder

WORKDIR /app

# Install build dependencies for netCDF4 and HDF5 C-libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libnetcdf-dev \
    libhdf5-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ------------------------------------------------------------
FROM python:3.12-slim AS runner

WORKDIR /app

# Runtime libraries for NetCDF and health check utility
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnetcdf-dev \
    libhdf5-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Security: Non-root user (UID 1001)
RUN groupadd -g 1001 appuser && \
    useradd -u 1001 -g appuser -s /bin/bash -m appuser

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

# Copy application source code
COPY --chown=appuser:appuser . /app

# Ensure data storage directories exist with proper write permissions for appuser
RUN mkdir -p /app/data/raw /app/data/nasa-archive /app/data/geos-cf-catalog /app/src/data/raw /app/storage && \
    chown -R appuser:appuser /app/data /app/src/data /app/storage

USER appuser

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH=/app/src:/app
ENV HOST=0.0.0.0
ENV PORT=8000
ENV GEOS_CF_CATALOG_ROOT=/app/data/geos-cf-catalog

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
