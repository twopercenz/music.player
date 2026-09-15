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

전체 설계 배경(왜 처음엔 Spotify+YouTube였는지, 왜 Vercel/Render/Koyeb를 거쳐 결국 Oracle
Cloud로 왔는지, 비용을 어떻게 $0으로 맞췄는지 등)은 이 프로젝트를 만들 때 나눈 대화에 정리되어
있음.

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
반환 — 실제로 Render Public Web Service, Azure Codespace, **그리고 지금 쓰는 Oracle
Cloud VM까지 세 군데 다 똑같이 겪음**). 클라우드 회사가 어디든 결국 데이터센터 IP는 전부
YouTube의 봇 차단 리스트에 이미 올라가 있다는 뜻 — 토큰 내용 문제가 아니라 IP 평판 문제라
클라이언트 종류나 재시도로는 안 풀림(공개 Invidious 인스턴스들도 예외 아님 — 살아남은 소수는
전부 rotating residential proxy 인프라를 돌리는 비용을 감당해서 버티는 거지, 무슨 우회법을
따로 아는 게 아님). 그래서 위 "배포" 섹션의 기본 경로는 아예 [브라우저 확장
프로그램](extension/)을 씀(서버가 안 끼니까 이 문제 자체가 없음). 그래도 `/api/extract`
폴백을 살리고 싶으면 아래 두 방법 중 하나:

**집에서 Companion 돌리기** (무료, 24시간 켜둘 기기가 있을 때): 집 인터넷 IP는 진짜
주거용이라 애초에 차단 대역이 아님. 지금은 안 쓰고 있지만(Companion을 Oracle VM에 상시
호스팅하는 쪽으로 감), 대안으로 유효함.
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

## 배포 (Oracle Cloud Always Free)

**거쳐온 것들**: Vercel(단독) → Render/Koyeb로 Companion 같이 띄우려다 무료 티어 제약에
막힘 → Render Public Service + 집에서 Companion을 Tailscale Funnel로 노출 → 지금은 **web
과 Companion 둘 다 Oracle Cloud Always Free 인스턴스 위**. 앱만 딴 데 두고 Companion을
집 기기/Vercel/다른 클라우드에 흩어놓지 않고, 인프라를 한 계정·한 VCN 안에 다 모으고 싶어서
옮김 — 영구 무료 티어라 상시 실행 비용도 $0.

### 왜 인스턴스가 2개인가

`docker-compose.yml`의 두 서비스(`web`, `invidious_companion`)를 **각각 다른 VM에** 올림.
이유는 이미지 아키텍처가 안 맞아서:

- `oven/bun:1-debian`(web 이미지) — 멀티아키텍처, amd64/arm64 둘 다 지원
- `quay.io/invidious/invidious-companion` — **amd64 전용**, arm64 매니페스트 없음

Oracle Always Free의 제일 좋은 셰이프(Ampere A1, 최대 4 OCPU/24GB)는 **arm64**라서
Companion을 그 위에 올리면 QEMU 에뮬레이션이 필요함 — 느리고, 애초에 IP 차단이랑 씨름하는
서비스에 에뮬레이션까지 얹을 이유가 없어서 그냥 둘 다 Always Free의 **amd64 마이크로
인스턴스**(`VM.Standard.E2.1.Micro`, 계정당 2개 무료 포함)에 하나씩 올림:

| 서비스 | 인스턴스 | 셰이프 | 역할 |
|---|---|---|---|
| `web` (Next.js) | `web-vm-e2-micro` | `VM.Standard.E2.1.Micro` (amd64) | Caddy(자동 HTTPS) 뒤에서 :3000 서빙 |
| `invidious_companion` | `companion-vm` | `VM.Standard.E2.1.Micro` (amd64) | `web-vm`의 IP에서만 8282 인그레스 허용 |

(Ampere A1은 지금 이 리전에서 상시 품절이라 못 씀 — 언젠가 잡히면 `web` 쪽을 더 여유 있는
스펙으로 옮기는 것도 고려 중, 급한 건 아님.)

### 도메인 · HTTPS

