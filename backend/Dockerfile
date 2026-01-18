# Use slim Python base image (Playwright removed)
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create directories for volumes (with proper permissions)
RUN mkdir -p /app/volumes/browser-profiles /app/volumes/database && \
    chmod 755 /app/volumes

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Health check using curl
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Run the application
# Note: Using single worker to avoid concurrent scraping conflicts
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
