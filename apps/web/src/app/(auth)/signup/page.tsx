import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/SignupForm";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { authErrorMessage } from "@/lib/auth/redirects";

export const metadata: Metadata = { title: "Sign up" };

type SP = Promise<{ error?: string; next?: string }>;

export default async function SignupPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <>
      <SignupForm next={sp.next} />
      <OAuthButtons mode="signup" next={sp.next} initialError={authErrorMessage(sp.error)} />
    </>
  );
}
