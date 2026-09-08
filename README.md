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
Companion의 `PROXY` 환경변수([config.ts](https://github.com/iv-org/invidious-companion/blob/master/src/lib/helpers/config.ts)
참고)로 주거용 IP 프록시를 태우는 것 외엔 뾰족한 수가 없음 — 배포 전에 실제 환경에서 한 번
확인해볼 것.

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

## 배포 (Koyeb, 무료 티어)

Vercel 서버리스 함수는 이 구조(상시 실행되는 Companion 서비스)에 적합하지 않고, Render는 무료
Private Service 간 내부 DNS가 이 구조에서 제대로 안 붙어서 포기함(`getaddrinfo ENOTFOUND`).
Koyeb 무료 티어는 조직당 인스턴스 1개만 허용하고 그 인스턴스는 서비스 메시(내부 네트워킹)에서
아예 제외되기 때문에, "서비스 두 개를 따로 배포"하는 방식 자체가 무료로는 안 됨.

대신 **컨테이너 하나 안에서 `docker compose up`을 그대로 돌리는 트릭**을 씀
([koyeb/docker-compose](https://github.com/koyeb/koyeb-docker-compose)) — Koyeb 인스턴스
안에 privileged 모드로 Docker 데몬을 띄우고 그 안에서 web + invidious_companion 두 컨테이너를
평소처럼 compose 네트워킹으로 붙임. 관련 파일:

- `Dockerfile.koyeb` — Koyeb가 실제로 빌드하는 이미지. `docker compose up`만 실행.
- `docker-compose.koyeb.yml` — 로컬용 `docker-compose.yml`과 달리 `web`을 `build: .`가 아니라
  프리빌드된 이미지를 pull(무료 인스턴스는 512MB RAM / 0.1 vCPU라 콜드스타트마다
  `next build`를 돌릴 여유가 없음), `.env` 파일 대신 Koyeb 서비스 환경변수로 치환.
- `.github/workflows/build-web-image.yml` — `main`에 push될 때마다 앱 이미지를 빌드해서
  GHCR(`ghcr.io/<owner>/<repo>`)에 푸시.

배포 순서:

1. `main`에 한 번 push해서 GitHub Actions가 GHCR에 이미지를 만들게 함. 그 다음 GitHub 저장소
   Packages 탭에서 그 패키지를 **Public**으로 바꿔둠(이미지에 비밀값은 안 들어있음 — 소스만
   빌드된 결과물) — Koyeb가 별도 registry 인증 없이 바로 pull할 수 있게.
2. Koyeb에서 Service 하나 생성: 이 저장소 연결, Dockerfile 빌더, 경로 `Dockerfile.koyeb`,
   **Privileged 플래그 켜기**, 포트 `3000` 노출, 헬스체크 경로는 `/login`(비로그인으로도
   200 응답).
3. 그 Service에 환경변수로 위 표의 값들 + `WEB_IMAGE=ghcr.io/<owner>/<repo>:latest`를 등록.
   `COMPANION_SECRET_KEY`는 앱과 Companion이 같은 compose 안에서 같은 값을 쓰므로 하나만
   등록하면 됨(`docker-compose.koyeb.yml`이 두 군데 다 그 값을 씀).
4. 무료 인스턴스는 1시간 미접속시 슬립되고, 다음 접속시 콜드스타트 있음(Docker 데몬 기동 +
   이미지 pull, 빌드는 없음이라 Render 때보다는 빠름) — 개인용 앱이라 감수.
5. 배포 후 반드시 실제로 한 곡 재생해서 위 "주의" 항목(PO 토큰 발급 실패)이 없는지 확인할 것 —
   Koyeb의 IP 대역도 차단 목록에 있을 가능성이 있음.

## 참고: 법적 유의사항

YouTube에서 오디오를 추출하는 건 YouTube 이용약관 위반입니다. 이 프로젝트는 개인
전용(비밀번호 게이트)으로 설계되었고, 그걸 전제로 감수하기로 한 리스크입니다 — 공개
서비스로 운영할 목적이 아닙니다.
