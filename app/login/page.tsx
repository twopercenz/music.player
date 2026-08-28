"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth", {
      method: "POST",
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.replace(searchParams.get("from") || "/");
      router.refresh();
    } else {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "로그인에 실패했습니다");
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-black text-white">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xs rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-md"
      >
        <div className="mb-6 flex justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
            <Lock className="h-4 w-4" />
          </div>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-center text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        {error && <p className="mt-3 text-center text-xs text-red-300/90">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-4 w-full rounded-lg bg-white py-2.5 text-sm font-medium text-black transition disabled:opacity-50"
        >
          {loading ? "확인 중…" : "입장"}
        </button>
      </form>
    </div>
  );
}
