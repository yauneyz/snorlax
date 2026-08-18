import "server-only";
import { GoogleAuth } from "google-auth-library";
import { config } from "@/lib/config";
import { captureException } from "@/lib/sentry";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type InsightsPush =
  | { type: "download"; platform: "win" | "mac" | "linux" }
  | { type: "paid_conversion" };

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function payloadFor(message: InsightsPush): Record<string, string> {
  if (message.type === "paid_conversion") {
    return {
      type: message.type,
      title: "A new paid user! 🎉",
      body: "Someone just became a paying Talysman customer.",
    };
  }

  const platform = { win: "Windows", mac: "macOS", linux: "Linux" }[message.platform];
  return {
    type: message.type,
    title: "New download",
    body: `Someone downloaded Talysman for ${platform}.`,
    platform: message.platform,
  };
}

function configured(): boolean {
  const { projectId, clientEmail, privateKey } = config.insights.fcm;
  return Boolean(projectId && clientEmail && privateKey);
}

async function disableToken(token: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("insights_push_devices")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("token", token);
  if (error) throw new Error(`failed to disable rejected FCM token: ${error.message}`);
}

async function sendOne(token: string, accessToken: string, message: InsightsPush): Promise<void> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.insights.fcm.projectId)}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          data: payloadFor(message),
          android: {
            priority: "HIGH",
            ttl: "300s",
          },
        },
      }),
    },
  );

  if (response.ok) return;

  const body = await response.text();
  if (response.status === 404 || body.includes("UNREGISTERED")) {
    await disableToken(token);
    return;
  }
  throw new Error(`FCM send failed (${response.status}): ${body.slice(0, 500)}`);
}

/** Best-effort fan-out. Push delivery must never break a download or Stripe webhook. */
export async function sendInsightsPush(message: InsightsPush): Promise<void> {
  if (!configured()) return;

  try {
    const { data, error } = await supabaseAdmin()
      .from("insights_push_devices")
      .select("token")
      .eq("enabled", true);
    if (error) throw new Error(`failed to load FCM devices: ${error.message}`);
    if (!data?.length) return;

    const auth = new GoogleAuth({
      credentials: {
        client_email: config.insights.fcm.clientEmail,
        private_key: config.insights.fcm.privateKey,
      },
      scopes: [FCM_SCOPE],
    });
    const accessToken = await auth.getAccessToken();
    if (!accessToken) throw new Error("FCM service account returned no access token");

    const outcomes = await Promise.allSettled(
      data.map(({ token }) => sendOne(token, accessToken, message)),
    );
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === "rejected") {
        await captureException(outcome.reason, {
          where: "insights.push.sendOne",
          pushType: message.type,
          tokenSuffix: data[index].token.slice(-8),
        });
      }
    }
  } catch (error) {
    await captureException(error, { where: "insights.push", pushType: message.type });
  }
}
