# music player

기능은 심플하게, UI는 화려하게. 개인용 뮤직 플레이어.

## 어떻게 동작하나

- **검색 & 재생**: 검색은 Apple의 iTunes Search API(무료, 인증 불필요)로 한다 — 깨끗한
  제목/아티스트 메타데이터와 정사각 앨범 아트를 그대로 얻는다. 검색 결과를 누르면
  `/api/resolve`가 YouTube Data API로 실제 재생할 영상을 매칭한다(제목 키워드 + 재생시간
  근접도 스코어링) — 검색과 재생은 별도 소스라 이 매칭 단계가 항상 낀다. 실제 오디오
  스트림을 얻는 덴 두 경로가 있음(`lib/resolve-audio.ts`):
  1. **[브라우저 확장 프로그램](extension/)** (`lib/extension-bridge.ts`) — 설치돼 있으면
     우선 사용. 사용자 브라우저가 직접 실제 `youtube.com/watch` 탭을 열어서 재생 URL을
     읽어옴 — 서버가 전혀 안 끼니까 YouTube 봇 차단(클라우드 IP 차단)이 애초에 적용 안 됨.
  2. **`/api/extract`** → [Invidious Companion](https://github.com/iv-org/invidious-companion)
     (`lib/companion.ts`) — 확장 프로그램이 없거나 특정 영상에서 실패했을 때의 폴백. 예전엔
     서버에서 `yt-dlp` + `ffmpeg`로 직접 추출했지만, YouTube의 봇 감지("Sign in to confirm
     you're not a bot")가 갈수록 심해져서 별도 서비스(PO 토큰 발급을 전담하는)로 옮겼다 —
     근데 이것도 결국 서버 IP로 YouTube에 요청하는 거라 클라우드에 올리면 막힘. 자세한 배경은
     아래 "Invidious Companion이란" 참고.

  둘 다 Range 요청을 지원하는 스트림을 주기 때문에 캐시 히트가 아니어도 첫 재생부터 탐색(seek)이
  가능하다. 클라이언트는 받은 오디오를 브라우저 IndexedDB에도 캐싱한다(재생할 때마다 다시 받지
  않도록) — 단, 확장 프로그램이 준 URL은 CORS 때문에 캐싱을 못 함, 재생 자체는 됨(아래
  `extension/` 참고).
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

### 브라우저 확장 프로그램 (`extension/`)

`chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → `extension/` 폴더
선택. 자세한 건 [extension/README.md](extension/README.md) 참고. 설치해두면 재생이 이 확장을
우선 쓰고, 없거나 실패하면 자동으로 아래 Companion 경로로 폴백함 — 둘 다 굳이 준비 안 해도 됨,
확장 하나만 설치해도 로컬 개발에 충분함(Companion 컨테이너/`.env`의 `COMPANION_*` 값 없이도
재생 가능).

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
`Failed to validate PO token: all validation attempts returned non-200 status codes`, 또는
Google 엣지 자체 차단이면 `youtubei/v1/player`가 403 `Sorry... automated queries` HTML을
반환 — 실제로 Render Public Web Service와 이 Codespace(Azure) 양쪽에서 겪음). 이건 토큰
내용 문제가 아니라 IP 평판 문제라 클라이언트 종류나 재시도로는 안 풀림 — 그래서 위 "배포"
섹션의 기본 경로는 아예 [브라우저 확장 프로그램](extension/)을 씀(서버가 안 끼니까 이 문제
자체가 없음). 그래도 `/api/extract` 폴백을 살리고 싶으면 아래 두 방법 중 하나:

**집에서 Companion 돌리기** (무료, 24시간 켜둘 기기가 있을 때): 집 인터넷 IP는 진짜
주거용이라 애초에 차단 대역이 아님.
```bash
docker run -d --name invidious_companion \
  -p 8282:8282 \
  -e SERVER_SECRET_KEY=<COMPANION_SECRET_KEY와 동일한 값> \
  -v invidious_companion_cache:/var/tmp \
  --restart unless-stopped \
  quay.io/invidious/invidious-companion:2026.09.05-6386b18
```
[Tailscale](https://tailscale.com/download) 설치 → 같은 기기에서
```bash
tailscale funnel --bg --https=443 localhost:8282
```
(처음 실행 시 admin console에서 Funnel 정책 승인 링크가 뜸) → `tailscale funnel status`로
나온 `https://<기기이름>.<tailnet이름>.ts.net`을 `COMPANION_URL`로.

**PROXY 설정법** (클라우드에 올릴 경우): [config.ts](https://github.com/iv-org/invidious-companion/blob/master/src/lib/helpers/config.ts)가
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
3. 쓰는 호스팅의 Companion 서비스 환경변수에 `PROXY` = 위에서 만든 URL로 등록, 재배포.
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

## 배포 (Vercel만, 완전 무료)

시도했던 클라우드 Companion 호스팅 조합들은 전부 막혔음:

- **서비스 두 개를 무료로 같이 못 띄움** — Render 무료 Private Service는 내부 DNS가 안
  붙었고(`getaddrinfo ENOTFOUND`), Koyeb 무료 인스턴스는 조직당 1개뿐이고 서비스 메시에서
  아예 빠짐(게다가 2026년 2월 Mistral AI 인수 이후 신규 가입은 무료 Starter 플랜 자체가 막힘).
- **떴다 해도 IP가 막힘** — Render의 Public Web Service로 Companion을 띄웠더니 PO 토큰
  발급 요청 자체가 Google 엣지에서 403 `Sorry... automated queries`로 막힘 — IP 평판 문제라
  토큰/클라이언트 종류를 바꿔도 안 풀림. 이건 Codespace(Azure)에서도 똑같이 재현됨 — 클라우드
  데이터센터 IP는 어디든 거의 다 이 대역에 걸림.

그런데 애초에 서버가 YouTube에 요청을 안 보내면 이 문제 자체가 없어짐 —
**[브라우저 확장 프로그램](extension/)** 이 그 역할을 함: 사용자 브라우저가 직접
`youtube.com/watch` 탭을 열어서 재생 URL을 읽어옴(자기 자신의 진짜 주거용 IP, 진짜 로그인
세션으로). 그래서 배포는 그냥:

- **Vercel**(무료) — 이 앱 전체. Vercel을 원래 배제했던 이유("상시 실행되는 Companion
  필요")는 서버 쪽 얘기였고, 이제 기본 경로는 서버가 아예 안 낌. (참고로 `/api/extract`
  폴백 경로만 보면 이 이유도 사실 틀렸음 — 스트리밍 응답이라 Vercel의 4.5MB 바디 제한도 안
  걸리고 Fluid Compute Hobby 기준 실행시간 300초라 오디오 프록시 정도는 충분함. 자세한 건
  아래 "Invidious Companion이란" 참고.)
- **Companion 서버는 아예 안 띄움** — 확장 프로그램이 기본 경로, `/api/extract`는 확장이
  없거나 실패했을 때 폴백일 뿐이라 없어도 배포/재생 자체는 됨(그 폴백만 못 씀).

배포 순서:

1. Vercel에서 이 저장소 Import → 아래 표의 환경변수들 등록(`COMPANION_SECRET_KEY`/
   `COMPANION_URL`은 폴백을 안 쓸 거면 아무 값이나 넣어도 됨 — `lib/companion.ts`가 값
   존재만 확인함). Deploy.
2. 실제로 쓸 브라우저에 [extension/](extension/) 설치([extension/README.md](extension/README.md)
   참고) — Chromium 계열(Chrome/Edge/Brave)만 지원.
3. 배포된 URL 접속 → 로그인 → 재생 테스트.

확장 프로그램은 그 브라우저가 열려 있을 때만 필요함(백그라운드 서버가 아니라 요청 시점에
관여) — 매번 켜둘 필요 없이, 그냥 그 브라우저로 앱을 쓸 때만 설치돼 있으면 됨.

**폴백(`/api/extract`)을 굳이 살리고 싶으면**(다른 브라우저에서도 쓰고 싶다든가): 위쪽
"Invidious Companion이란" 항목의 **PROXY 설정법**(유료 주거용 프록시, ~$5) 또는 집 기기에
Companion을 띄우고 [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)로 노출하는
방법을 참고 — 둘 다 `COMPANION_URL`을 그 주소로만 바꾸면 됨.

로컬 개발은 여전히 `docker compose up --build`(위 "로컬에서 돌리기" 참고) — 이건 배포 방식과
무관하게 그대로 씀.

## 참고: 법적 유의사항

YouTube에서 오디오를 추출하는 건 YouTube 이용약관 위반입니다. 이 프로젝트는 개인
전용(비밀번호 게이트)으로 설계되었고, 그걸 전제로 감수하기로 한 리스크입니다 — 공개
서비스로 운영할 목적이 아닙니다.
