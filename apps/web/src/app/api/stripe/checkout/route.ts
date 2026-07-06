import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { captureException } from "@/lib/sentry";
import { createCheckoutSession } from "@/lib/stripe/checkout";
import { checkoutSchema } from "@/lib/zod/checkout";

export async function POST(request: NextRequest) {
  const user = await requireUser();
  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const { url } = await createCheckoutSession({
      userId: user.id,
      userEmail: user.email ?? "",
      price: parsed.data.price,
    });
    return NextResponse.json({ url });
  } catch (err) {
    // Internal details (profile lookups, Stripe errors) go to Sentry, not the client.
    await captureException(err, { userId: user.id, route: "stripe/checkout" });
    return NextResponse.json({ error: "Checkout failed — please try again" }, { status: 500 });
  }
}
