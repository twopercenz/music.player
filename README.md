# music player

기능은 심플하게, UI는 화려하게. 개인용 뮤직 플레이어.

## 어떻게 동작하나

- **검색 & 재생**: 검색은 Apple의 iTunes Search API(무료, 인증 불필요)로 한다 — 깨끗한
  제목/아티스트 메타데이터와 정사각 앨범 아트를 그대로 얻는다. 검색 결과를 누르면
  `/api/resolve`가 YouTube Data API로 실제 재생할 영상을 매칭한다(제목 키워드 + 재생시간
  근접도 스코어링) — 검색과 재생은 별도 소스라 이 매칭 단계가 항상 낀다. 매칭된 영상은
  `/api/extract`가 서버에서 `yt-dlp` + `ffmpeg`로 오디오만 추출해 스트리밍하고, 서버에는
  재생 가속용 임시 캐시만 두며(재시작 시 소멸, 영구 저장 아님) 클라이언트도 받은 오디오를
  브라우저 IndexedDB에 캐싱한다(재생할 때마다 재추출/재다운로드하지 않도록).
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

```bash
bun install
cp .env.example .env.local   # 값 채우기 (아래 "필요한 키" 참고)
bun dev
```

`yt-dlp`와 `ffmpeg`가 로컬 PATH에도 설치되어 있어야 `/api/extract`가 동작합니다.

```bash
# macOS
brew install yt-dlp ffmpeg
```

### "Sign in to confirm you're not a bot" 에러가 뜬다면

YouTube가 (특히 클라우드 서버 IP에서 오는 요청을) 봇으로 의심해서 막는 경우입니다. 로그인된
세션의 쿠키를 넘겨주면 해결됩니다:

1. **로컬 개발**: `.env.local`에 `YTDLP_COOKIES_FROM_BROWSER=chrome` (또는 `firefox` 등) —
   설치된 브라우저에서 쿠키를 바로 가져다 씁니다. 그 브라우저로 유튜브에 로그인만 되어 있으면 됨.
2. **배포 환경(Render 등)**: 브라우저 자체가 없으니, `cookies.txt` 파일을 직접 export해야 합니다.
   - Chrome/Edge: **"Get cookies.txt LOCALLY"** 확장 프로그램 사용 (이름이 비슷한 "Get
     cookies.txt"라는 예전 확장은 멀웨어로 판정되어 스토어에서 내려간 적 있으니 정확히
     이 이름으로 설치하세요)
   - Firefox: **"YT-DLP Cookie Exporter"** 확장 프로그램
   - youtube.com에 로그인한 상태에서 export → `cookies.txt` 파일이 나옴
   - **로컬**: 그 파일을 프로젝트 루트에 두고 `YTDLP_COOKIES_FILE=./cookies.txt` (이미
     `.gitignore`에 걸려있어서 실수로 커밋될 일 없음 — 실제 로그인 세션이라 커밋하면 안 됨)
   - **Render**: 대시보드의 **Secret Files** 기능으로 `cookies.txt`를 업로드하고(예:
     `/etc/secrets/cookies.txt`에 마운트됨), `YTDLP_COOKIES_FILE=/etc/secrets/cookies.txt`로
     설정. 일반 환경변수에 파일 내용을 붙여넣는 것보다 이 방법이 더 깔끔합니다.
3. 참고로 로그인용 계정은 본계정보다 별도의 서브 계정을 쓰는 게 리스크를 줄이는 방법입니다
   (쿠키가 새거나, 계정에 이상 동작으로 감지될 가능성이 이론상 있음). 쿠키는 시간이 지나면
   만료될 수 있어서 가끔 재발급이 필요할 수 있습니다.

## 필요한 키

`.env.example` 참고. 요약하면:

| 키 | 어디서 발급 |
|---|---|
| `SITE_PASSWORD` | 직접 정하기 |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `YOUTUBE_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (YouTube Data API v3 활성화) |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | [Supabase 대시보드](https://supabase.com/dashboard), 무료 티어. Settings > API Keys에서 **secret key**(`sb_secret_...`, 구 service_role) 사용 — publishable key 아님. `supabase/schema.sql`을 SQL 에디터에서 한 번 실행 |

Spotify 키는 필요 없습니다 (검색도 YouTube로 통합됨).

## 배포 (Render, 무료 티어)

Vercel 서버리스 함수는 `yt-dlp`/`ffmpeg`를 돌리기에 적합하지 않아서(바이너리 크기·실행시간
제한), `Dockerfile`로 전체 앱(프론트+API+추출 파이프라인)을 하나의 컨테이너로 배포합니다.

1. Render에서 "New Web Service" → 이 저장소 연결 → **Docker** 런타임 선택
2. 위 표의 환경변수들을 Render 대시보드에 등록
3. 무료 티어는 15분 미접속시 슬립되고, 다음 접속시 콜드스타트(~1분)가 있음 — 개인용
   앱이라 감수. 항상 켜져 있어야 하면 유료 플랜으로 업그레이드.

## 참고: 법적 유의사항

YouTube에서 오디오를 추출하는 건 YouTube 이용약관 위반입니다. 이 프로젝트는 개인
전용(비밀번호 게이트)으로 설계되었고, 그걸 전제로 감수하기로 한 리스크입니다 — 공개
서비스로 운영할 목적이 아닙니다.
