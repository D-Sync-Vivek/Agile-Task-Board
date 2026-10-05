"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getErrorMessage, getFieldErrors } from "@/lib/errors";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { safeNextPath } from "@/lib/safeRedirect";
import { useAuthStore } from "@/store/useAuthStore";

type Mode = "login" | "register";

const withNext = (path: string, rawNext: string | null) => (rawNext ? `${path}?next=${encodeURIComponent(safeNextPath(rawNext))}` : path);

const inputClass = "w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none";

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const status = useAuthStore((state) => state.status);
  const fetchSession = useAuthStore((state) => state.fetchSession);
  const rawNext = new URLSearchParams(useLocationSearch()).get("next");
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Already signed in (or just signed in): leave this page.
  useEffect(() => {
    if (status === "unknown") void fetchSession();
    if (status === "authenticated") router.replace(safeNextPath(rawNext));
  }, [status, fetchSession, router, rawNext]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    try {
      if (mode === "login") await login({ email, password });
      else await register({ name, email, password });
      // The effect above performs the redirect once the store reports "authenticated".
    } catch (error) {
      const fields = getFieldErrors(error);
      setFieldErrors(fields);
      if (Object.keys(fields).length === 0) setFormError(getErrorMessage(error, "Something went wrong. Please try again."));
    } finally {
      setPending(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <form onSubmit={handleSubmit} noValidate className="w-full max-w-sm space-y-4 rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-xl">
        <div>
          <h1 className="text-2xl font-bold text-white">{isLogin ? "Log in" : "Create your account"}</h1>
          <p className="mt-1 text-sm text-gray-400">Agile Task Board</p>
        </div>

        {formError && (
          <p role="alert" className="rounded border border-red-500/60 bg-red-950 px-3 py-2 text-sm text-red-100">
            {formError}
          </p>
        )}

        {!isLogin && (
          <div>
            <label htmlFor="name" className="mb-1 block text-sm text-gray-300">Name</label>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} aria-invalid={!!fieldErrors.name} />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-400">{fieldErrors.name}</p>}
          </div>
        )}

        <div>
          <label htmlFor="email" className="mb-1 block text-sm text-gray-300">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} aria-invalid={!!fieldErrors.email} />
          {fieldErrors.email && <p className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm text-gray-300">Password</label>
          <input id="password" type="password" autoComplete={isLogin ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} aria-invalid={!!fieldErrors.password} />
          {fieldErrors.password && <p className="mt-1 text-xs text-red-400">{fieldErrors.password}</p>}
          {!isLogin && !fieldErrors.password && <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>}
        </div>

        <button type="submit" disabled={pending} className="w-full rounded bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500 disabled:cursor-wait disabled:opacity-60">
          {pending ? (isLogin ? "Logging in…" : "Creating account…") : isLogin ? "Log in" : "Create account"}
        </button>

        <p className="text-center text-sm text-gray-400">
          {isLogin ? "New here? " : "Already have an account? "}
          <Link href={withNext(isLogin ? "/register" : "/login", rawNext)} className="text-rose-400 hover:underline">
            {isLogin ? "Create an account" : "Log in"}
          </Link>
        </p>
      </form>
    </main>
  );
}
