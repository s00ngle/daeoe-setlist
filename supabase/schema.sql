-- Supabase 대시보드 > SQL Editor에 붙여넣고 실행하세요. (여러 번 실행해도 됩니다)
--
-- 브라우저(anon 키)는 ballots 테이블을 직접 읽거나 쓸 수 없고, 아래 함수만 호출할 수 있다.
-- - 비밀번호는 bcrypt 해시로만 저장하고, 확인도 함수 안에서만 한다.
-- - 비밀번호를 5번 틀리면 그 이름은 10분 동안 잠긴다 (4자리 비밀번호 무차별 대입 방지).
-- - 결과는 곡별 득표수와 제출 인원수만 공개한다 (참여자 이름, 누가 어떤 곡을 골랐는지는 비공개).
--
-- 함수는 오류를 던지지 않고 {"status": ...} JSON을 돌려준다.
-- 오류를 던지면 실패 횟수 기록까지 롤백되기 때문이다.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ballots (
  member          text primary key check (char_length(member) between 1 and 20 and member = btrim(member)),
  pin_hash        text not null,
  song_ids        text[] not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

-- 곡 수 제약: 0~12곡 (0곡 = 제출했다가 모두 뺀 상태. 이름/비밀번호 등록은 유지된다)
-- 예전 버전(1~12곡)으로 만든 테이블도 이 두 줄로 바뀐다.
alter table public.ballots drop constraint if exists ballots_song_ids_check;
alter table public.ballots add constraint ballots_song_ids_check check (cardinality(song_ids) between 0 and 12);

alter table public.ballots enable row level security;
revoke all on public.ballots from anon, authenticated;

-- 제출 인원수(1곡 이상 고른 사람)와 12곡을 다 고른 인원수
create or replace function public.get_participant_stats()
returns table (participants int, completed int)
language sql stable security definer set search_path = public
as $$
  select (count(*) filter (where cardinality(song_ids) > 0))::int,
         (count(*) filter (where cardinality(song_ids) = 12))::int
  from ballots;
$$;

-- 곡별 득표수
create or replace function public.get_tally()
returns table (song_id text, votes int)
language sql stable security definer set search_path = public
as $$
  select s.song_id, count(*)::int from ballots b, unnest(b.song_ids) as s(song_id) group by s.song_id;
$$;

-- 내부용: 비밀번호 확인 + 실패 횟수/잠금 처리. 'ok' | 'wrong' | 'locked'
create or replace function public._check_pin(p_member text, p_pin text, out status text, out retry_after int)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  b ballots;
begin
  select * into b from ballots where member = p_member for update;
  if b.locked_until is not null and b.locked_until > now() then
    status := 'locked';
    retry_after := ceil(extract(epoch from b.locked_until - now()))::int;
    return;
  end if;
  if b.pin_hash = crypt(p_pin, b.pin_hash) then
    if b.failed_attempts > 0 or b.locked_until is not null then
      update ballots set failed_attempts = 0, locked_until = null where member = p_member;
    end if;
    status := 'ok';
    return;
  end if;
  if b.failed_attempts + 1 >= 5 then
    update ballots set failed_attempts = 0, locked_until = now() + interval '10 minutes' where member = p_member;
  else
    update ballots set failed_attempts = b.failed_attempts + 1 where member = p_member;
  end if;
  status := 'wrong';
end;
$$;

revoke all on function public._check_pin(text, text) from public, anon, authenticated;

-- 입장: 이름 + 비밀번호 확인
-- {"status":"new"} 처음 오는 이름 / {"status":"ok","song_ids":[...]} / {"status":"wrong"} / {"status":"locked","retry_after":초}
create or replace function public.login_ballot(p_member text, p_pin text)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  c record;
begin
  if p_member is null or p_member <> btrim(p_member) or char_length(p_member) not between 1 and 20 then
    return json_build_object('status', 'invalid_name');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return json_build_object('status', 'invalid_pin');
  end if;
  if not exists (select 1 from ballots where member = p_member) then
    return json_build_object('status', 'new');
  end if;
  c := _check_pin(p_member, p_pin);
  if c.status <> 'ok' then
    return json_build_object('status', c.status, 'retry_after', c.retry_after);
  end if;
  return json_build_object('status', 'ok', 'song_ids', (select song_ids from ballots where member = p_member));
end;
$$;

-- 제출/수정: 처음 제출할 때 비밀번호가 등록되고, 이후에는 같은 비밀번호로만 수정된다.
-- {"status":"ok"} / {"status":"wrong"} / {"status":"locked","retry_after":초} / invalid_*
create or replace function public.save_ballot(p_member text, p_pin text, p_song_ids text[])
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  c record;
begin
  if p_member is null or p_member <> btrim(p_member) or char_length(p_member) not between 1 and 20 then
    return json_build_object('status', 'invalid_name');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return json_build_object('status', 'invalid_pin');
  end if;
  if p_song_ids is null
     or cardinality(p_song_ids) not between 0 and 12
     or exists (select 1 from unnest(p_song_ids) x where x is null or x !~ '^s[0-9]{2,3}$')
     or (select count(distinct x) from unnest(p_song_ids) x) <> cardinality(p_song_ids) then
    return json_build_object('status', 'invalid_songs');
  end if;

  if exists (select 1 from ballots where member = p_member) then
    c := _check_pin(p_member, p_pin);
    if c.status <> 'ok' then
      return json_build_object('status', c.status, 'retry_after', c.retry_after);
    end if;
    update ballots set song_ids = p_song_ids, updated_at = now() where member = p_member;
    return json_build_object('status', 'ok');
  end if;

  -- 처음 제출하는데 0곡이면 저장할 게 없다
  if cardinality(p_song_ids) = 0 then
    return json_build_object('status', 'invalid_songs');
  end if;

  insert into ballots (member, pin_hash, song_ids)
  values (p_member, crypt(p_pin, gen_salt('bf')), p_song_ids)
  on conflict (member) do nothing;
  if not found then
    -- 같은 이름이 거의 동시에 먼저 등록된 경우
    return json_build_object('status', 'wrong');
  end if;
  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.get_participant_stats() to anon;
grant execute on function public.get_tally() to anon;
grant execute on function public.login_ballot(text, text) to anon;
grant execute on function public.save_ballot(text, text, text[]) to anon;
