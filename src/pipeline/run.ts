import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { facebookConfigured, uploadFacebookReel } from "./facebook";
import { appendHistory, loadHistory } from "./history";
import { makeImages } from "./images";
import { ReelScript } from "./reel";
import { buildTimeline, renderReel } from "./render";
import { writeReel } from "./script";
import { voiceReel } from "./tts";
import { nextFreeSlot, uploadShort } from "./upload";

/**
 * One reel: research → script → images → voice → render → upload.
 *
 *   npm run reel                         full daily run
 *   npm run reel -- --no-upload          everything except uploading
 *   npm run reel -- --no-facebook        skip Facebook
 *   npm run reel -- --if-slot-free       do nothing if the next publish slot already has a reel
 *   npm run reel -- --sample             skip Gemini script, use data/sample-reel.json
 *   npm run reel -- --script=path.json   use a hand-written script
 *   npm run reel -- --tts=kokoro|espeak  free offline voice
 *   npm run reel -- --images=off         code-drawn neon backgrounds only
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"] as const;
  }),
);
if (args.has("tts")) config.ttsProvider = args.get("tts") as typeof config.ttsProvider;
if (args.has("images")) config.imageProvider = args.get("images") as typeof config.imageProvider;

const gh = Boolean(process.env.GITHUB_ACTIONS);
const clean = (s: string) => s.replace(/[:,\r\n%]/g, " ");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function main() {
  const t0 = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const history = await loadHistory();

  // Scheduled runs fire several times a day (GitHub often starts cron late or skips it).
  // Each run fills the soonest empty publish slot in the next few hours, or does nothing.
  const taken = new Set(history.map((h) => h.publishAt).filter((s): s is string => Boolean(s)));
  let slot: string | undefined;
  if (args.has("if-slot-free")) {
    slot = nextFreeSlot(taken, config.slotWindowHours) ?? undefined;
    if (!slot) {
      console.log(`No empty slot (${config.publishTimes.join(", ")}) in the next ${config.slotWindowHours}h. Nothing to do.`);
      if (gh) console.log(`::notice title=Nothing to do::every slot in the next ${config.slotWindowHours}h already has a reel`);
      return;
    }
    console.log(`Slot ${slot} is free; making a reel for it.`);
  } else if (config.uploadMode === "schedule") {
    slot = nextFreeSlot(taken) ?? undefined;
  }

  // 1. Research + script
  let script: ReelScript;
  let notes = "";
  const scriptPath = args.get("script") ?? (args.has("sample") ? config.paths.sample : undefined);
  if (scriptPath) {
    script = ReelScript.parse(JSON.parse(await fs.readFile(scriptPath, "utf8")));
    console.log(`Script: loaded ${path.relative(process.cwd(), scriptPath)}`);
  } else {
    console.log(`Script: researching with ${config.geminiTextModel} + Google Search…`);
    ({ script, notes } = await writeReel(history));
  }
  console.log(`  "${script.title}" — ${script.format} — ${script.scenes.length} scenes`);
  if (gh) console.log(`::notice title=${clean(script.title)}::${clean(script.scenes.map((s) => s.line).join(" / "))}`);

  const dir = path.join(config.paths.out, `${date}-${slug(script.title)}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "script.json"), JSON.stringify(script, null, 2));
  if (notes) await fs.writeFile(path.join(dir, "research.md"), notes);

  // 2. Background images (never fatal; failed ones fall back to the neon city)
  console.log(`Images: ${config.imageProvider === "off" ? "off (neon backgrounds)" : config.geminiImageModel}`);
  const images = await makeImages(
    script.scenes.map((s) => s.visual),
    script.scenes.map((_, i) => path.join(dir, `bg-${i + 1}.png`)),
  );

  // 3. Voice
  console.log(`Voice: ${config.ttsProvider}`);
  const { voiced, provider } = await voiceReel(
    script.scenes.map((s) => s.line),
    script.scenes.map((_, i) => path.join(dir, `line-${i + 1}.wav`)),
  );
  voiced.forEach((v, i) => console.log(`  line ${i + 1}: ${v.duration.toFixed(2)}s — "${script.scenes[i].line}"`));

  // 4. Render
  const spec = await buildTimeline(script, voiced, images, dir);
  if (spec.total > 40) console.warn(`  Warning: ${spec.total.toFixed(1)}s of voice; aim for 15–30 s.`);
  console.log(`Render: ${spec.total.toFixed(1)}s voice + follow card, ${images.filter(Boolean).length}/${images.length} AI backgrounds, voice ${provider}`);
  const mp4 = path.join(dir, "reel.mp4");
  const seconds = await renderReel(spec, dir, mp4);
  console.log(`  saved ${path.relative(process.cwd(), mp4)} (${seconds.toFixed(1)}s)`);

  // 5. Upload
  if (args.has("no-upload")) {
    console.log("Upload: skipped (--no-upload)");
  } else if (args.has("facebook-only")) {
    if (!facebookConfigured()) throw new Error("Facebook test needs FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN secrets.");
    const fb = await uploadFacebookReel(mp4, script);
    console.log(`Facebook: Reel ${fb.videoId} ${fb.state}`);
    if (gh) console.log(`::notice title=Facebook test::Reel ${fb.videoId} ${fb.state}`);
  } else {
    const { videoId, publishAt } = await uploadShort(mp4, script, slot);
    console.log(`YouTube: https://youtube.com/shorts/${videoId}${publishAt ? ` (goes public ${publishAt})` : ""}`);
    if (gh) console.log(`::notice title=YouTube::https://youtube.com/shorts/${videoId}${publishAt ? ` public at ${publishAt}` : ""}`);

    // Facebook is optional and never costs us the YouTube upload or the history entry.
    let facebookVideoId: string | undefined;
    if (args.has("no-facebook") || !facebookConfigured()) {
      console.log(`Facebook: skipped (${args.has("no-facebook") ? "--no-facebook" : "FACEBOOK_ENABLED is false or Facebook secrets are missing"})`);
    } else {
      try {
        const fb = await uploadFacebookReel(mp4, script, publishAt);
        facebookVideoId = fb.videoId;
        console.log(`Facebook: Reel ${fb.videoId} ${fb.state}`);
      } catch (err) {
        console.error(err);
        if (gh) console.log(`::error title=Facebook upload failed::${String((err as Error)?.message ?? err).replace(/[\r\n%]/g, " ")}`);
        process.exitCode = 1;
      }
    }
    if (!args.has("sample")) {
      await appendHistory({ date, title: script.title, topic: script.topic, format: script.format, videoId, publishAt, facebookVideoId });
    }
  }
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

function describe(err: unknown): string {
  const e = err as { message?: string; response?: { status?: number; data?: unknown } };
  const data = e?.response?.data ? ` | ${e.response.status} ${JSON.stringify(e.response.data)}` : "";
  return `${e?.message ?? String(err)}${data}`.slice(0, 1500);
}

main().catch((err) => {
  console.error(err);
  if (gh) console.log(`::error title=Reel failed::${describe(err).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
  process.exit(1);
});
