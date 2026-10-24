import { z } from 'zod';

/**
 * A message we pushed to this app (GET /api/desktop/messages). Shown as a banner, and in the
 * startup-failure dialog when the app can't get that far.
 */
export const appMessageSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
  createdAt: z.string(),
});
export type AppMessage = z.infer<typeof appMessageSchema>;
export const appMessageListSchema = z.array(appMessageSchema);

/** POST /api/desktop/messages/receipt: `seen` when shown, `dismissed` when the user closes it. */
export const appMessageReceiptSchema = z.object({
  messageId: z.string().uuid(),
  status: z.enum(['seen', 'dismissed']),
});
export type AppMessageReceipt = z.infer<typeof appMessageReceiptSchema>;
