import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { OAuthButtons } from "@/components/auth/OAuthButtons";

export const metadata: Metadata = { title: "Log in" };

type SP = Promise<{ next?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <>
      <LoginForm next={sp.next} />
      <OAuthButtons next={sp.next} />
    </>
  );
}
