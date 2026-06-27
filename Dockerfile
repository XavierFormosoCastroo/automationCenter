FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY app ./app
COPY config ./config
COPY runner ./runner
COPY reports/.gitkeep ./reports/.gitkeep

ENV AUTOMATION_IN_DOCKER=1
EXPOSE 8000

CMD ["python", "app/server.py"]