`web-vm-e2-micro`의 Public IP를 **Reserved**로 승격해서 고정해두고(재부팅해도 안 바뀜),
[mxc-play.kro.kr](https://mxc-play.kro.kr)(무료 서브도메인)의 A 레코드를 거기로 맞춤.
그 앞에 [Caddy](https://caddyserver.com/)를 컨테이너로 띄워서(`--network host`,
`reverse_proxy localhost:3000`) Let's Encrypt 인증서를 자동으로 받고 갱신함 — nginx +
certbot 조합 안 써도 됨.

> kro.kr처럼 여러 사람이 쓰는 무료 서브도메인은 Let's Encrypt가 그 도메인 전체를 하나의
> "등록 도메인"으로 보고 **주당 인증서 발급 50개**를 공유 한도로 제한함 — 다른 사용자가 그
> 주간 한도를 채워두면 우리 발급도 `HTTP 429 rateLimited`로 잠깐 막힐 수 있음. Caddy가
> 알아서 최대 30일까지 백오프하며 재시도하니 기다리면 됨, 별도 조치 불필요.

### 보안 그룹(Security List) 원칙

기본은 전부 막고 필요한 것만 좁혀서 엶:

- `22`(SSH), `80`/`443`(Caddy) — `0.0.0.0/0`에 공개 (정상적인 공개 서비스 포트라 당연히 열림)
- `8282`(Companion) — **`web-vm`의 IP에서만** 허용, 인터넷 전체엔 안 엶(companion↔web 전용
  트래픽이지 일반 공개 API가 아니므로)
- OCI의 Security List가 열려 있어도 **VM 자체의 iptables**(Ubuntu 기본 이미지는 22만 허용)가
  따로 막고 있을 수 있음 — 둘 다 확인해야 함, 하나만 보고 "포트 열었는데 왜 안 되지" 하기 쉬움

### 배포 자동화 (GitHub Actions)

`main`에 push하면 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)이 알아서:

1. `web` 이미지를 `linux/amd64`로 빌드해서 GHCR(`ghcr.io/<owner>/music-player-web`)에 푸시
2. `web-vm-e2-micro`에 SSH로 접속해서 새 이미지 pull → 기존 `web` 컨테이너 교체

레포 Settings → Secrets and variables → Actions에 아래 세 개 필요(값은 직접 발급/확인):

| Secret | 값 |
|---|---|
| `DEPLOY_HOST` | `web-vm-e2-micro`의 Reserved Public IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | 그 VM에 등록해둔 SSH 개인키 전체 |

`invidious_companion`(`companion-vm`)은 이 파이프라인에 안 낌 — 훨씬 덜 바뀌는 서비스라 지금은
수동 배포(`docker save | ssh | docker load` 로 로컬에서 빌드한 이미지를 레지스트리 없이 바로
전달)로 충분함.

### 브라우저 확장 프로그램 관련 주의

기본 경로(확장 프로그램)는 **그 브라우저가 실제로 youtube.com에 접속 가능해야** 동작함 —
당연한 얘기 같지만, 학교/회사에서 관리하는(managed) 기기는 흔히 YouTube 자체를 네트워크
정책으로 막아두는 경우가 있고, 그런 기기에서 열리는 숨겨진 탭도 똑같이 막힘(주소창엔 정상
URL이 찍히는데 실제로는 Chrome의 "관리자에 의해 차단됨" 페이지라 content script가 주입될
진짜 페이지가 없음). 이 경우 그 기기에서는 확장 경로 자체가 원천적으로 안 됨 — 코드 문제가
아니라 네트워크 정책 문제라 손 쓸 방법이 없고, 다른(비관리) 기기·브라우저에서 쓰거나 위
"Invidious Companion이란"의 PROXY 폴백에 의존해야 함.

### 처음부터 셋업할 경우 순서 요약

1. OCI 계정 생성 → VCN/서브넷/Security List 구성 → 인스턴스 2개 생성(Always Free 셰이프로)
2. 각 VM에 Docker 설치, `invidious_companion`은 `docker run`으로 직접, `web`은 위 GitHub
   Actions 파이프라인으로
3. `web-vm`의 IP를 Reserved로 승격 → 도메인 A 레코드 연결 → Caddy로 HTTPS
4. 위 "필요한 키" 표의 환경변수들을 `web-vm`의 `~/.env`에 등록 (레포에 커밋 안 됨, 직접 관리)
5. 실제로 쓸 브라우저에 [extension/](extension/) 설치([extension/README.md](extension/README.md)
   참고) — Chromium 계열(Chrome/Edge/Brave)만 지원, 그 브라우저에서 유튜브 자체가 접속
   가능해야 함(위 주의사항 참고)
6. 배포된 도메인 접속 → 로그인 → 재생 테스트

로컬 개발은 여전히 `docker compose up --build`(위 "로컬에서 돌리기" 참고) — 이건 배포 방식과
무관하게 그대로 씀.

## 참고: 법적 유의사항

YouTube에서 오디오를 추출하는 건 YouTube 이용약관 위반입니다. 이 프로젝트는 개인
전용(비밀번호 게이트)으로 설계되었고, 그걸 전제로 감수하기로 한 리스크입니다 — 공개
서비스로 운영할 목적이 아닙니다.
