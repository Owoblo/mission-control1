FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libseccomp2 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir lxml==6.1.1
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RESEARCH_ENABLED=0 REGIONAL_MAPPING_ENABLED=0 OUTREACH_ENABLED=0
WORKDIR /evaluation
COPY . /evaluation
RUN useradd --uid 10001 --create-home evaluator
USER 10001
ENTRYPOINT ["python", "-B", "staging/extraction-evaluation/run.py"]
