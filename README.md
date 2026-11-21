# gta6-reels — daily GTA 6 news & facts reels (copyright-safe)

Every day, GitHub Actions makes **two** vertical reels (15–30 s) about GTA 6 and uploads it to
YouTube Shorts, and to Facebook Reels if the Facebook secrets are set.

```
Gemini + Google Search  →  real, current GTA 6 topic + facts + sources
Gemini                  →  script (hook, 4–6 scenes, on-screen text, image prompts)
Gemini image model      →  one generic AI background per scene (no game footage/logos)
Gemini TTS (Fenrir)     →  English voiceover  (free Kokoro voice is the automatic fallback)
render/render.py        →  9:16 video: Ken Burns backgrounds, neon text, counters, word captions,
                           progress bar, FOLLOW card, fan-channel disclaimer
ffmpeg                  →  voice + original generated beat, loudness for Shorts
YouTube / Facebook      →  scheduled for 1:00 PM and 8:00 PM Pakistan time
```

## Copyright safety
- No Rockstar footage, trailers, screenshots, art, logos or music. Backgrounds are generic AI photos
  (or code-drawn neon city), music is generated fresh each time.
- The script may only use facts from that day's web research (sources go into the description).
- Every upload says: fan channel, not affiliated with Rockstar Games / Take-Two. AI content is disclosed
  (YouTube `containsSyntheticMedia`, Facebook `is_ai_generated`).
- Rules for the writer live in `channel/brief.md` — edit them to change the channel's voice.

---

## Setup (Urdu / English)

### 1. Secrets — repo → Settings → Secrets and variables → Actions → **New repository secret**

| Secret | Kahan se milega |
|---|---|
| `GEMINI_API_KEY` | aistudio.google.com → Get API key (wahi key jo Sunny/Unknown Atlas mein hai, chal jayegi) |
| `YOUTUBE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → OAuth client (Desktop app). YouTube Data API v3 enable honi chahiye |
| `YOUTUBE_CLIENT_SECRET` | same OAuth client |
| `YOUTUBE_REFRESH_TOKEN` | apne computer par `npm run auth:youtube` → link kholein → **GTA 6 wala channel** choose karein |
| `FACEBOOK_PAGE_ID` / `FACEBOOK_PAGE_TOKEN` | optional — `npm run auth:facebook` (Sunny jaisa hi process) |

> Same OAuth client Sunny wala bhi use ho sakta hai, lekin refresh token **naye GTA channel** ke liye
> alag banana hoga, warna video Sunny ke channel par chali jayegi.

### 2. Test (koi key nahi chahiye)
Actions → **Daily GTA 6 reel** → Run workflow → mode **test**.
Run ke Summary page par **reel** artifact se video download karke dekh lein.

### 3. Real reel without upload
mode **no-upload** — Gemini research + AI images + Gemini voice. Video artifact mein milegi.

### 4. YouTube keys check
mode **upload-test** — sample reel YouTube par **private** upload hoti hai.

### 5. Daily automation
Kuch nahi karna — schedule khud chalta hai: roz 2 reels, 1:00 PM aur 8:00 PM PKT par public. Ya mode **full** (agle khali slot mein) / **publish-now**.

## Settings (Actions → Variables, optional)
| Variable | Default | Meaning |
|---|---|---|
| `PUBLISH_TIMES` | `13:00,20:00` | Pakistan time jab reels public hon (comma se jitne chahein; har time ke liye cron bhi add karein) |
| `UPLOAD_MODE` | `schedule` | `schedule` / `private` / `public` |
| `IMAGE_PROVIDER` | `gemini` | `off` = sirf neon backgrounds (free, koi image quota nahi) |
| `TTS_PROVIDER` | `gemini` | `kokoro` = free natural voice, `espeak` = robot (test) |
| `GEMINI_VOICE` | `Fenrir` | other narrators: `Orus`, `Charon`, `Puck` |
| `FACEBOOK_ENABLED` | `true` | `false` = Facebook band |
| `GEMINI_TEXT_MODEL` / `GEMINI_IMAGE_MODEL` / `GEMINI_TTS_MODEL` | see `src/pipeline/config.ts` | model override |

Own music: put `.mp3`/`.wav` files you have rights to in `assets/music/` — one is picked at random.

## Local run
```bash
npm install
pip install -r render/requirements.txt   # + ffmpeg
cp .env.example .env                       # fill keys
npm run reel:sample                        # sample, free voice, no upload
npm run reel -- --no-upload                # real reel, no upload
```
Output: `out/<date>-<title>/reel.mp4` (+ `script.json`, `research.md`).
