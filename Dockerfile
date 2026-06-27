FROM python:3.12-slim

WORKDIR /app

COPY app ./app
COPY config ./config
COPY runner ./runner
COPY reports/.gitkeep ./reports/.gitkeep

ENV AUTOMATION_IN_DOCKER=1
EXPOSE 8000

CMD ["python", "app/server.py"]
