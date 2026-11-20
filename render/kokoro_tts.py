"""Free offline English voice (Kokoro). Usage: python kokoro_tts.py job.json
job.json = {"voice": "am_michael", "lines": [...], "outputs": [...wav paths]}
Model files are downloaded once into render/models/ (cached on GitHub Actions)."""
import json, os, sys, urllib.request
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "models")
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.int8.onnx", "voices-v1.0.bin"]

os.makedirs(MODELS, exist_ok=True)
for f in FILES:
    p = os.path.join(MODELS, f)
    if not os.path.exists(p) or os.path.getsize(p) < 1_000_000:
        print(f"downloading {f}", flush=True)
        urllib.request.urlretrieve(BASE + f, p + ".part")
        os.replace(p + ".part", p)

job = json.load(open(sys.argv[1]))
k = Kokoro(os.path.join(MODELS, FILES[0]), os.path.join(MODELS, FILES[1]))
for line, out in zip(job["lines"], job["outputs"]):
    audio, sr = k.create(line, voice=job.get("voice", "am_michael"), speed=1.08, lang="en-us")
    sf.write(out, audio, sr)
    print(f"voiced {len(audio)/sr:.2f}s  {line[:60]}", flush=True)
