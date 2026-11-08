"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import songsData from "@/data/songs.json";
import {
  fetchResults,
  isDemoMode,
  loginBallot,
  saveBallot,
  AuthError,
  type Results,
} from "@/lib/votes";

type Song = {
  id: string;
  title: string;
  artist: string;
  videoId: string | null;
  videoTitle: string | null;
  /** 검색용 다른 표기 (예: 해외 아티스트의 한글 이름) */
  aka?: string[];
};

const SONGS = songsData as Song[];
const SONG_IDS = new Set(SONGS.map((s) => s.id));
const MAX_PICKS = 12;
const NAME_KEY = "daeoe-name";
const draftKey = (name: string) => `daeoe-draft:${name}`;
const EMPTY_RESULTS: Results = { participants: 0, completed: 0, tally: [] };

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장이 막혀 있어도 투표는 계속할 수 있다.
  }
}

function storageRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ");

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "알 수 없는 오류가 났어요.";

export default function Home() {
  const [session, setSession] = useState<{ name: string; pin: string } | null>(null);
  const [savedPicks, setSavedPicks] = useState<string[] | null>(null);
  const [lastName, setLastName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const [entering, setEntering] = useState(false);
  const [tab, setTab] = useState<"vote" | "results">("vote");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Results>(EMPTY_RESULTS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);

  async function reload() {
    try {
      setResults(await fetchResults());
      setLoadError(null);
    } catch (e) {
      setLoadError("투표 현황을 불러오지 못했어요: " + errorText(e));
    }
  }

  useEffect(() => {
    // 처음 열 때 지난번에 쓴 이름을 채워 두고 투표 현황을 불러온다.
    const last = storageGet(NAME_KEY);
    if (last && nameRef.current && !nameRef.current.value) nameRef.current.value = last;
    fetchResults()
      .then(setResults)
      .catch((e) => setLoadError("투표 현황을 불러오지 못했어요: " + errorText(e)));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const name = session?.name ?? null;
  const dirty = savedPicks === null || !sameSet(selected, savedPicks);

  async function enter() {
    const n = normalizeName(nameRef.current?.value ?? "");
    const pin = pinRef.current?.value ?? "";
    if (!n) {
      setNotice("이름을 입력해 주세요.");
      return;
    }
    if (!/^[0-9]{4}$/.test(pin)) {
      setNotice("비밀번호는 숫자 4자리로 입력해 주세요.");
      return;
    }

    setEntering(true);
    try {
      const existing = await loginBallot(n, pin);
      storageSet(NAME_KEY, n);
      setLastName(n);

      let picks = existing ?? [];
      let message = existing
        ? `지난번에 제출한 ${existing.length}곡을 불러왔어요. 이어서 고르거나 수정할 수 있어요.`
        : "처음 오셨네요! 제출하면 이 이름과 비밀번호로 나중에 다시 들어와 수정할 수 있어요.";

      // 이 브라우저에 제출하지 않은 선택이 남아 있으면 그걸 이어서 보여준다.
      const draft = storageGet(draftKey(n));
      if (draft) {
        try {
          const d: unknown = JSON.parse(draft);
          if (Array.isArray(d) && !sameSet(d as string[], picks)) {
            picks = d as string[];
            message = "제출하지 않은 선택을 불러왔어요. 제출해야 반영돼요.";
          }
        } catch {}
      }

      setSavedPicks(existing);
      setSelected(picks.filter((id) => SONG_IDS.has(id)).slice(0, MAX_PICKS));
      setSession({ name: n, pin });
      setNotice(message);
      void reload();
    } catch (e) {
      setNotice(
        e instanceof AuthError
          ? e.kind === "wrong"
            ? "이 이름으로 이미 투표한 사람이 있어요. " + e.message
            : e.message
          : "들어가지 못했어요: " + errorText(e),
      );
    } finally {
      setEntering(false);
    }
  }

  function leave() {
    setSession(null);
    setSavedPicks(null);
    setSelected([]);
    setPlaying(null);
    setOnlySelected(false);
  }

  function toggle(id: string) {
    if (!name) return;
    let next: string[];
    if (selected.includes(id)) {
      next = selected.filter((x) => x !== id);
    } else {
      if (selected.length >= MAX_PICKS) {
        setNotice(`최대 ${MAX_PICKS}곡까지 고를 수 있어요. 다른 곡을 먼저 빼 주세요.`);
        return;
      }
      next = [...selected, id];
    }
    setSelected(next);
    storageSet(draftKey(name), JSON.stringify(next));
  }

  async function submit() {
    if (!session || selected.length === 0) return;
    setSaving(true);
    try {
      await saveBallot(session.name, session.pin, selected);
      setSavedPicks(selected);
      storageRemove(draftKey(session.name));
      await reload();
      if (selected.length === MAX_PICKS) {
        setNotice(`${MAX_PICKS}곡 모두 제출했어요!`);
        setTab("results");
        window.scrollTo({ top: 0 });
      } else {
        setNotice(
          `${selected.length}곡을 제출했어요. 나머지 ${MAX_PICKS - selected.length}곡은 나중에 같은 이름과 비밀번호로 들어와서 골라도 돼요.`,
        );
      }
    } catch (e) {
      setNotice(
        e instanceof AuthError
          ? e.kind === "wrong"
            ? "제출하지 못했어요. 그 사이 다른 사람이 같은 이름으로 먼저 제출했을 수 있어요. 나가서 다른 이름으로 들어와 주세요."
            : e.message
          : "제출하지 못했어요: " + errorText(e),
      );
    } finally {
      setSaving(false);
    }
  }

  const visibleSongs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SONGS.filter((s) => {
      if (onlySelected && !selected.includes(s.id)) return false;
      if (!q) return true;
      return [s.title, s.artist, ...(s.aka ?? [])].join(" ").toLowerCase().includes(q);
    });
  }, [query, onlySelected, selected]);

  const ranking = useMemo(() => {
    const votes = new Map(results.tally.map((t) => [t.song_id, t.votes]));
    return SONGS.map((s, i) => ({ song: s, index: i, votes: votes.get(s.id) ?? 0 }))
      .filter((r) => r.votes > 0)
      .sort((a, b) => b.votes - a.votes || a.index - b.index);
  }, [results]);

  // 12위와 같은 표를 받은 곡까지는 모두 "선정권"으로 본다.
  const cutoff = ranking.length >= MAX_PICKS ? ranking[MAX_PICKS - 1].votes : 0;
  const topVotes = ranking[0]?.votes ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-8">
      <header className="mb-6">
        <h1>
          <Image
            src="/logo.png"
            alt="대외활동"
            width={640}
            height={252}
            preload
            className="logo h-auto w-44 sm:w-52"
          />
          <span className="mt-4 flex items-center gap-2 text-2xl font-bold">
            <span aria-hidden className="text-accent">✦</span>
            셋리스트 투표
          </span>
        </h1>
        <p className="mt-2 text-muted">
          후보곡 {SONGS.length}곡을 들어보고, 공연하고 싶은 곡을 <b className="text-fg">{MAX_PICKS}곡</b> 골라
          주세요. 한 번에 다 못 골라도 중간에 제출하고 나중에 이어서 고를 수 있어요.
        </p>
        {isDemoMode && (
          <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            데모 모드: 아직 서버(Supabase)가 연결되지 않아서 투표가 이 브라우저에만 저장돼요.
          </p>
        )}
        {loadError && (
          <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {loadError}
          </p>
        )}
      </header>

      <nav className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
        {(["vote", "results"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "results") void reload();
            }}
            className={`rounded-lg py-2 text-sm font-semibold transition ${
              tab === t ? "bg-accent text-on-accent" : "text-muted hover:text-fg"
            }`}
          >
            {t === "vote" ? "투표하기" : `결과 보기 (${results.participants}명 참여)`}
          </button>
        ))}
      </nav>

      {tab === "vote" && !name && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enter();
          }}
          className="rounded-2xl bg-surface p-6"
        >
          <p className="font-semibold">이름과 비밀번호를 입력해 주세요</p>
          <p className="mt-1 text-sm text-muted">
            처음이라면 지금 정한 비밀번호(숫자 4자리)가 등록돼요. 다음에 같은 이름과 비밀번호로 들어오면 내가
            고른 곡을 이어서 고르거나 수정할 수 있어요.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_9rem]">
            <label className="block">
              <span className="text-sm text-muted">이름</span>
              <input
                ref={nameRef}
                defaultValue={lastName}
                autoComplete="off"
                maxLength={20}
                placeholder="예: 홍길동"
                className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-sm text-muted">비밀번호 (숫자 4자리)</span>
              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="••••"
                onInput={(e) => {
                  e.currentTarget.value = e.currentTarget.value.replace(/[^0-9]/g, "");
                }}
                className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 tracking-[0.4em] outline-none focus:border-accent"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={entering}
            className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-on-accent disabled:opacity-50"
          >
            {entering ? "확인 중..." : "시작"}
          </button>
        </form>
      )}

      {tab === "vote" && name && (
        <section>
          <div className="mb-4 flex items-center justify-between gap-2">
            <p>
              <b>{name}</b>님 ·{" "}
              <span className="text-muted">
                {savedPicks ? `${savedPicks.length}/${MAX_PICKS}곡 제출됨` : "아직 제출 전"}
              </span>
            </p>
            <button onClick={leave} className="shrink-0 text-sm text-muted underline">
              나가기
            </button>
          </div>

          <div className="mb-3 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="곡 이름이나 아티스트 검색"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 outline-none focus:border-accent"
            />
            <button
              onClick={() => setOnlySelected((v) => !v)}
              className={`shrink-0 rounded-lg border px-3 text-sm ${
                onlySelected ? "border-accent text-accent" : "border-line text-muted"
              }`}
            >
              고른 곡만
            </button>
          </div>

          <ul className="space-y-2">
            {visibleSongs.map((s) => {
              const index = SONGS.indexOf(s);
              const isOn = selected.includes(s.id);
              const isPlaying = playing === s.id;
              return (
                <li
                  key={s.id}
                  className={`overflow-hidden rounded-xl border transition ${
                    isOn ? "border-accent bg-accent/10" : "border-line bg-surface"
                  }`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <button
                      onClick={() => toggle(s.id)}
                      aria-pressed={isOn}
                      aria-label={isOn ? "선택 취소" : "선택"}
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                        isOn ? "border-accent bg-accent text-on-accent" : "border-line"
                      }`}
                    >
                      {isOn ? "✓" : ""}
                    </button>
                    <button onClick={() => toggle(s.id)} className="min-w-0 flex-1 text-left">
                      <span className="mr-2 text-xs text-muted">{index + 1}</span>
                      <span className="font-semibold">{s.title}</span>
                      <span className="block truncate text-sm text-muted">{s.artist}</span>
                    </button>
                    {s.videoId && (
                      <button
                        onClick={() => setPlaying(isPlaying ? null : s.id)}
                        className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
                      >
                        {isPlaying ? "닫기" : "▶ 듣기"}
                      </button>
                    )}
                  </div>
                  {isPlaying && s.videoId && (
                    <div className="border-t border-line">
                      <iframe
                        className="aspect-video w-full"
                        src={`https://www.youtube-nocookie.com/embed/${s.videoId}?autoplay=1`}
                        title={s.videoTitle ?? s.title}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                      />
                      <a
                        href={`https://youtu.be/${s.videoId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate px-3 py-2 text-xs text-muted hover:text-fg"
                      >
                        유튜브에서 열기 · {s.videoTitle}
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
            {visibleSongs.length === 0 && (
              <li className="py-10 text-center text-muted">해당하는 곡이 없어요.</li>
            )}
          </ul>
        </section>
      )}

      {tab === "results" && (
        <section className="space-y-6">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-surface p-4">
              <p className="text-sm text-muted">제출한 사람</p>
              <p className="mt-1 text-2xl font-bold">{results.participants}명</p>
            </div>
            <div className="rounded-2xl bg-surface p-4">
              <p className="text-sm text-muted">{MAX_PICKS}곡 다 고른 사람</p>
              <p className="mt-1 text-2xl font-bold">{results.completed}명</p>
            </div>
            <p className="col-span-2 text-xs text-muted">
              누가 제출했는지, 누가 어떤 곡을 골랐는지는 공개되지 않고 곡별 표 수만 보여요.
            </p>
          </div>
          {results.participants === 0 && (
            <p className="py-6 text-center text-muted">아직 아무도 제출하지 않았어요.</p>
          )}

          {ranking.length > 0 && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-semibold">득표 순위</h2>
                <button onClick={() => void reload()} className="text-sm text-muted underline">
                  새로고침
                </button>
              </div>
              <ol className="space-y-2">
                {ranking.map((r, i) => {
                  const inTop = cutoff > 0 ? r.votes >= cutoff : i < MAX_PICKS;
                  const mine = savedPicks?.includes(r.song.id);
                  return (
                    <li
                      key={r.song.id}
                      className={`rounded-xl border p-3 ${
                        inTop ? "border-accent/60 bg-surface" : "border-line opacity-70"
                      }`}
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="w-6 shrink-0 text-right font-bold text-muted">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {r.song.title} <span className="font-normal text-muted">· {r.song.artist}</span>
                            {mine && (
                              <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                                내 선택
                              </span>
                            )}
                          </p>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${(r.votes / topVotes) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="shrink-0 font-bold">{r.votes}표</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-xs text-muted">
                테두리가 강조된 곡이 상위 {MAX_PICKS}곡이에요. {MAX_PICKS}위와 표가 같은 곡은 함께 표시돼요.
              </p>
            </div>
          )}
        </section>
      )}

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 top-4 z-20 mx-auto max-w-md rounded-xl bg-fg px-4 py-3 text-center text-sm text-bg shadow-lg"
        >
          {notice}
        </div>
      )}

      {tab === "vote" && name && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                <span className={selected.length === MAX_PICKS ? "text-accent" : ""}>{selected.length}</span>
                <span className="text-muted"> / {MAX_PICKS}곡 선택</span>
                <span className="ml-2 text-xs font-normal text-muted">
                  {savedPicks
                    ? dirty
                      ? "· 제출 안 한 변경 있음"
                      : "· 제출됨"
                    : "· 1곡 이상이면 제출할 수 있어요"}
                </span>
              </p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(selected.length / MAX_PICKS) * 100}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => void submit()}
              disabled={selected.length === 0 || !dirty || saving}
              className="shrink-0 rounded-lg bg-accent px-5 py-2.5 font-semibold text-on-accent disabled:opacity-40"
            >
              {saving ? "저장 중..." : !savedPicks ? "제출하기" : dirty ? "수정 제출" : "제출됨"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
