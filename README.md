# 대외활동 셋리스트 투표

밴드 **대외활동**이 공연할 곡을 고르는 투표 사이트입니다.
후보곡을 유튜브 공식 음원으로 들어보고, 한 사람당 최대 12곡을 골라 투표합니다.

## 기능

- 후보곡 48곡 목록, 곡마다 페이지 안에서 바로 재생 (유튜브 공식 음원)
- 이름 + 숫자 4자리 비밀번호로 입장 (처음 제출할 때 비밀번호가 등록됨)
- 12곡을 다 고르지 않아도 제출 가능, 같은 이름/비밀번호로 다시 들어와 이어서 고르거나 수정 (모두 빼고 0곡으로 저장도 가능)
- 결과: 곡별 득표수와 제출 인원수만 공개 (누가 투표했는지, 누가 어떤 곡을 골랐는지는 비공개)
- 비밀번호를 5번 틀리면 10분 동안 잠금
- 밝은 테마 / 다크 테마 선택 (선택은 브라우저에 기억)
- Supabase 설정이 없으면 브라우저에만 저장하는 데모 모드로 동작

## 기술 스택

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (Postgres) · Vercel

## 로컬 실행

```bash
npm install
npm run dev   # http://localhost:3000
```

`.env.local`이 없으면 데모 모드로 실행됩니다.

## Supabase 연결

1. [supabase.com](https://supabase.com)에서 프로젝트를 만듭니다.
2. **SQL Editor**에 `supabase/schema.sql` 전체를 붙여넣고 실행합니다. (여러 번 실행해도 안전합니다)
3. **Project Settings → API**에서 Project URL과 publishable(anon) key를 복사합니다.
4. `.env.example`을 `.env.local`로 복사하고 값을 채웁니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

publishable(anon) key는 브라우저에 공개되는 키입니다. 브라우저는 테이블에 직접 접근할 수 없고
`schema.sql`에 정의된 함수만 호출할 수 있어서, 비밀번호 해시와 개인별 선택은 밖으로 나가지 않습니다.

## Vercel 배포

1. [vercel.com/new](https://vercel.com/new)에서 이 GitHub 레포를 가져옵니다.
2. **Environment Variables**에 위의 두 값을 넣고 배포합니다.
   (Vercel의 Supabase 연동을 쓰면 `NEXT_PUBLIC_SUPABASE_ANON_KEY`로 자동 등록되는데, 이 이름도 인식합니다)
3. 이후 `main` 브랜치에 push하면 자동으로 다시 배포됩니다.

## 곡 목록 수정

`src/data/songs.json`을 고칩니다.

- `id`는 투표 데이터가 참조하므로 **이미 있는 ID는 바꾸거나 재사용하지 마세요.** 새 곡은 `s49`부터 붙입니다.
- `videoId`는 유튜브 영상 ID입니다 (`https://youtu.be/<videoId>`).
- `aka`는 검색용 다른 표기입니다 (예: 해외 아티스트의 한글 이름).

## 투표 초기화

Supabase SQL Editor에서 실행합니다.

```sql
truncate public.ballots;                                  -- 전체 초기화
delete from public.ballots where member = '이름';           -- 한 사람만 삭제 (비밀번호를 잊었을 때)
update public.ballots set failed_attempts = 0, locked_until = null where member = '이름';  -- 잠금 해제
```
