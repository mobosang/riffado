# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir sherpa-onnx==2.0.3
ADD --chmod=0444 --checksum=sha256:53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b \
    https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx /app/campplus.onnx
COPY server.py .
USER 65534:65534
EXPOSE 9021
HEALTHCHECK CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9021/health', timeout=3).close()"]
CMD ["python", "server.py"]
