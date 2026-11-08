@AGENTS.md

# 대외활동 셋리스트 투표 (song-vote)

밴드 **"대외활동"**(멤버 전원 한국외대 출신이라 붙인 이름)이 공연할 곡을 고르는 투표 웹사이트.
멤버들이 낸 후보곡을 유튜브 공식 음원으로 들어보고, 각자 최대 12곡을 골라 투표한다.

- GitHub: https://github.com/s00ngle/daeoe-setlist (`main` push → Vercel 자동 배포)
- 사용법/배포 절차는 README.md 참고
- Vercel 프로젝트: `soongles-projects/daeoe-setlist` (Supabase 연동으로 환경변수 자동 등록, Production 환경만)
- Supabase 프로젝트: `qmehibjwglkrorcjyjzs` (ap-southeast-1). `supabase/schema.sql`을 SQL Editor에서 실행해 둠

## 요구사항 (사용자 결정 사항)

- 멤버 6명. 한 사람당 후보곡 중 **최대 12곡**. 12곡을 다 고르지 않아도(1곡 이상) 제출할 수 있다.
- 처음에 **이름 + 숫자 4자리 비밀번호**를 입력한다. 처음 제출할 때 비밀번호가 등록되고, 같은 이름/비밀번호로 다시 들어오면 제출한 곡을 불러와 이어서 고르거나 수정한다.
- **결과는 익명**: 곡별 득표수와 제출 인원수(12곡 완료 인원수)만 보여준다. 참여자 이름 목록도 보여주지 않는다 (먼저 제출한 사람의 선택을 유추할 수 있어서).
- 유튜브 링크는 **공식 음원**(라이브/방송/커버 X). "Provided to YouTube by"가 붙은 자동 생성 음원 영상을 우선 쓰고, 임베드 가능한지 확인한다.
- 아티스트 표기: 해외 아티스트는 원어(영어) 이름. 국내 아티스트는 한글 공식명. 다른 표기는 `aka`에 넣어 검색되게 한다.
- 디자인: 로고(`public/logo.png`) 색에 맞춘 **밝은 오프화이트 바탕 + 남색 글씨**. 어두운 남색 바탕은 눈이 아프다고 해서 다크 모드는 쓰지 않는다.
- UI 언어는 한국어.

## 기술 스택

| 역할 | 선택 |
|---|---|
| 프레임워크 | Next.js 16 (App Router, TypeScript, `src/` 구조) |
| 스타일 | Tailwind CSS v4, Pretendard 폰트 (CDN) |
| 투표 저장소 | Supabase (Postgres), `@supabase/supabase-js`, RPC 함수만 사용 |
| 배포 | Vercel |
| 유튜브 | `youtube-nocookie.com/embed/{videoId}` iframe, API 키 불필요 |

- Next.js 16은 예전 버전과 API가 다르다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 관련 문서를 먼저 확인한다 (예: `next/image`는 `priority` 대신 `preload`).

## 구조

- `src/app/page.tsx`: 화면 전체 (클라이언트 컴포넌트). 이름/비밀번호 입장 → 곡 목록(검색, 고른 곡만 보기, ▶ 듣기 임베드) → 하단 바에서 제출 / 결과 탭
- `src/lib/votes.ts`: `fetchResults`, `loginBallot`, `saveBallot`. Supabase 환경변수가 없으면 **데모 모드**(localStorage에만 저장)로 동작한다.
- `src/data/songs.json`: 곡 목록 (`id`, `title`, `artist`, `videoId`, `videoTitle`, `aka`)
- `supabase/schema.sql`: 테이블 + RPC 함수. 여러 번 실행해도 안전하다.
- `src/app/icon.png`(탭 아이콘), `src/app/opengraph-image.png`(링크 미리보기), `public/logo.png`(투명 배경 로고)

### 데이터 규칙
- **곡 ID** `s01`~`s48`은 투표 데이터가 참조하므로 **바꾸거나 재사용하지 않는다**. 새 곡은 `s49`부터.
- 이름은 앞뒤 공백 제거·연속 공백 1개로 정리, 1~20자. 이름이 곧 투표용지의 키다.
- localStorage: 마지막 이름(`daeoe-name`), 제출 전 선택(`daeoe-draft:<이름>`), 데모 투표(`daeoe-demo-ballots-v2`). 비밀번호는 저장하지 않는다(데모 모드 제외).

### Supabase 보안 설계
- `ballots(member pk, pin_hash, song_ids text[], failed_attempts, locked_until, updated_at)`
- RLS를 켜고 anon/authenticated의 테이블 권한을 모두 회수. 브라우저는 함수만 호출한다.
  - `get_participant_stats()` → 제출 인원수, 12곡 완료 인원수 (이름 없음)
  - `get_tally()` → 곡별 득표수
  - `login_ballot(member, pin)` → `{status: new|ok|wrong|locked|invalid_*, song_ids?, retry_after?}`
  - `save_ballot(member, pin, song_ids)` → `{status: ok|wrong|locked|invalid_*}`
