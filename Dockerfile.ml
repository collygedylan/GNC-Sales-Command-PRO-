FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ffmpeg libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-ml.txt /app/requirements-ml.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install --no-cache-dir -r /app/requirements-ml.txt

COPY supabase_ml_worker.py /app/supabase_ml_worker.py
COPY models /app/models

CMD ["python", "/app/supabase_ml_worker.py"]
