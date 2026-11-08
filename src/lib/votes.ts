import { createClient } from "@supabase/supabase-js";

export type SongTally = { song_id: string; votes: number };
/** 공개되는 결과. 참여자 이름은 포함하지 않는다. */
export type Results = { participants: number; completed: number; tally: SongTally[] };

/** 이름/비밀번호 확인에 실패했을 때. 화면에 그대로 보여줄 수 있는 문장을 담는다. */
export class AuthError extends Error {
  constructor(
    public kind: "wrong" | "locked" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const MAX_PICKS = 12;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Vercel의 Supabase 연동은 ANON_KEY 이름으로 넣어 주기도 해서 둘 다 받는다. (둘 다 브라우저에 공개되는 키)
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

// Supabase 환경변수가 없으면 이 브라우저의 localStorage에만 저장하는 데모 모드로 동작한다.
// 실제 모드에서는 테이블에 직접 접근하지 않고 supabase/schema.sql의 함수(RPC)만 호출한다.
// 그래야 비밀번호 확인이 서버에서 이뤄지고, 다른 사람이 고른 곡을 읽을 수 없다.
export const isDemoMode = !supabase;

type RpcResult = { status: string; song_ids?: string[]; retry_after?: number | null };

function authErrorFrom(r: RpcResult): AuthError {
  switch (r.status) {
    case "wrong":
      return new AuthError("wrong", "비밀번호가 맞지 않아요. 5번 틀리면 10분 동안 잠겨요.");
    case "locked": {
      const min = Math.max(1, Math.ceil((r.retry_after ?? 600) / 60));
      return new AuthError("locked", `비밀번호를 여러 번 틀려서 잠겼어요. ${min}분 뒤에 다시 시도해 주세요.`);
    }
    case "invalid_name":
      return new AuthError("invalid", "이름은 1~20자로 입력해 주세요.");
    case "invalid_pin":
      return new AuthError("invalid", "비밀번호는 숫자 4자리로 입력해 주세요.");
    case "invalid_songs":
      return new AuthError("invalid", `곡은 최대 ${MAX_PICKS}곡까지 고를 수 있고, 처음 제출할 때는 1곡 이상 골라 주세요.`);
    default:
      return new AuthError("invalid", "알 수 없는 응답이에요: " + r.status);
  }
}

// ---- 데모 모드 (localStorage) ----

type DemoBallot = { member: string; pin: string; song_ids: string[]; updated_at: string };
const DEMO_KEY = "daeoe-demo-ballots-v2";

function readDemo(): DemoBallot[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeDemo(list: DemoBallot[]) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(list));
  } catch {
    throw new Error("브라우저 저장소를 쓸 수 없어요.");
  }
}

// ---- 공개 API ----

export async function fetchResults(): Promise<Results> {
  if (!supabase) {
    const list = readDemo();
    const votes = new Map<string, number>();
    for (const b of list) for (const id of b.song_ids) votes.set(id, (votes.get(id) ?? 0) + 1);
    return {
      participants: list.filter((b) => b.song_ids.length > 0).length,
      completed: list.filter((b) => b.song_ids.length === MAX_PICKS).length,
      tally: [...votes].map(([song_id, n]) => ({ song_id, votes: n })),
    };
  }
  const [p, t] = await Promise.all([
    supabase.rpc("get_participant_stats").single<{ participants: number; completed: number }>(),
    supabase.rpc("get_tally"),
  ]);
  if (p.error) throw new Error(p.error.message);
  if (t.error) throw new Error(t.error.message);
  return {
    participants: p.data?.participants ?? 0,
    completed: p.data?.completed ?? 0,
    tally: (t.data as SongTally[] | null) ?? [],
  };
}

/** 이름과 비밀번호를 확인하고, 이미 제출한 곡 목록을 돌려준다. 처음 오는 이름이면 null. */
export async function loginBallot(member: string, pin: string): Promise<string[] | null> {
  if (!supabase) {
    const b = readDemo().find((x) => x.member === member);
    if (!b) return null;
    if (b.pin !== pin) throw authErrorFrom({ status: "wrong" });
    return b.song_ids;
  }
  const { data, error } = await supabase.rpc("login_ballot", { p_member: member, p_pin: pin });
  if (error) throw new Error(error.message);
  const r = data as RpcResult;
  if (r.status === "new") return null;
  if (r.status === "ok") return r.song_ids ?? [];
  throw authErrorFrom(r);
}

/** 처음 제출할 때 비밀번호가 등록되고, 이후에는 같은 비밀번호로만 수정할 수 있다. */
export async function saveBallot(member: string, pin: string, songIds: string[]): Promise<void> {
  if (!supabase) {
    const list = readDemo();
    const existing = list.find((b) => b.member === member);
    if (existing && existing.pin !== pin) throw authErrorFrom({ status: "wrong" });
    const row = { member, pin, song_ids: songIds, updated_at: new Date().toISOString() };
    writeDemo([...list.filter((b) => b.member !== member), row]);
    return;
  }
  const { data, error } = await supabase.rpc("save_ballot", {
    p_member: member,
    p_pin: pin,
    p_song_ids: songIds,
  });
  if (error) throw new Error(error.message);
  const r = data as RpcResult;
  if (r.status !== "ok") throw authErrorFrom(r);
}
