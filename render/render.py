"""Render one vertical reel (1080x1920, 30 fps, silent video) from a JSON spec.

Usage: python render.py spec.json out.mp4

spec = {
  "hook": "GTA 6 BROKE THE INTERNET", "cta": "for daily GTA 6 news", "total": 24.1,
  "scenes": [{"start": 0, "end": 3.7, "line": "...", "onscreen": "40 BILLION VIEWS",
              "counter": {"from": 0, "to": 4e10, "prefix": "", "suffix": ""} | null,
              "image": "/path/bg.png" | null,
              "words": [{"text": "GTA", "start": 0.0, "end": 0.3}, ...]}]
}
Scenes without an image get a code-drawn neon city background, so nothing here needs any
outside asset: no game footage, logos or artwork.
"""
import json, math, os, random, subprocess, sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

W, H, FPS = 1080, 1920, 30
HORIZON = 1180
CTA_SECONDS = 1.8

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
ANTON = os.path.join(FONTS, "Anton-Regular.ttf")
MONT = os.path.join(FONTS, "Montserrat-Variable.ttf")

_fc = {}
def font(path, size, weight=None):
    size = max(8, int(size))
    key = (path, size, weight)
    if key not in _fc:
        f = ImageFont.truetype(path, size)
        if weight:
            try:
                f.set_variation_by_axes([weight])
            except Exception:
                pass
        _fc[key] = f
    return _fc[key]

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def ease_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def ease_back(x):
    x = clamp(x); c1 = 1.70158; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2

# ---------------------------------------------------------------- backgrounds
def neon_city(seed=7):
    """Synthwave sunset city, drawn from scratch."""
    rnd = random.Random(seed)
    img = Image.new("RGB", (W, H), (14, 2, 30))
    d = ImageDraw.Draw(img)
    stops = [(0, (12, 4, 38)), (520, (58, 10, 92)), (900, (190, 30, 120)), (HORIZON, (255, 120, 70))]
    for y in range(HORIZON):
        for (y0, c0), (y1, c1) in zip(stops, stops[1:]):
            if y0 <= y <= y1:
                t = (y - y0) / (y1 - y0)
                d.line([(0, y), (W, y)], fill=tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)))
                break
    for _ in range(140):
        x, y, r = rnd.randint(0, W), rnd.randint(0, 650), rnd.choice([1, 1, 2])
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 230, 255))
    sun = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sun)
    cx, cy, R = W // 2, HORIZON - 120, 330
    for y in range(cy - R, HORIZON):
        t = (y - (cy - R)) / (2 * R)
        hw = int(math.sqrt(max(0, R * R - (y - cy) ** 2)))
        sd.line([(cx - hw, y), (cx + hw, y)], fill=(255, int(230 - 150 * t), int(90 + 60 * t), 255))
    for i in range(6):
        y = cy + 40 + i * 38; sd.rectangle([0, y, W, y + 6 + i * 2], fill=(0, 0, 0, 0))
    base = img.convert("RGBA")
    base.alpha_composite(sun.filter(ImageFilter.GaussianBlur(60)))
    base.alpha_composite(sun)
    d = ImageDraw.Draw(base)
    x = -20
    while x < W:
        bw, bh = rnd.randint(50, 120), rnd.randint(120, 430)
        if abs(x + bw / 2 - W / 2) < 260: bh = int(bh * 0.55)
        d.rectangle([x, HORIZON - bh, x + bw, HORIZON], fill=(22, 6, 44))
        for wy in range(HORIZON - bh + 14, HORIZON - 10, 22):
            for wx in range(x + 8, x + bw - 8, 16):
                if rnd.random() < 0.28:
                    d.rectangle([wx, wy, wx + 6, wy + 9], fill=rnd.choice([(255, 90, 200), (90, 230, 255), (255, 210, 120)]))
        x += bw + rnd.randint(-6, 6)
    def palm(px, lean):
        pts = [(px + lean * (i / 29) ** 2 * 160, HORIZON + 40 - (i / 29) * 820) for i in range(30)]
        for i in range(29):
            d.line([pts[i], pts[i + 1]], fill=(10, 0, 20), width=int(34 - 18 * i / 29))
        tx, ty = pts[-1]
        for a in range(0, 360, 36):
            ang = math.radians(a + 10)
            ex, ey = tx + math.cos(ang) * 260, ty + math.sin(ang) * 143 + 70
            mx, my = tx + math.cos(ang) * 130, ty + math.sin(ang) * 78 - 40
            d.polygon([(tx, ty), (mx, my - 18), (ex, ey), (mx, my + 18)], fill=(10, 0, 20))
    palm(70, 0.9); palm(1010, -1.0)
    return base.convert("RGB")

