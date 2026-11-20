"""Generate an original royalty-free synthwave beat. Usage: python music.py out.wav seconds [seed]"""
import sys, numpy as np, soundfile as sf
out, T = sys.argv[1], float(sys.argv[2]); seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
rng = np.random.default_rng(seed); sr = 44100; n = int(sr * T); t = np.arange(n) / sr
bpm = int(rng.choice([100, 105, 110, 115])); beat = 60 / bpm
roots = [[55, 55, 65.41, 49.0], [49.0, 58.27, 65.41, 43.65], [61.74, 55, 49.0, 55]][seed % 3]
x = np.zeros(n)
for i in range(int(T / (beat / 2)) + 1):
    s = int(i * beat / 2 * sr); L = min(int(beat / 2 * sr * 0.9), n - s)
    if L <= 0: break
    tt = np.arange(L) / sr; f = roots[(i // 8) % 4]
    x[s:s + L] += 0.35 * np.sign(np.sin(2 * np.pi * f * tt)) * np.exp(-tt * 6)
for i in range(int(T / beat) + 1):
    s = int(i * beat * sr); L = min(int(0.25 * sr), n - s)
    if L <= 0: break
    tt = np.arange(L) / sr
    x[s:s + L] += 0.9 * np.sin(2 * np.pi * (50 + 90 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 12)
    if i % 2: x[s:s + L] += 0.25 * rng.standard_normal(L) * np.exp(-tt * 25)
    if True:  # hats on off-beats
        h = int(s + beat / 2 * sr); Lh = min(int(0.05 * sr), n - h)
        if Lh > 0: x[h:h + Lh] += 0.08 * rng.standard_normal(Lh) * np.exp(-np.arange(Lh) / sr * 80)
chord = [roots[0] * 4, roots[0] * 4 * 1.189, roots[0] * 4 * 1.498]
x += sum(np.sin(2 * np.pi * f * t) for f in chord) * 0.05
x /= max(1e-9, np.abs(x).max())
fade = int(0.8 * sr); x[-fade:] *= np.linspace(1, 0, fade)
sf.write(out, (x * 0.9).astype(np.float32), sr)
