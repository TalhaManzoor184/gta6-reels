import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { durationOf, ffmpeg } from "./audio";
import { config } from "./config";
import type { RenderSpec, ReelScript } from "./reel";
import type { Voiced } from "./tts";

const run = promisify(execFile);
const GAP = 0.25; // pause between voiceover lines
const CTA = 1.8; // keep in sync with CTA_SECONDS in render/render.py

/** Join the per-line voice clips with short gaps and work out every scene's place on the timeline. */
export async function buildTimeline(script: ReelScript, voiced: Voiced[], images: (string | null)[], dir: string): Promise<RenderSpec> {
  const list = path.join(dir, "voice-list.txt");
  const silence = path.join(dir, "gap.wav");
  await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(GAP), silence]);
  const entries: string[] = [];
  let t = 0;
  const scenes: RenderSpec["scenes"] = [];
  for (const [i, v] of voiced.entries()) {
    const sc = script.scenes[i];
    scenes.push({
      start: t,
      end: t + v.duration,
      line: sc.line,
      onscreen: sc.onscreen,
      counter: sc.counter ? { from: sc.counter.from ?? 0, to: sc.counter.to, prefix: sc.counter.prefix ?? "", suffix: sc.counter.suffix ?? "" } : null,
      image: images[i],
      words: v.words.map((w) => ({ text: w.text, start: w.start + t, end: w.end + t })),
    });
    entries.push(`file '${v.wavPath}'`, `file '${silence}'`);
    t += v.duration + GAP;
  }
  await fs.writeFile(list, entries.join("\n"));
  const voice = path.join(dir, "voice.wav");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-ar", "44100", "-ac", "1", voice]);
  return { hook: script.hook, cta: "for daily GTA 6 news", total: t, voice, scenes };
}

/** Background music: a random file from assets/music, or a freshly generated original beat. */
async function music(dir: string, seconds: number): Promise<string> {
  try {
    const files = (await fs.readdir(config.paths.music)).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f));
    if (files.length) return path.join(config.paths.music, files[Math.floor(Math.random() * files.length)]);
  } catch {
    /* no music folder */
  }
  const out = path.join(dir, "music.wav");
  await run(config.python, [path.join(config.paths.render, "music.py"), out, seconds.toFixed(2), String(Math.floor(Math.random() * 1000))]);
  return out;
}

export async function renderReel(spec: RenderSpec, dir: string, outMp4: string): Promise<number> {
  const specPath = path.join(dir, "render-spec.json");
  await fs.writeFile(specPath, JSON.stringify(spec, null, 2));
  const silent = path.join(dir, "video-silent.mp4");
  const t0 = Date.now();
  await run(config.python, [path.join(config.paths.render, "render.py"), specPath, silent], { maxBuffer: 64 * 1024 * 1024 });
  console.log(`  frames rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const total = spec.total + CTA;
  const bed = await music(dir, total + 1);
  await ffmpeg([
    "-i", silent,
    "-i", spec.voice,
    "-stream_loop", "-1", "-i", bed,
    "-filter_complex",
    `[1:a]volume=1.5,apad[v];[2:a]volume=0.13,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[m];[v][m]amix=inputs=2:duration=first:normalize=0,atrim=0:${total.toFixed(2)},loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
    "-t", total.toFixed(2), "-movflags", "+faststart",
    outMp4,
  ]);
  return durationOf(outMp4);
}
