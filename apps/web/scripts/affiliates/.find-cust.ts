import Stripe from "stripe";
import { loadAffiliatesEnvironment } from "/data/zac/zac/development/snorlax/apps/web/scripts/affiliates/environment";
const env = loadAffiliatesEnvironment("dev");
const stripe = new Stripe(env.stripeSecretKey!);
const charges = await stripe.charges.list({ limit: 20 });
const seen = new Set<string>();
for (const c of charges.data) {
  if (typeof c.customer === "string" && c.status === "succeeded" && !seen.has(c.customer)) {
    seen.add(c.customer);
    console.log(c.customer, c.amount, c.amount_refunded, c.currency, new Date(c.created * 1000).toISOString());
  }
}
