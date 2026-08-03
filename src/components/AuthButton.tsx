"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase/client";

interface Props {
  onAuthChange: (user: User | null) => void;
}

export default function AuthButton({ onAuthChange }: Props) {
  const supabase = getSupabaseBrowser();
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const onAuthChangeRef = useRef(onAuthChange);
  onAuthChangeRef.current = onAuthChange;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      onAuthChangeRef.current(data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      onAuthChangeRef.current(u);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (!supabase) {
    return (
      <div className="group relative pointer-events-auto">
        <button className="panel cursor-help rounded-xl px-4 py-2.5 text-sm text-slate-500">
          Sign in
        </button>
        <div className="panel invisible absolute right-0 top-full z-10 mt-2 w-64 rounded-xl p-3 text-xs text-slate-400 group-hover:visible">
          Add <code className="text-slate-300">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-slate-300">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
          <code className="text-slate-300">.env.local</code> to enable accounts.
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div ref={boxRef} className="relative pointer-events-auto">
        <button
          onClick={() => setOpen((o) => !o)}
          className="panel rounded-xl px-4 py-2.5 text-sm text-slate-200"
        >
          {user.email?.split("@")[0] ?? "Account"}
        </button>
        {open && (
          <div className="panel absolute right-0 top-full z-10 mt-2 w-48 rounded-xl p-2">
            <button
              onClick={() => supabase.auth.signOut()}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-700/40"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative pointer-events-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className="panel rounded-xl px-4 py-2.5 text-sm text-slate-200 hover:text-white"
      >
        Sign in
      </button>
      {open && (
        <div className="panel absolute right-0 top-full z-10 mt-2 w-72 rounded-xl p-3">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                  redirectTo: `${window.location.origin}/auth/callback`,
                },
              });
            }}
            className="mb-2 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50"
          >
            Continue with Google
          </button>
          <div className="mb-2 text-center text-xs text-slate-500">or magic link</div>
          {sent ? (
            <p className="text-sm text-emerald-400">Check your email for a sign-in link.</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const { error } = await supabase.auth.signInWithOtp({
                  email,
                  options: {
                    emailRedirectTo: `${window.location.origin}/auth/callback`,
                  },
                });
                setBusy(false);
                if (!error) setSent(true);
              }}
              className="flex gap-2"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="min-w-0 flex-1 rounded-lg border border-slate-700/60 bg-slate-800/60 px-3 py-2 text-sm outline-none placeholder:text-slate-500"
              />
              <button
                disabled={busy}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
