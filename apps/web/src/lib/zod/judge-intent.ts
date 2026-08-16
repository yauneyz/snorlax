import { z } from "zod";

/**
 * Server-side cap on how much page text we'll ever send to the LLM. The desktop
 * caller should already be capping `extractedText` before sending it, but this is
 * enforced again here as defense-in-depth — truncated, not rejected, since a page
 * that's merely long is not a validation failure.
 */
export const JUDGE_INTENT_MAX_EXTRACTED_TEXT_LENGTH = 4000;

export const judgeIntentSchema = z.object({
  url: z.string().min(1),
  extractedText: z.string(),
  intent: z.object({
    positive: z.string().min(1),
    negative: z.string().optional(),
  }),
});

export type JudgeIntentInput = z.infer<typeof judgeIntentSchema>;
