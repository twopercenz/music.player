# music player

기능은 심플하게, UI는 화려하게. 개인용 뮤직 플레이어.

## 어떻게 동작하나

- **검색 & 재생**: 검색은 Apple의 iTunes Search API(무료, 인증 불필요)로 한다 — 깨끗한
  제목/아티스트 메타데이터와 정사각 앨범 아트를 그대로 얻는다. 검색 결과를 누르면
  `/api/resolve`가 YouTube Data API로 실제 재생할 영상을 매칭한다(제목 키워드 + 재생시간
  근접도 스코어링) — 검색과 재생은 별도 소스라 이 매칭 단계가 항상 낀다. 매칭된 영상은
  `/api/extract`가 [Invidious Companion](https://github.com/iv-org/invidious-companion)에게
  넘겨서(`lib/companion.ts`) 실제 오디오 스트림 URL을 받아 그대로 프록시한다 — 예전엔 이걸
  서버에서 `yt-dlp` + `ffmpeg`로 직접 추출했지만, YouTube의 봇 감지("Sign in to confirm
  you're not a bot")가 갈수록 심해져서 별도 서비스(PO 토큰 발급을 전담하는)로 옮겼다.
  Companion이 이미 Range 요청을 지원하는 스트림을 주기 때문에 캐시 히트가 아니어도 첫
  재생부터 탐색(seek)이 가능하다. 클라이언트는 받은 오디오를 브라우저 IndexedDB에도
  캐싱한다(재생할 때마다 다시 받지 않도록).
  - (원래는 Spotify로 검색했는데, 2026년 3월부터 Spotify Developer Mode가 개발자 계정에
    Premium 구독을 요구하게 되면서 iTunes Search API로 옮겼음.)
- **로컬 업로드**: 내 파일을 직접 추가할 수도 있음 — 이것도 IndexedDB에만 저장, 기기별로 로컬.
- **가사**: [lrclib.net](https://lrclib.net) (무료, 인증 불필요, 싱크 가사 API). 제목/아티스트는
  위 iTunes 메타데이터를 그대로 쓰므로 대체로 정확하게 찾지만, lrclib 쪽에 그 곡이 아예
  없거나 싱크 가사가 없는 경우는 있음 — 그 경우 자동으로 비주얼라이저만 표시됨.
- **라이브러리 동기화**: 검색해서 저장한 곡의 메타데이터(제목/아티스트/영상 ID)만 Supabase에
  저장해서 여러 기기에서 공유. 로컬 업로드는 기기별로만 보임 (실제 파일이 그 기기에만 있어서
  동기화해봐야 재생이 안 되므로).
- **접근 제어**: 계정 없음 — 미들웨어가 걸어놓은 비밀번호 하나로 전체 게이트.

전체 설계 배경(왜 처음엔 Spotify+YouTube였는지, 왜 Vercel이 아니라 Docker로 배포하는지, 비용을
어떻게 $0으로 맞췄는지 등)은 이 프로젝트를 만들 때 나눈 대화에 정리되어 있음.

## 로컬에서 돌리기

이제 컨테이너 두 개(앱 + Invidious Companion)가 필요해서 `docker compose`로 돌리는 게 제일 간단함:

```bash
cp .env.example .env   # 값 채우기 (아래 "필요한 키" 참고)
docker compose up --build
```

`bun dev`로 앱만 따로 띄워서 프론트를 작업할 수도 있지만, 그 경우 Invidious Companion을
별도로 띄우고(`docker run`이든 로컬 Deno든) `.env.local`의 `COMPANION_URL`을 거기로 맞춰야
`/api/extract`가 동작함.

```bash
bun install
cp .env.example .env.local
bun dev
```

### Invidious Companion이란

`/api/extract`가 YouTube 오디오를 실제로 가져오는 부분을 담당하는 별도 서비스
([레포](https://github.com/iv-org/invidious-companion),
[위키](https://github.com/iv-org/invidious-companion/wiki)). 예전엔 서버에서 직접
`yt-dlp` + `ffmpeg`를 돌렸는데, YouTube의 "Sign in to confirm you're not a bot" 감지가
갈수록 강해져서 — 특히 클라우드 서버 IP에서 — 쿠키를 넘겨도 한계가 있었음. Companion은 PO
토큰 발급을 전담하는 백그라운드 잡을 돌려서 이 문제를 해결하고, 오디오 스트림 자체도 자기
서버를 통해 프록시해준다(`local=true`) — 그래서 `COMPANION_SECRET_KEY`(정확히 16자리
영숫자, `docker-compose.yml`의 `invidious_companion` 서비스가 검증하는 값과 동일해야 함)만
있으면 됨. `openssl rand -hex 8`로 하나 만들면 됨.

**주의**: PO 토큰 발급 자체도 결국 YouTube에 요청을 보내는 과정이라, Companion을 돌리는
서버의 IP가 이미 강하게 차단된 클라우드 대역이면 발급이 계속 실패할 수 있음(컨테이너 로그에
`Failed to validate PO token: all validation attempts returned non-200 status codes`가
반복됨 — 그동안 `/api/extract`는 "재생 서버가 아직 준비 중입니다" 에러를 돌려줌). 이 경우
Companion의 `PROXY` 환경변수 외엔 뾰족한 수가 없음 — 배포 전에 실제 환경에서 한 번 확인해볼 것.

**PROXY 설정법**: [config.ts](https://github.com/iv-org/invidious-companion/blob/master/src/lib/helpers/config.ts)가
`PROXY` 환경변수를 읽어서 `getFetchClient`로 넘기는데, 이게 PO 토큰 발급뿐 아니라
`videoPlaybackProxy.ts`의 실제 오디오 바이트 요청(googlevideo.com)에도 그대로 쓰임 — 즉 재생하는
곡의 트래픽이 전부 이 프록시를 통과함(대역폭 비례 비용 발생, 데이터센터 프록시는 이 서버 IP와
똑같이 막히니 무의미 — **주거용(residential) 프록시**여야 함).

1. 프록시 서비스 가입 — 구독 없이 트래픽만큼만 내는 곳이 이 프로젝트 용도(개인, 저사용량)에
   맞음. 예: [DataImpulse](https://dataimpulse.com)(5GB $5, GB당 $1, 미사용분 만료 없음),
   [IPRoyal](https://iproyal.com)(1GB $7 정도부터, 미사용분 만료 없음). 5GB면 대략 곡 1000개
   분량(곡 하나 ≈ 4-5MB) — 개인용으로는 한 번 사면 오래감.
2. 발급받은 `호스트:포트`, `유저:비번`으로 아래 형식 조합:
   `http://<user>:<pass>@<host>:<port>`
3. Render 대시보드 → `invidious-companion` 서비스 → **Environment** 탭 → 환경변수 추가:
   `PROXY` = 위에서 만든 URL. 저장하면 자동 재배포됨(`render.yaml`엔 안 넣음 — 필요한 사람만
   쓰는 옵션이라 Blueprint 필드로 강제하지 않음, 수동으로 추가해도 다음 Blueprint sync 때
   유지됨).
4. 재배포 후 로그에서 PO 토큰 발급 에러가 사라졌는지, 실제 재생이 되는지 확인.

## 필요한 키

`.env.example` 참고. 요약하면:

| 키 | 어디서 발급 |
|---|---|
| `SITE_PASSWORD` | 직접 정하기 |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `COMPANION_SECRET_KEY` | `openssl rand -hex 8` (16자리 영숫자) — 위 "Invidious Companion이란" 참고 |
| `YOUTUBE_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (YouTube Data API v3 활성화) |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | [Supabase 대시보드](https://supabase.com/dashboard), 무료 티어. Settings > API Keys에서 **secret key**(`sb_secret_...`, 구 service_role) 사용 — publishable key 아님. `supabase/schema.sql`을 SQL 에디터에서 한 번 실행 |

Spotify 키는 필요 없습니다 (검색도 YouTube로 통합됨).

## 배포 (Vercel + Render, 둘 다 무료 티어)

시도했던 다른 조합들은 다 이 구조(앱 + 상시 실행되는 Companion 서비스)의 무료 티어에서
막혔음: Render의 무료 Private Service는 내부 DNS가 안 붙었고(`getaddrinfo ENOTFOUND`), Koyeb은
무료 인스턴스가 조직당 1개뿐이고 그 인스턴스는 서비스 메시에서 아예 빠짐. 게다가 Koyeb은 2026년
2월 Mistral AI에 인수된 뒤로 신규 가입 시 무료 Starter 플랜 자체가 막힘(Pro $29/월부터).

그런데 애초에 Vercel을 배제했던 이유("상시 실행되는 Companion")는 **Companion에만 해당**하지
이 Next.js 앱 자체엔 해당 안 됨 — `/api/extract`(`app/api/extract/route.ts`)는 Companion이 준
오디오 바이트를 그대로 스트리밍으로 흘려보내기만 함(`new Response(upstream.body, ...)`). Vercel
Functions는 스트리밍 응답엔 4.5MB 바디 제한이 안 걸리고, Fluid Compute 켜진 Hobby(무료) 플랜
기준 실행시간도 기본 300초까지라 오디오 프록시 정도는 충분함. 그래서:

- **Vercel**(무료) — 이 앱 전체(로그인 게이트, `/api/extract` 프록시 포함). 서버리스라 별도
  컨테이너 운영 부담이 없음.
- **Render**(무료 Web Service, **Public** — Private 아님) — `invidious_companion` 이미지
  하나만. `COMPANION_SECRET_KEY` Bearer 토큰으로 막혀 있으니 공개 URL이어도 안전함 — 이전에
  막혔던 건 Private Service 쪽 내부 DNS 문제였지, 공개 자체가 문제였던 게 아니었음.

배포 순서:

1. Render 대시보드에서 **New > Blueprint** → 이 저장소 선택. 저장소 루트의 `render.yaml`을
   읽어서 Companion 서비스를 자동으로 만듦 — `SERVER_SECRET_KEY` 값만 물어봄(16자리 영숫자).
   배포되면 `https://<name>.onrender.com` 같은 공개 URL이 생김.
2. Vercel에서 이 저장소 Import → 위 표의 환경변수들 + `COMPANION_URL`을 방금 생긴 Render URL로
   등록(끝에 `/` 없이), `COMPANION_SECRET_KEY`는 1번의 `SERVER_SECRET_KEY`와 동일한 값으로.
   Deploy.
3. 무료 티어라 둘 다 슬립함: Render는 15분 미접속시(다음 요청에 콜드스타트 ~1분), Vercel 함수는
   기본적으로 슬립은 없지만 Companion이 슬립 중이면 첫 재생 요청이 그만큼 오래 걸림 — 개인용
   앱이라 감수.
4. 배포 후 반드시 실제로 한 곡 재생해서 아래 "주의" 항목(PO 토큰 발급 실패)이 없는지 확인할
   것 — Render의 IP 대역도 차단 목록에 있을 가능성이 있음.

로컬 개발은 여전히 `docker compose up --build`(위 "로컬에서 돌리기" 참고) — 이건 배포 방식과
무관하게 그대로 씀.

## 참고: 법적 유의사항

YouTube에서 오디오를 추출하는 건 YouTube 이용약관 위반입니다. 이 프로젝트는 개인
전용(비밀번호 게이트)으로 설계되었고, 그걸 전제로 감수하기로 한 리스크입니다 — 공개
서비스로 운영할 목적이 아닙니다.