- 비밀번호는 `pgcrypto`의 bcrypt(`crypt` + `gen_salt('bf')`)로만 저장. 5번 틀리면 10분 잠금.
- 함수는 예외를 던지지 않고 status JSON을 돌려준다 (예외를 던지면 실패 횟수 기록이 롤백되기 때문).
- 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(또는 Vercel 연동이 만드는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`). `.env*`는 커밋하지 않는다 (`.env.example`만 예외).

## 테스트

- `npx tsc --noEmit && npm run lint && npm run build`
- SQL 함수는 PGlite(+pgcrypto)로 검증했다: 테이블 직접 접근 차단, 비밀번호 확인, 곡 목록 검증, 잠금/해제, 결과 익명성, 해시 저장.
- 화면은 데모 모드로 브라우저에서 확인한다 (입장, 부분 제출, 틀린 비밀번호, 재입장 시 불러오기, 12곡 제한, 결과).

## 후보곡 정리 메모

- 원본은 멤버들에게 받은 목록 캡처 이미지다 (#3=#4, #5=#6 중복이라 실제 4장, 빠진 곡 없음).
- "Song 2 - U2"는 잘못 적은 것이라 "Song 2 - Blur" 한 곡으로 합쳤다 → 원본 49줄이 48곡.
- "파라솔 - 베개와 천장"은 밴드 **파라솔**의 곡 **베개와 천장**이다 (원본 표기는 곡/아티스트 순서가 반대처럼 보이지만 실제로는 아티스트가 파라솔).
- 원곡과 다른 버전을 고른 곡: 좋지 아니한가(크라잉넛 원곡 → 유다빈밴드 버전), 노래는 불빛처럼 달린다(페퍼톤스 원곡 → 유다빈밴드 버전), 만찬가(tuki. 원곡 → 태연 리메이크). 멤버가 적어낸 아티스트를 따랐다.

## 후보곡 (48곡)

| ID | 곡 | 아티스트 | 공식 음원 | 음원 정보 |
|---|---|---|---|---|
| s01 | Minority | Green Day | https://youtu.be/bVTaJ9sKa_Y | Minority (Warning, 2000) |
| s02 | I Remember You | Skid Row | https://youtu.be/w0sV8GDpJr8 | I Remember You (Skid Row, 1989) |
| s03 | Just Like Heaven | The Cure | https://youtu.be/JlFFdhXYwxo | Just Like Heaven (Kiss Me Kiss Me Kiss Me, 1987) |
| s04 | 재 | 한로로 | https://youtu.be/1r7YGKhctuM | Ashes (HOME, 2024) |
| s05 | 청록 | 이츠 | https://youtu.be/FG1mYbVByMA | Blue Rock (2023) |
| s06 | Happy Day | 체리필터 | https://youtu.be/6CFs-4if788 | Happy Day (Peace N' Rock N' Roll, 2006) |
| s07 | 前前前世 (Zenzenzense) | RADWIMPS | https://youtu.be/Mw66DyjQxBI | Zenzenzense (Original Version) (人間開花, 2016) |
| s08 | A Sky Full of Stars | Coldplay | https://youtu.be/KWuyx6yZ21U | A Sky Full of Stars (Ghost Stories, 2014) |
| s09 | Sparks Fly | Taylor Swift | https://youtu.be/i4opYYbyTKA | Sparks Fly (Speak Now, 2010) |
| s10 | 좋지 아니한가 | 유다빈밴드 | https://youtu.be/Z5sx7Zj5gKE | Isn't That Good? (GREAT SEOUL INVASION, 2022) |
| s11 | 축배 | 유다빈밴드 | https://youtu.be/OoSIy0dMV-A | SALUD! (CODA, 2025) |
| s12 | It's Not Living (If It's Not with You) | The 1975 | https://youtu.be/3bVJFgvUZHg | It's Not Living (If It's Not With You) (A Brief Inquiry Into Online Relationships, 2018) |
| s13 | PINKTOP | The Volunteers | https://youtu.be/FsJDnrY1Cuk | PINKTOP (The Volunteers, 2021) |
| s14 | 베개와 천장 | 파라솔 | https://youtu.be/87nxRT7fTdw | Pillow And Ceiling (2016) |
| s15 | Cherub Rock | The Smashing Pumpkins | https://youtu.be/6ywIjjj3YuA | Cherub Rock (Siamese Dream, 2011 Remaster) |
| s16 | 바이, 썸머 | 아이유 | https://youtu.be/AlNEtjBX1wU | Bye, Summer (2025) |
| s17 | Rock N Roll | Avril Lavigne | https://youtu.be/n-V1luBgA6A | Rock N Roll (Avril Lavigne, 2013) |
| s18 | Zombie | The Cranberries | https://youtu.be/yGxHDmHoqXc | Zombie (No Need To Argue, 1994) |
| s19 | 야경 | 터치드 | https://youtu.be/zEDWt602kgo | Night View (Yellow Supernova Remnant, 2023) |
| s20 | Brick by Boring Brick | Paramore | https://youtu.be/ZRJdVTXkdGI | Brick by Boring Brick (Brand New Eyes, 2009) |
| s21 | Kiss Me | Sixpence None the Richer | https://youtu.be/K2tbQ_g2VbQ | Kiss Me (1998) |
| s22 | 만찬가 | 태연 | https://youtu.be/UOKLtaE2U90 | Bansanka (J-POP REMAKE Vol.1, 2026) |
| s23 | 외쳐 사랑을! | 김수영 | https://youtu.be/vFkk31GES1A | Spark! (2026) |
| s24 | Sweet Child O' Mine | Guns N' Roses | https://youtu.be/oMfMUfgjiLg | Sweet Child O' Mine (Appetite For Destruction, 1987) |
| s25 | Find Me! | 더 폴스 | https://youtu.be/K_x9Vn5NxQw | Find Me! (2021) |
| s26 | 노래는 불빛처럼 달린다 | 유다빈밴드 | https://youtu.be/QTsCgsB4Ybw | Song Runs Like a Light (2024) |
| s27 | LETTER | 유다빈밴드 | https://youtu.be/AKOe_kCI-_I | LETTER (2021) |
| s28 | 고백 | 델리스파이스 | https://youtu.be/BYyVDi8BpZw | 고백 (Espresso, 2003) |
| s29 | 예감 좋은 날 | 럼블피쉬 | https://youtu.be/u86tEqfkN4E | 예감 좋은 날 (Swing Attack, 2004) |
| s30 | 관객이 될게 | 아이유 | https://youtu.be/_ZfT3M6ZKEM | I stan U (The Winning, 2024) |
| s31 | 그라데이션 | 10CM | https://youtu.be/e7_1cqOtVsc | Gradation (5.3, 2022) |
| s32 | 좋은 밤 좋은 꿈 | 너드커넥션 | https://youtu.be/XfzE8ku3TCI | Good Night Good Dream (2024) |
| s33 | 괜찮아 | 소란 | https://youtu.be/Ek3PoMbpjgw | Fine (2022) |
| s34 | 속삭여줘 (DANG!) | 소란 | https://youtu.be/hHkG5_ZNi_Q | DANG! (Feat. Mongja) (Beloved, 2021) |
| s35 | 부동의 첫사랑 | 10CM | https://youtu.be/2fEcDnYpOxs | My Ultimate First Love (5.4, 2023) |
| s36 | Good Morning Sunshine | 더 폴스 | https://youtu.be/HMOWoWerEgk | Good Morning Sunshine (2021) |
| s37 | Mr. Brightside | The Killers | https://youtu.be/m2zUrruKjDQ | Mr. Brightside (Hot Fuss, 2004) |
| s38 | Sugar, We're Goin Down | Fall Out Boy | https://youtu.be/_2eTNxPxXRc | Sugar, We're Goin Down (From Under The Cork Tree, 2005) |
| s39 | I Don't Love You | My Chemical Romance | https://youtu.be/urvSskm48eg | I Don't Love You (The Black Parade, 2006) |
| s40 | XXL | LANY | https://youtu.be/SUKKz2Kl8zQ | XXL (a beautiful blur, 2023) |
| s41 | What I've Done | Linkin Park | https://youtu.be/eXRWHzV72sU | What I've Done (Minutes to Midnight, 2007) |
| s42 | Song 2 | Blur | https://youtu.be/Bz4l9_bzfZM | Song 2 (Blur, 1997) |
| s43 | Up From the Bottom | Linkin Park | https://youtu.be/pl0qSJ9sdLI | Up From the Bottom (From Zero, 2025) |
| s44 | When It Rains | Paramore | https://youtu.be/lkRyI-c0qdM | When It Rains (Riot!, 2007) |
| s45 | Highway to Hell | AC/DC | https://youtu.be/ikFFVfObwss | Highway to Hell (Highway to Hell, 1979) |
| s46 | Bite Me | Avril Lavigne | https://youtu.be/h5I774U_s2I | Bite Me (Love Sux, 2022) |
| s47 | Don't Stop Believin' | Journey | https://youtu.be/HNtlPdWoHe8 | Don't Stop Believin' (Escape, 1981) |
| s48 | 민수는 혼란스럽다 | 민수 | https://youtu.be/hq7uG0EwYOg | 민수는 혼란스럽다 (2019) |
