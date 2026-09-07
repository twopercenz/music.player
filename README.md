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

## 배포 (Render, 무료 티어)

Vercel 서버리스 함수는 이 구조(상시 실행되는 Companion 서비스)에 적합하지 않아서, 이제
**서비스 두 개**를 배포해야 함 — 이 저장소의 `Dockerfile`(앱)과
`quay.io/invidious/invidious-companion` 이미지(Companion).

1. Render에서 Web Service를 두 개 만듦: 이 저장소 연결한 것(Docker 런타임) 하나, Companion
   이미지로 하나 더.
2. Render의 **Private Service**로 등록하면(퍼블릭 URL 없이 같은 프로젝트 내부에서만 접근
   가능) Companion을 외부에 노출하지 않고 앱에서 내부 호스트명으로 접근 가능 — 무료 티어에서도
   지원됨. 앱 쪽 `COMPANION_URL`을 그 내부 호스트명으로 설정.
3. 앱 서비스에 위 표의 환경변수들을, Companion 서비스에 `SERVER_SECRET_KEY`(앱의
   `COMPANION_SECRET_KEY`와 동일한 값)를 등록.
4. 무료 티어는 15분 미접속시 슬립되고, 다음 접속시 콜드스타트가 있음(Companion까지 두 개라
   전보다 조금 더 걸릴 수 있음) — 개인용 앱이라 감수. 항상 켜져 있어야 하면 유료 플랜으로
   업그레이드.
5. 배포 후 반드시 실제로 한 곡 재생해서 위 "주의" 항목(PO 토큰 발급 실패)이 없는지 확인할 것 —
   Render의 IP 대역도 차단 목록에 있을 가능성이 있음.

## 참고: 법적 유의사항

YouTube에서 오디오를 추출하는 건 YouTube 이용약관 위반입니다. 이 프로젝트는 개인
전용(비밀번호 게이트)으로 설계되었고, 그걸 전제로 감수하기로 한 리스크입니다 — 공개
서비스로 운영할 목적이 아닙니다.
