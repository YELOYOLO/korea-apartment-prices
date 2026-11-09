"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getClient } from "@/lib/supabase";
import { Button, TextField } from "./ui";

/** Keep redirects inside this site. */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/watch";
}

export default function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signup" && password.length < 8) {
      setError("비밀번호는 8자 이상으로 정해 주세요.");
      return;
    }
    setBusy(true);
    const client = getClient();
    try {
      if (mode === "login") {
        const { error: err } = await client.auth.signInWithPassword({ email, password });
        if (err) throw new Error(/invalid/i.test(err.message) ? "이메일 또는 비밀번호가 맞지 않습니다." : /confirm/i.test(err.message) ? "이메일 인증을 먼저 완료해 주세요." : err.message);
        router.push(safeNext(params.get("next")));
      } else {
        const { data, error: err } = await client.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/watch` } });
        if (err) throw new Error(err.message);
        if (data.session) router.push("/watch");
        else setSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6" role="status">
        <p className="font-semibold">인증 메일을 보냈습니다.</p>
        <p className="mt-1 text-sm text-text-secondary">{email}로 보낸 메일의 링크를 누르면 가입이 완료됩니다. 메일이 안 보이면 스팸함도 확인하세요.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-6" noValidate>
      <TextField label="이메일" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField
        label="비밀번호"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={mode === "signup" ? "8자 이상" : undefined}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy || !email || !password}>
        {busy ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            처음이신가요?{" "}
            <Link href="/signup" className="font-semibold text-brand-text">
              회원가입
            </Link>
          </>
        ) : (
          <>
            이미 계정이 있나요?{" "}
            <Link href="/login" className="font-semibold text-brand-text">
              로그인
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
