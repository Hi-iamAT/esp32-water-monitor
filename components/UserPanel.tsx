"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type SessionUser = {
  email: string | null;
  fullName: string | null;
};

/** Sidebar footer: who is signed in + sign out. Client-side session read. */
export function UserPanel({ user }: { user: SessionUser | null }) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  if (!user) return null;

  const label =
    user.fullName?.trim() || user.email?.split("@")[0] || "Account";

  return (
    <div className="mx-3 mb-4 rounded-xl bg-slate-800 p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sm font-bold text-sky-300 uppercase">
          {label.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{label}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">signed in</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <a
          href="/settings"
          className="flex-1 rounded-lg bg-slate-700 px-2 py-1.5 text-center text-xs font-medium text-slate-200 hover:bg-slate-600"
        >
          Account
        </a>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace("/login");
            router.refresh();
          }}
          className="flex-1 rounded-lg bg-slate-700 px-2 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
