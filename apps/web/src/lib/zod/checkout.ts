import { z } from "zod";
import { checkoutPriceSchema } from "@focuslock/product";

export const checkoutSchema = z.object({
  price: checkoutPriceSchema,
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
