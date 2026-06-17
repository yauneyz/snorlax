import { NextResponse } from "next/server";
import {
  DESKTOP_BILLING_CANCEL_PATH,
  desktopDeepLinkUrl,
} from "@focuslock/auth-contracts";

export async function GET() {
  return NextResponse.redirect(desktopDeepLinkUrl(DESKTOP_BILLING_CANCEL_PATH));
}
