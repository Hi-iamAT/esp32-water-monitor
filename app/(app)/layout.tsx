import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { UserPanel, type SessionUser } from "@/components/UserPanel";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureProfileRow, isSupabaseConfigured } from "@/lib/data";

/**
 * Protected app shell: sidebar + streamed user panel.
 * Authorization happens in proxy.ts (fast), in the Suspense-wrapped gate
 * below (authoritative), and again in Supabase via RLS (defense in depth).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <Sidebar>
        <Suspense fallback={<UserPanelFallback />}>
          <UserPanelServer />
        </Suspense>
      </Sidebar>
      <main className="min-w-0 flex-1 bg-slate-50 pb-10">{children}</main>
    </div>
  );
}

/** Authoritative session gate inside the shell. */
async function UserPanelServer() {
  if (!isSupabaseConfigured()) {
    return (
      <UserPanelFallback>
        Demo mode — Supabase not configured
      </UserPanelFallback>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  await ensureProfileRow(data.user.id, data.user.email, data.user.user_metadata);

  const meta = data.user.user_metadata as Record<string, string | undefined>;

  const user: SessionUser = {
    email: data.user.email ?? null,
    fullName: meta?.full_name ?? null,
  };
  return <UserPanel user={user} />;
}

function UserPanelFallback({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-3 mb-4 rounded-xl bg-slate-800 p-3 text-[11px] text-slate-500">
      {children ?? "Loading account…"}
    </div>
  );
}
