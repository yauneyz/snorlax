"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Up to two letters for the avatar disc: initials for a full name, else the first letter. */
function initials(label: string | undefined): string {
  const words = (label ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function AccountMenu({ name }: { name?: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div className="site-account-menu" ref={menuRef}>
      <button
        type="button"
        className="site-account-menu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="site-account-menu__avatar" aria-hidden="true">
          {initials(name)}
        </span>
        Account
      </button>
      {open ? (
        <div className="site-account-menu__dropdown" role="menu">
          <Link href="/account" role="menuitem" onClick={() => setOpen(false)}>
            Account settings
          </Link>
          <button type="button" role="menuitem" onClick={signOut}>
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
