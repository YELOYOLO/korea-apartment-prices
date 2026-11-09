"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import * as api from "@/lib/api";
import { DEFAULT_FILTERS, parseFilters, serializeFilters, type SearchFilters } from "@/lib/search";
import { getClient } from "@/lib/supabase";

/* The parts of the Web Speech API used here (Chrome/Edge/Samsung Internet, Safari 14.1+). */
interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const EXAMPLES = ["강남구 15억 이하 국평 20% 싼 거", "부산 해운대구 공매", "분당 신축 대장 급매 목록으로", "더 싼 순으로 보여줘"];

const SPEECH_ERRORS: Record<string, string> = {
  "not-allowed": "마이크 권한이 꺼져 있어요. 브라우저 설정에서 이 사이트의 마이크를 허용해 주세요.",
  "service-not-allowed": "이 브라우저에서는 음성 인식을 쓸 수 없어요. 글자로 입력해 주세요.",
  "no-speech": "말소리가 들리지 않았어요. 다시 눌러 말씀해 주세요.",
  "audio-capture": "마이크를 찾지 못했어요.",
  network: "음성 인식 서버에 연결하지 못했어요. 글자로 입력해 주세요.",
};

export function AgentBar({ filters, onApply }: { filters: SearchFilters; onApply: (f: SearchFilters) => void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ text: string; mode: "ai" | "rules" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  });
  useEffect(() => {
    // feature detection must run in the browser, after hydration
    setCanListen(Boolean(recognitionCtor())); // eslint-disable-line react-hooks/set-state-in-effect
    return () => rec.current?.stop();
  }, []);

  const ask = async (q: string) => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { bounds: _bounds, ...current } = filtersRef.current;
      void _bounds;
      const res = await api.aiSearch(getClient(), query, current);
      // the server validated the filters; round-trip through the URL format as well
      const next = parseFilters(serializeFilters({ ...DEFAULT_FILTERS, ...(res.filters as Partial<SearchFilters>), bounds: null }));
      onApply(next);
      setReply({ text: res.reply, mode: res.mode });
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 검색에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const listen = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "ko-KR";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const res = e.results[k]!;
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setText((finalText + interim).trim());
    };
    r.onerror = (e) => setError(SPEECH_ERRORS[e.error] ?? "음성 인식 중 문제가 생겼어요. 글자로 입력해 주세요.");
    r.onend = () => {
      setListening(false);
      if (finalText.trim()) void ask(finalText);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(text);
  };

  return (
    <section aria-label="AI 검색" className="space-y-2 rounded-xl border border-brand/30 bg-brand-soft/40 p-3">
      <form onSubmit={submit} className="flex items-center gap-2">
        {canListen && (
          <button
            type="button"
            onClick={listen}
            aria-pressed={listening}
            aria-label={listening ? "음성 입력 끝내기" : "음성으로 검색"}
            className={`grid size-11 shrink-0 place-items-center rounded-full text-white ${listening ? "animate-pulse bg-danger" : "bg-brand"}`}
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <label htmlFor="agent-q" className="sr-only">
          AI에게 찾을 집을 말하기
        </label>
        <input
          id="agent-q"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? "듣고 있어요…" : "예: 강남구 15억 이하 국평 20% 싼 거"}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-base"
        />
        <button type="submit" disabled={busy || !text.trim()} className="min-h-11 shrink-0 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "찾는 중…" : "AI 검색"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
      {reply ? (
        <p aria-live="polite" className="text-sm">
          <span className="mr-1 rounded bg-brand px-1.5 py-0.5 text-xs font-bold text-white">{reply.mode === "ai" ? "AI" : "간단 해석"}</span>
          {reply.text}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="예시 질문">
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button type="button" onClick={() => void ask(ex)} disabled={busy} className="min-h-9 rounded-full border border-border bg-surface px-3 text-xs">
                {ex}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
