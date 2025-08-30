# Dockerfile
FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# OS deps (필요시 추가)
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 파이썬 패키지
# app.py가 쓰는 패키지들: flask, gunicorn, python-dotenv (필요시 추가)
RUN pip install --no-cache-dir flask gunicorn python-dotenv

# 앱 소스 복사
COPY . /app

EXPOSE 5000
# SSE 안정화를 위해 워커 스레드형 + timeout 0
CMD ["gunicorn","app:app","-b","0.0.0.0:5000","--worker-class","gthread","--threads","4","--timeout","0"]
