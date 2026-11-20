import { z } from "zod";

/** One scene = one voiceover line with its own background and big on-screen text. */
export const Scene = z.object({
  line: z.string().min(3).max(220),
  onscreen: z.string().min(1).max(40),
  /** Optional animated number, e.g. { to: 40000000000, prefix: "", suffix: "" }. */
  counter: z
    .object({
      to: z.number(),
      from: z.number().optional(),
      prefix: z.string().max(4).optional(),
      suffix: z.string().max(12).optional(),
    })
    .nullable()
    .optional(),
  visual: z.string().min(5).max(400),
});

export const ReelScript = z.object({
  title: z.string().min(5).max(100),
  description: z.string().min(10).max(1500),
  tags: z.array(z.string()).min(3).max(15),
  topic: z.string().min(3).max(160),
  format: z.enum(["news", "facts", "tips", "theory", "comparison"]),
  hook: z.string().min(3).max(40),
  scenes: z.array(Scene).min(3).max(7),
  sources: z.array(z.string()).max(8).default([]),
});

export type ReelScript = z.infer<typeof ReelScript>;
export type SceneT = z.infer<typeof Scene>;

/** What the Python renderer receives. Times in seconds on the final timeline. */
export type RenderSpec = {
  hook: string;
  cta: string;
  total: number;
  voice: string;
  music?: string;
  scenes: {
    start: number;
    end: number;
    line: string;
    onscreen: string;
    counter?: { from: number; to: number; prefix: string; suffix: string } | null;
    image?: string | null;
    words: { text: string; start: number; end: number }[];
  }[];
};