def draw_grid(img, t):
    d = ImageDraw.Draw(img)
    for i in range(-14, 15):
        d.line([(W / 2 + i * 30, HORIZON), (W / 2 + i * 420, H)], fill=(255, 60, 200), width=3)
    off = (t * 1.6) % 1.0
    for k in range(14):
        z = (k + off) / 14
        y = HORIZON + (H - HORIZON) * z ** 2.2
        d.line([(0, y), (W, y)], fill=(255, 60, 200), width=2 + int(3 * z))

def cover(img, w, h):
    s = max(w / img.width, h / img.height)
    img = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.LANCZOS)
    l, t = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((l, t, l + w, t + h))

def shade_overlay():
    """Dark top/bottom gradient so white text and captions stay readable on any photo."""
    o = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(o)
    for y in range(H):
        top = clamp(1 - y / 1100) * 150
        bot = clamp((y - 1250) / 670) * 200
        d.line([(0, y), (W, y)], fill=(8, 0, 20, int(max(top, bot) + 40)))
    return o

class Background:
    def __init__(self, path, idx):
        self.idx = idx
        self.photo = None
        if path and os.path.exists(path):
            try:
                self.photo = cover(Image.open(path).convert("RGB"), int(W * 1.12), int(H * 1.12))
            except Exception as e:
                print(f"bad image {path}: {e}", flush=True)
        self.city = None if self.photo else NEON

    def frame(self, p, t):
        if self.photo:
            z = 1.04 + 0.08 * p         # slow push-in
            cw, ch = W * 1.12 / z, H * 1.12 / z
            margin = (self.photo.width - cw) / 2
            pan = (p - 0.5) * 1.6 * margin * (1 if self.idx % 2 else -1)   # gentle side drift, never off-image
            l = margin + pan; tp = (self.photo.height - ch) / 2
            img = self.photo.resize((W, H), Image.BILINEAR, box=(l, tp, l + cw, tp + ch))
            img = img.convert("RGBA"); img.alpha_composite(SHADE)
            return img
        img = self.city.copy()
        draw_grid(img, t)
        img = img.convert("RGBA")
        img.alpha_composite(SHADE_SOFT)
        return img

# ---------------------------------------------------------------- text
def text_layer(text, fnt, fill, stroke=0, glow=None, glow_r=18):
    """Render text (with optional neon glow) onto a tight RGBA layer. Returns (layer, w, h)."""
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bb = probe.textbbox((0, 0), text, font=fnt, stroke_width=stroke)
    m = glow_r * 3 if glow else 4
    w, h = bb[2] - bb[0] + 2 * m, bb[3] - bb[1] + 2 * m
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pos = (m - bb[0], m - bb[1])
    if glow:
        g = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(g).text(pos, text, font=fnt, fill=glow + (255,), stroke_width=stroke + 6, stroke_fill=glow + (255,))
        layer.alpha_composite(g.filter(ImageFilter.GaussianBlur(glow_r)))
    ImageDraw.Draw(layer).text(pos, text, font=fnt, fill=fill + (255,), stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
    return layer, w, h

def put(canvas, layer, cx, cy, alpha=1.0):
    if alpha < 1:
        a = layer.getchannel("A").point(lambda v: int(v * alpha)); layer = layer.copy(); layer.putalpha(a)
    canvas.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))

