import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeRedirector />
    </Suspense>
  );
}

/**
 * Send authenticated users to the dashboard, everyone else to /login.
 * Cookies + the session check are request-time work — declared with
 * connection() so the root shell prerenders cleanly.
 */
async function HomeRedirector() {
  await connection();

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  if (!configured) return redirect("/login?setup=1");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return redirect(data.user ? "/dashboard" : "/login");
}
