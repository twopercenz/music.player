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
`Failed to validate PO token: all validation attempts returned non-200 status codes`, 또는
Google 엣지 자체 차단이면 `youtubei/v1/player`가 403 `Sorry... automated queries` HTML을
반환 — 실제로 Render Public Web Service에서 겪음). 이건 토큰 내용 문제가 아니라 IP 평판
문제라 클라이언트 종류나 재시도로는 안 풀림. 그래서 아래 "배포" 섹션은 애초에 클라우드 IP를
안 쓰고 **집에서 Companion을 직접 돌리는 방식**을 씀 — 그게 안 맞으면(예: 24시간 켜둘 집
기기가 없음) 클라우드에 올리고 아래 PROXY로 우회하는 것도 방법.

**PROXY 설정법** (클라우드에 올릴 경우에만 필요): [config.ts](https://github.com/iv-org/invidious-companion/blob/master/src/lib/helpers/config.ts)가
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

## 배포 (Vercel + 집에서 돌리는 Companion, 완전 무료)

시도했던 클라우드 조합들은 전부 두 문제 중 하나에 걸렸음:

- **서비스 두 개를 무료로 같이 못 띄움** — Render 무료 Private Service는 내부 DNS가 안
  붙었고(`getaddrinfo ENOTFOUND`), Koyeb 무료 인스턴스는 조직당 1개뿐이고 서비스 메시에서
  아예 빠짐(게다가 2026년 2월 Mistral AI 인수 이후 신규 가입은 무료 Starter 플랜 자체가 막힘).
- **떴다 해도 IP가 막힘** — Render의 Public Web Service로 Companion을 띄웠더니 PO 토큰
  발급 요청 자체가 Google 엣지에서 403 `Sorry... automated queries`로 막힘 — 이건 PO 토큰
  내용의 문제가 아니라 Render IP 대역이 자동화 트래픽으로 찍혀서 나는 문제라, 토큰이나 클라이언트
  종류를 바꿔도 안 풀림. 유료 주거용(residential) 프록시가 정석적인 해법이긴 한데, 완전 무료로
  가려면 **애초에 클라우드 IP를 안 쓰면 됨**.

그래서 최종 구조:

- **Vercel**(무료) — 이 앱 전체(로그인 게이트, `/api/extract` 프록시 포함). Vercel을 원래
  배제했던 이유("상시 실행되는 Companion 필요")는 **Companion에만 해당**하지 이 Next.js 앱
  자체엔 해당 안 됨 — `/api/extract`는 Companion이 준 오디오 바이트를 스트리밍으로 그대로
  흘려보내기만 함(`new Response(upstream.body, ...)`). Vercel Functions는 스트리밍 응답엔
  4.5MB 바디 제한이 안 걸리고, Fluid Compute 켜진 Hobby(무료) 플랜 기준 실행시간도 기본
  300초까지라 오디오 프록시 정도는 충분함.
- **Companion은 집에서 직접 돌림** — 24시간 켜둘 수 있는 아무 기기(PC, 라즈베리파이 등)에서
  `docker run`으로 띄움. 집 인터넷 IP는 진짜 주거용이라 애초에 차단 대역이 아님 — 프록시가
  아예 필요 없어짐. 밖에서(Vercel에서) 접근 가능하게 하는 건
  [Tailscale Funnel](https://tailscale.com/kb/1223/funnel)(무료 Personal 플랜에 포함,
  대역폭 제한 사실상 넉넉함)로 안정적인 HTTPS 주소를 만듦 — 공유기 포트포워딩이나 집 IP가
  바뀌는 것도 신경 안 써도 됨(Tailscale이 알아서 처리).

배포 순서:

1. **집 기기에 Companion 띄우기**:
   ```bash
   docker run -d --name invidious_companion \
     -p 8282:8282 \
     -e SERVER_SECRET_KEY=<COMPANION_SECRET_KEY와 동일한 값> \
     -v invidious_companion_cache:/var/tmp \
     --restart unless-stopped \
     quay.io/invidious/invidious-companion:2026.09.05-6386b18
   ```
2. **같은 기기에 Tailscale 설치** — [tailscale.com/download](https://tailscale.com/download),
   무료 Personal 계정으로 로그인.
3. **Funnel로 공개**:
   ```bash
   tailscale funnel --bg --https=443 localhost:8282
   ```
   처음 실행하면 승인 링크를 보여줌(admin console에서 Funnel 정책 허용) — 링크 열어서 승인.
   `--bg`라 재부팅해도 자동으로 다시 켜짐.
4. `tailscale funnel status`로 확인하면 `https://<기기이름>.<tailnet이름>.ts.net` 같은 공개
   HTTPS 주소가 나옴 — 이게 `COMPANION_URL`.
5. Vercel에서 이 저장소 Import → 아래 표의 환경변수들 + `COMPANION_URL`을 그 Funnel 주소로
   등록(끝에 `/` 없이). Deploy.
6. 배포 후 반드시 실제로 한 곡 재생해서 확인. 집 기기/인터넷이 꺼지면 재생도 같이 죽는다는 게
   유일한 대가 — 개인용 앱이라 감수.

이 IP 차단 문제를 클라우드 호스팅(Render 등)으로 그대로 풀고 싶으면 위쪽 "Invidious
Companion이란" 항목의 **PROXY 설정법**(유료 주거용 프록시) 참고.

로컬 개발은 여전히 `docker compose up --build`(위 "로컬에서 돌리기" 참고) — 이건 배포 방식과
무관하게 그대로 씀.

## 참고: 법적 유의사항

YouTube에서 오디오를 추출하는 건 YouTube 이용약관 위반입니다. 이 프로젝트는 개인
전용(비밀번호 게이트)으로 설계되었고, 그걸 전제로 감수하기로 한 리스크입니다 — 공개
서비스로 운영할 목적이 아닙니다.
