# Local voiceprint service

The Riffado voiceprint workflow uses an existing local diarization service via
`RIFFADO_PLAUD_DIARIZATION_URL` to find speaker turns. The companion service
here runs [3D-Speaker CAM++](https://github.com/modelscope/3D-Speaker) with
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) on CPU to extract voiceprints.

Build from the repository root and join the same Docker network as Riffado.

```sh
docker build --platform linux/amd64 -t riffado-voiceprints:local services/voiceprints
docker run -d --name voiceprints --network <riffado-network> --restart unless-stopped riffado-voiceprints:local
```

In **Settings → AI → Providers → Add voiceprint service**, use
`http://voiceprints:9021/embed` with the model ID
`3dspeaker/campplus-zh-en-16k-common-advanced`. Keep the service on the Docker
network. It has no HTTP authentication and needs no published port.

Open an existing recording and choose **Generate voiceprints**. Listen to the
selected clips and save the corresponding names. To use enrolled names for an
older recording, re-transcribe it with speaker labels enabled and regenerate
its report. Automatic matches require two clean clips to agree on a single
person. Uncertain speakers retain their numbered labels.

## Compatible encoders and library exchange

A compatible service accepts `POST /embed` (or another configured endpoint)
with `Content-Type: application/octet-stream` and `X-Speaker-Model` set to the
configured model ID. The body is 3–6 seconds of signed little-endian 16-bit
PCM at 16 kHz, mono. Return JSON of the following form.

```json
{
  "model": {
    "id": "vendor/model",
    "revision": "checkpoint-and-preprocessing-version",
    "dimension": 3
  },
  "embedding": [0.12, -0.34, 0.56]
}
```

The **Voiceprint library** menu imports and exports `voiceprints.json`. Full
Riffado backup archives also include this file when the library has profiles.
The format uses `{"format":"riffado.voiceprints","version":1,"profiles":[...]}`.
Each profile has an `id`, `name` and a `samples` array. Each sample contains
the model and embedding shown above and may include
`"source": {"recordingId":"…","start":12.5,"end":18.5}` with offsets in seconds.
Use the source interval to re-extract samples when changing models.
Import merges profiles with identical names and retains up to six distinct
samples per profile. The library supports up to 40 people.

Matching requires an exact model ID, revision and dimension. Keep the model
revision stable for a given checkpoint and preprocessing pipeline. Riffado
encrypts the server-side library. Export and backup files contain the portable
vectors and should be stored as privately as the recordings.
