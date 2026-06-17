"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function SignOutButton() {
  const router = useRouter();
  const onClick = async () => {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  };
  return (
    <button type="button" className="sign-out-button" onClick={onClick}>
      Sign out
    </button>
  );
}
