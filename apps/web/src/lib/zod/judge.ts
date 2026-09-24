import { z } from "zod";
import { JUDGE_LIMITS } from "@talysman/shared";

/**
 * Body of POST /api/desktop/judge (`JudgeHttpRequest` in packages/shared/src/judge.ts). Page
 * fields are truncated rather than rejected — a page that's merely long is not a validation
 * failure — while the judge configuration is bounded like `normalizePolicy` bounds it.
 */
const text = (max: number) => z.string().transform((value) => value.slice(0, max));

export const judgeRequestSchema = z.object({
  url: z.string().min(1).max(JUDGE_LIMITS.url),
  title: text(JUDGE_LIMITS.title).default(""),
  content: text(JUDGE_LIMITS.content),
  context: z
    .object({ site: z.string().max(64), feature: z.string().max(64) })
    .optional(),
  judge: z.object({
    tasks: z
      .array(z.object({ id: z.string().max(128).optional(), title: z.string().min(1).max(500), notes: z.string().max(500).optional() }))
      .min(1)
      .max(20),
    avoid: z.array(z.string().min(1).max(500)).max(20).default([]),
  }),
});

export type JudgeRequestInput = z.infer<typeof judgeRequestSchema>;