def fit_lines(text, path, max_size, max_w=960, weight=None, max_lines=2):
    """Largest size (<= max_size) at which text fits in max_lines lines of max_w px."""
    words = text.split()
    for size in range(int(max_size), 40, -6):
        f = font(path, size, weight)
        lines, cur = [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if f.getlength(trial) <= max_w: cur = trial
            else:
                if cur: lines.append(cur)
                cur = w
        if cur: lines.append(cur)
        if len(lines) <= max_lines and all(f.getlength(l) <= max_w for l in lines):
            return lines, size
    return [text], 40

_cache = {}
def big_text(canvas, text, cy, max_size, color, glow, p_in, path=ANTON, weight=None, stroke=3, max_lines=2):
    """Big headline, auto-fitted to width, popping in with p_in (0..1)."""
    key = (text, max_size, color, glow, path, weight, stroke, max_lines)
    if key not in _cache:
        lines, size = fit_lines(text, path, max_size, weight=weight, max_lines=max_lines)
        f = font(path, size, weight)
        _cache[key] = ([text_layer(l, f, color, stroke, glow)[0] for l in lines], size)
    layers, size = _cache[key]
    s = 0.55 + 0.45 * ease_back(p_in)
    gap = size * 1.08
    y0 = cy - gap * (len(layers) - 1) / 2
    for i, L in enumerate(layers):
        if abs(s - 1) > 0.01:
            L = L.resize((max(1, int(L.width * s)), max(1, int(L.height * s))), Image.BILINEAR)
        put(canvas, L, W / 2, y0 + i * gap * s, alpha=clamp(p_in * 3))

def fmt_num(v, to):
    if to >= 1e9 and abs(to - round(to)) < 1: return f"{int(v):,}"
    if abs(to) >= 1000: return f"{int(round(v)):,}"
    if abs(to - round(to)) < 1e-9: return str(int(round(v)))
    return f"{v:.1f}"

def counter_text(canvas, c, p, cy):
    v = c.get("from", 0) + (c["to"] - c.get("from", 0)) * ease_out(p)
    txt = f"{c.get('prefix') or ''}{fmt_num(v, c['to'])}{c.get('suffix') or ''}"
    lines, size = fit_lines(txt, ANTON, 170, max_lines=1)
    L, _, _ = text_layer(txt, font(ANTON, size), (255, 255, 255), 3, (80, 220, 255))
    put(canvas, L, W / 2, cy)

# ---------------------------------------------------------------- captions
def build_chunks(scenes):
    chunks = []
    for sc in scenes:
        cur = []
        for w in sc["words"]:
            cur.append(w)
            if len(cur) == 3 or w["text"][-1:] in ".?!,":
                chunks.append(cur); cur = []
        if cur: chunks.append(cur)
    return chunks

def captions(canvas, t, chunks):
    for ch in chunks:
        if ch[0]["start"] - 0.05 <= t < ch[-1]["end"] + 0.12:
            f = font(MONT, 76, 900)
            d = ImageDraw.Draw(canvas)
            words = [w["text"].upper() for w in ch]
            widths = [f.getlength(w + " ") for w in words]
            total = sum(widths)
            if total > 1000:
                f = font(MONT, int(76 * 1000 / total), 900)
                widths = [f.getlength(w + " ") for w in words]; total = sum(widths)
            x = W / 2 - total / 2
            pop = ease_back((t - ch[0]["start"]) / 0.18)
            for w, txt, wd in zip(ch, words, widths):
                active = w["start"] <= t < w["end"] + 0.05
                yy = 1530 - (10 if active else 0) + (1 - pop) * 40
                d.text((x, yy), txt, font=f, fill=(255, 230, 40) if active else (255, 255, 255), stroke_width=9, stroke_fill=(0, 0, 0))
                x += wd
            return

# ---------------------------------------------------------------- main
def rgb_glitch(img, amt):
    if amt < 1: return img
    r, g, b, a = img.split()
    return Image.merge("RGBA", (ImageChops.offset(r, int(amt), 0), g, ImageChops.offset(b, -int(amt), 0), a))

def main():
    global NEON, SHADE, SHADE_SOFT
    spec = json.load(open(sys.argv[1])); out = sys.argv[2]
    scenes = spec["scenes"]
    total = spec["total"] + CTA_SECONDS
    NEON = neon_city()
    SHADE = shade_overlay()
    SHADE_SOFT = Image.new("RGBA", (W, H), (10, 0, 25, 60))
    bgs = [Background(sc.get("image"), i) for i, sc in enumerate(scenes)]
    chunks = build_chunks(scenes)
    hook = spec.get("hook", "").upper()
    cta = spec.get("cta", "for daily GTA 6 news")
    disclaimer = text_layer("Fan channel · not affiliated with Rockstar Games", font(MONT, 30, 600), (230, 230, 240), 2)[0]

    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                           "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    n_frames = int(total * FPS)
    for n in range(n_frames):
        t = n / FPS
        i = max(k for k, s in enumerate(scenes) if s["start"] <= t or k == 0)
        sc = scenes[i]
        span = max(0.1, sc["end"] - sc["start"])
        in_cta = t >= spec["total"]
        p = clamp((t - sc["start"]) / span)
        canvas = bgs[i].frame(clamp((t - sc["start"]) / (span + CTA_SECONDS)), t)
        lt = t - sc["start"]

        if not in_cta:
            if i == 0 and hook:
                big_text(canvas, hook, 520, 190, (255, 240, 90), (255, 40, 200), lt / 0.45)
                if lt > 0.6 and sc.get("onscreen") and sc["onscreen"].upper() != hook:
                    big_text(canvas, sc["onscreen"].upper(), 800, 90, (255, 255, 255), (80, 220, 255), (lt - 0.6) / 0.35, path=MONT, weight=900, stroke=4)
                canvas = rgb_glitch(canvas, 14 * max(0, 1 - lt / 0.6) * (1 if n % 3 else -1))
            elif sc.get("counter"):
                counter_text(canvas, sc["counter"], lt / min(2.5, span * 0.8), 560)
                big_text(canvas, sc["onscreen"].upper(), 760, 110, (255, 230, 40), (255, 120, 0), lt / 0.4)
            else:
                big_text(canvas, sc["onscreen"].upper(), 600, 170, (255, 255, 255), (255, 40, 200), lt / 0.4)
            captions(canvas, t, chunks)
        else:
            ct = t - spec["total"]
            pulse = 1 + 0.06 * math.sin(ct * 8)
            pin = ease_back(ct / 0.35)
            bw, bh = 640 * pulse * pin, 190 * pulse * pin
            if bw > 10:
                g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                ImageDraw.Draw(g).rounded_rectangle([W/2 - bw/2 - 20, 700 - bh/2 - 20, W/2 + bw/2 + 20, 700 + bh/2 + 20], 60, fill=(255, 40, 200, 230))
                canvas.alpha_composite(g.filter(ImageFilter.GaussianBlur(30)))
                ImageDraw.Draw(canvas).rounded_rectangle([W/2 - bw/2, 700 - bh/2, W/2 + bw/2, 700 + bh/2], 50, fill=(255, 40, 200))
                big_text(canvas, "FOLLOW", 700, int(130 * pulse), (255, 255, 255), None, ct / 0.35, max_lines=1, stroke=0)
            big_text(canvas, cta, 900, 72, (255, 255, 255), (80, 220, 255), (ct - 0.2) / 0.35, path=MONT, weight=900, stroke=4)
            put(canvas, disclaimer, W / 2, 1780, alpha=0.9)

        # progress bar (helps retention) + flash on cuts
        ImageDraw.Draw(canvas).rectangle([0, 0, int(W * t / total), 10], fill=(255, 40, 200))
        for k in range(1, len(scenes)):
            if 0 <= t - scenes[k]["start"] < 0.1:
                canvas.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, int(150 * (1 - (t - scenes[k]["start"]) / 0.1)))))
        ff.stdin.write(canvas.convert("RGB").tobytes())
        if n % 150 == 0: print(f"frame {n}/{n_frames}", flush=True)
    ff.stdin.close()
    if ff.wait() != 0: sys.exit("ffmpeg failed")
    print("rendered", out)

if __name__ == "__main__":
    main()
