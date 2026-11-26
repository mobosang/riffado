import json
import math
import struct
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import sherpa_onnx


MODEL_ID = "3dspeaker/campplus-zh-en-16k-common-advanced"
MODEL_REVISION = "sherpa-onnx-2.0.3/s16le-mono16k-v1:sha256:53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b"
SAMPLE_RATE = 16_000
EXTRACTOR = sherpa_onnx.SpeakerEmbeddingExtractor(
    sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(Path(__file__).with_name("campplus.onnx")), num_threads=2,
    )
)
MODEL = {"id": MODEL_ID, "revision": MODEL_REVISION, "dimension": EXTRACTOR.dim}


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        data = json.dumps(value, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"model": MODEL})
        else:
            self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/embed":
            self.reply(404, {"error": "Not found"})
            return
        if self.headers.get("X-Speaker-Model") != MODEL_ID:
            self.reply(400, {"error": "Unsupported speaker model"})
            return
        if self.headers.get_content_type() != "application/octet-stream":
            self.reply(415, {"error": "Expected signed 16-bit mono PCM"})
            return
        size = self.headers.get("Content-Length", "")
        if self.headers.get("Transfer-Encoding") or not size.isdecimal() or len(size) > 6:
            self.reply(400, {"error": "Invalid PCM length"})
            return
        length = int(size)
        if length % 2 or not 3 * SAMPLE_RATE * 2 <= length <= 6 * SAMPLE_RATE * 2:
            self.reply(400, {"error": "Expected 3 to 6 seconds of mono 16 kHz audio"})
            return
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                self.reply(400, {"error": "Incomplete sample"})
                return
            samples = [sample / 32768.0 for sample, in struct.iter_unpack("<h", data)]
            stream = EXTRACTOR.create_stream()
            stream.accept_waveform(SAMPLE_RATE, samples)
            stream.input_finished()
            if not EXTRACTOR.is_ready(stream):
                self.reply(422, {"error": "Insufficient audio"})
                return
            embedding = list(EXTRACTOR.compute(stream))
            if len(embedding) != EXTRACTOR.dim or not all(map(math.isfinite, embedding)):
                self.reply(422, {"error": "Invalid voiceprint"})
                return
        except (TimeoutError, RuntimeError, ValueError):
            self.reply(422, {"error": "Could not extract voiceprint"})
            return
        self.reply(200, {"model": MODEL, "embedding": embedding})


if __name__ == "__main__":
    with HTTPServer(("0.0.0.0", 9021), Handler) as server:
        server.serve_forever()
