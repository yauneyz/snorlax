import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { authErrorMessage } from "@/lib/auth/redirects";

export const metadata: Metadata = { title: "Log in" };

type SP = Promise<{ next?: string; error?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <>
      <LoginForm next={sp.next} initialError={authErrorMessage(sp.error)} />
      <OAuthButtons next={sp.next} mode="login" />
    </>
  );
}
