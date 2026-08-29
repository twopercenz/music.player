# music.player 수정 작업 지시서

이 문서는 `twopercenz/music.player` 저장소 코드 리뷰 결과를 작업 단위로 정리한 것이다.
각 항목은 독립적으로 커밋 가능하다. **P0 → P1 → P2 순서로 진행할 것.**

## 작업 규칙

- 한 항목 = 한 커밋. 여러 항목을 한 커밋에 섞지 말 것.
- 각 항목의 "완료 조건"을 만족하는지 확인한 뒤 다음으로 넘어갈 것.
- 매 커밋 전 `bun run lint`와 `bunx tsc --noEmit` 통과 확인.
- 이 문서에 적힌 줄 번호는 리뷰 시점 기준이다. 수정하면서 밀리므로 **줄 번호가 아니라 함수명/코드 내용으로 위치를 찾을 것.**
- 리팩터링 김에 다른 걸 손대지 말 것. 지시된 범위만 수정한다.
- README에 이미 적혀 있는 설계 의도(서버에 아무것도 저장 안 함, 개인용 비밀번호 게이트 등)를 바꿔야 하는 항목은 P0-2뿐이다. 그 외에는 기존 설계를 유지한다.

---



# P2 — 성능, 구조, 정리

## P2-1. 컨텍스트 리렌더 폭발 (체감 가장 큰 최적화)

### 증상
`components/player/player-context.tsx`의 `value={{ ...player, ...library, analyserRef }}`가 매 렌더마다 새 객체다.
`hooks/use-player.ts`의 `onTimeUpdate`가 초당 약 4회 `setCurrentTimeMs`를 호출하므로 **초당 4회 전체 트리가 리렌더된다** — 검색바, 라이브러리 목록, 가사 뷰, 업로드 버튼까지 전부.

### 수정
재생 시간을 별도 컨텍스트로 분리한다.

**파일: `components/player/player-context.tsx`**

- `PlayerContext`: 시간을 제외한 나머지. `useMemo`로 감싼다.
- `PlayerTimeContext`: `currentTimeMs`만 담는 별도 컨텍스트.
- `usePlayerContext()`와 `usePlayerTime()` 두 훅을 export.

**파일: `hooks/use-player.ts`**

반환 객체에서 `currentTimeMs`를 분리해 별도로 반환하거나, 반환 객체를 `useMemo`로 감싸되 `currentTimeMs`는 제외한다.

**소비자 수정**: `currentTimeMs`를 쓰는 곳만 `usePlayerTime()`으로 바꾼다.
- `components/player/left-panel.tsx` (시크바 + 경과 시간) — 이 부분만 별도 컴포넌트로 분리해 시간 컨텍스트를 구독하게 할 것
- `components/player/right-panel.tsx` → `lyrics-view.tsx`

### 완료 조건
- React DevTools Profiler에서 재생 중 `SearchBar`와 `UploadButton`이 리렌더되지 않는다.
- 가사 싱크와 시크바는 그대로 동작한다.

---

## P2-2. 비주얼라이저가 항상 CPU를 태움

### 증상
`components/player/visualizer.tsx`의 `requestAnimationFrame` 루프가 정지 중이든 탭이 백그라운드든 계속 돈다.

### 수정

**파일: `components/player/visualizer.tsx`**

- `isPlaying` prop을 받아(`components/player/right-panel.tsx`에서 전달) false면 마지막 프레임을 한 번 그리고 `cancelAnimationFrame`
- `document.visibilitychange` 리스너를 붙여 `document.hidden`이면 루프 정지, 복귀 시 재개
- 파티클 배열은 정지 시 비우지 말고 유지(재개 시 자연스럽게 이어지도록)

`resize()`가 `getBoundingClientRect()` 기준인데 패널이 숨겨진 상태에서 마운트되면 0×0이 된다. `ResizeObserver`로 교체할 것.

### 완료 조건
- 일시정지 상태에서 CPU 사용량이 유휴 수준으로 떨어진다.
- 탭을 백그라운드로 보내면 애니메이션이 멈춘다.
- 가사↔비주얼라이저 토글 후에도 캔버스 크기가 정상이다.

---

## P2-3. 외부 API 응답 캐싱 없음

### 증상
`lib/itunes.ts`(2곳), `lib/lyrics.ts`(2곳)의 모든 `fetch`가 `cache: "no-store"`다. 같은 곡을 다시 틀 때마다 iTunes와 lrclib를 새로 호출한다.

### 수정
`cache: "no-store"`를 Next의 fetch 캐시로 교체한다.

- `lib/itunes.ts`의 `findItunesMatch()` (아트워크 조회): `{ next: { revalidate: 604800 } }` — 앨범 아트는 거의 안 바뀐다
- `lib/lyrics.ts`의 두 fetch: `{ next: { revalidate: 604800 } }`
- `lib/itunes.ts`의 `searchItunesTracks()` (자동완성): `{ next: { revalidate: 3600 } }` — 검색어별로 캐시 키가 갈리므로 안전하다
- `lib/youtube.ts`의 `youtubeFetch()`: P1-7에서 Supabase 캐시를 넣었으므로 `no-store` 유지

### 완료 조건
- 같은 곡을 두 번 재생할 때 두 번째는 iTunes/lrclib 요청이 나가지 않는다.

---

## P2-4. Object URL 누수

### 증상
`lib/db/indexeddb.ts`의 `recordToTrack()`이 호출될 때마다 아트 blob에 대해 `URL.createObjectURL()`을 새로 만들고 아무도 revoke하지 않는다. `hooks/use-library.ts`의 `refresh()`는 곡 추가/삭제마다 호출되므로 사용할수록 누적된다.

`getLocalTrackAudioUrl()`, `getCachedAudioUrl()`도 마찬가지로 호출마다 새 URL을 만든다.

### 수정

**파일: `lib/db/indexeddb.ts`**

`recordToTrack()`에서 즉시 URL을 만들지 말고, `artBlob`을 `LocalTrack`에 그대로 실어 보내거나(타입 변경 필요) `id → objectURL` 모듈 스코프 Map으로 메모이즈해 같은 트랙에 대해 한 번만 만들도록 한다. 후자가 변경 범위가 작다.

**파일: `hooks/use-player.ts`**

`objectUrlRef` 정리 로직은 이미 있지만, 컴포넌트 언마운트 시 revoke가 없다. `usePlayer` 안에 cleanup effect 추가.

```ts
useEffect(() => {
  return () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  };
}, []);
```

### 완료 조건
- Chrome DevTools의 `chrome://blob-internals`에서 라이브러리를 여러 번 갱신해도 blob URL이 무한 증가하지 않는다.

---

## P2-5. ffmpeg 불필요한 재인코딩

### 증상
`lib/extract.ts`가 항상 mp3 192k로 재인코딩한다. YouTube 오디오는 대부분 이미 opus/m4a이므로 무료 티어 CPU에서 이게 콜드스타트 체감의 상당 부분을 차지한다.

### 수정

**파일: `lib/extract.ts`**

yt-dlp 포맷 선택을 `-f "bestaudio[ext=m4a]/bestaudio/best"`로 바꾸고, m4a가 선택된 경우 ffmpeg를 `-c:a copy -f adts`로 실행해 트랜스먹싱만 한다.

포맷 판별이 까다로우면 더 단순한 방법도 가능하다: yt-dlp를 두 단계로 나누지 말고, ffmpeg 인자를 `["-i", "pipe:0", "-vn", "-c:a", "copy", "-f", "adts", "pipe:1"]`로 먼저 시도하고 실패 시 기존 mp3 인코딩으로 폴백. 다만 폴백 시 스트림을 다시 받아야 하므로 **첫 번째 방식(포맷 명시)을 우선 시도할 것.**

`Content-Type`도 그에 맞게 `audio/aac`로 바꿔야 한다(`app/api/extract/route.ts`). 캐시 파일 확장자도 함께 조정(P0-2의 `lib/audio-cache.ts`).

### 완료 조건
- 추출 시 컨테이너 CPU 사용량이 눈에 띄게 낮아진다.
- 크롬/사파리에서 재생이 정상 동작한다.

### 주의
이 항목은 재생 호환성 회귀 위험이 있다. **P0/P1을 전부 끝낸 뒤 마지막에 할 것.** 문제가 생기면 되돌리기 쉽도록 단독 커밋으로.

---

## P2-6. 죽은 코드 및 중복 의존성 제거

### 삭제 대상 (전부 참조 0, precedent 템플릿 잔재)
- `lib/hooks/use-intersection-observer.ts`
- `lib/hooks/use-media-query.ts`
- `lib/hooks/use-scroll.ts`
- `lib/utils.ts`의 `cn()` 함수
- `lib/utils.ts`의 `truncate()` 함수

삭제 후 `package.json`에서 `clsx`, `tailwind-merge` 제거 (`cn`만 쓰던 의존성).

### 훅 디렉터리 통합
`hooks/`(도메인 훅)과 `lib/hooks/`(유틸 훅)이 공존한다. 위 3개를 지우면 `lib/hooks/`에는 `use-local-storage.ts`만 남는다. 이것을 `hooks/use-local-storage.ts`로 옮기고 `lib/hooks/` 디렉터리를 삭제한다. import 경로를 `@/hooks/use-local-storage`로 수정(`hooks/use-player.ts`).

`tsconfig.json`의 `paths`에서 사용하지 않는 `@/pages/*`, `@/styles/*` 항목도 제거.

### classnames 제거
`classnames`는 `app/layout.tsx`에서만 쓰인다. 템플릿 리터럴로 바꾸고 의존성 제거.

```tsx
// app/layout.tsx
<body className={`${sfPro.variable} ${inter.variable} bg-black`}>{children}</body>
```

### 완료 조건
- `bunx tsc --noEmit` 통과.
- `package.json`에서 `classnames`, `clsx`, `tailwind-merge` 세 개가 사라진다.

---

## P2-7. package.json 의존성 분류 및 버전 정리

### 증상
`typescript`, `eslint`, `eslint-config-next`, `@types/node`, `@types/react`, `@types/react-dom`가 `dependencies`에 있다. 프로덕션 Docker 이미지에 그대로 들어간다.

버전 조합도 불안정하다.
- `next: 14.3.0-canary.57` — 카나리 버전 핀
- `eslint-config-next: 13.1.1` — next와 메이저 불일치
- `lucide-react: 0.105.0-alpha.4` — 알파
- `@types/node: 18.11.18` — 런타임(Node 20+/Bun)과 불일치

### 수정

**파일: `package.json`**

1. 위 6개 패키지를 `devDependencies`로 이동
2. `next`를 최신 안정 14.x로 변경, `eslint-config-next`를 같은 메이저로 맞춤
3. `lucide-react`를 최신 안정 버전으로
4. `@types/node`를 20.x로
5. `bun install` 후 `bun.lock` 갱신, `bun run build`와 `bun run lint` 통과 확인

**주의**: next 버전 변경은 회귀 위험이 있다. 단독 커밋으로 하고, App Router 동작(특히 `app/api/*/route.ts`의 정적화 판정과 `middleware.ts`)을 재확인할 것.

### 완료 조건
- `bun run build`, `bun run lint`, `bunx tsc --noEmit` 전부 통과.
- 로그인 → 검색 → 재생 → 가사 표시 전 경로 수동 확인.

---

## P2-8. Docker 이미지 개선

### 증상 및 수정

**파일: `next.config.js`** — standalone 출력 활성화 + 보안 헤더

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
```

CSP는 `framer-motion`의 인라인 스타일, iTunes 아트워크 도메인(`is1-ssl.mzstatic.com` 등), blob URL을 전부 허용해야 해서 까다롭다. **CSP는 이 작업에서 제외하고 위 4개 헤더만 넣을 것.**

**파일: `Dockerfile`**

1. `output: "standalone"`에 맞춰 runner 스테이지를 수정
   - `COPY --from=builder /app/.next/standalone ./`
   - `COPY --from=builder /app/.next/static ./.next/static`
   - `COPY --from=builder /app/public ./public`
   - `node_modules` 통째 복사 제거
   - `CMD ["bun", "server.js"]`
2. **root로 실행되는 문제** — runner 스테이지 `CMD` 앞에 `USER bun` 추가 (oven/bun 이미지에 `bun` 유저가 이미 존재). `/app` 소유권을 맞춰줄 것.
3. **yt-dlp 버전 미고정** — `latest`에서 받으면 재현 불가능하고 체크섬 검증도 없다. 특정 릴리스 태그로 핀하고 SHA256 검증 추가. 상단에 `ARG YTDLP_VERSION=...`으로 두어 업데이트를 쉽게.
4. `HEALTHCHECK` 추가 (`curl -f http://localhost:3000/login`)

**주의**: `output: "standalone"`은 `lib/extract.ts`가 `spawn`하는 외부 바이너리와는 무관하지만, `server-only` 패키지 등 일부 의존성 추적에 영향을 줄 수 있다. 빌드 후 **실제 컨테이너를 띄워 전 경로를 수동 확인할 것.**

### 완료 조건
- 이미지 크기가 눈에 띄게 줄어든다(`docker images`로 전후 비교).
- 컨테이너 안에서 `whoami`가 `bun`이다.
- 로그인 → 검색 → 재생이 컨테이너에서 정상 동작한다.

---

## P2-9. localStorage 파싱 크래시

### 증상
`lib/hooks/use-local-storage.ts`(P2-6 이후 `hooks/use-local-storage.ts`)의 `JSON.parse(item)`에 try/catch가 없다. localStorage 값이 깨지면 effect에서 예외가 나며 렌더가 터진다.

### 수정
파싱을 try/catch로 감싸고 실패 시 해당 키를 제거한 뒤 `initialValue`를 유지한다. 함수형 업데이트(`setValue(prev => ...)`)도 지원하도록 시그니처를 확장하면 좋지만 필수는 아니다.

### 완료 조건
- DevTools에서 `localStorage.setItem("mp:volume", "not json")` 후 새로고침해도 앱이 정상 렌더된다.

---

## P2-10. 검색 결과에서 저장된 곡이 사라지는 UX 문제

### 증상
`components/player/search-bar.tsx`의 결과 렌더링에서 이미 라이브러리에 있는 곡을 `filter`로 **완전히 제외**한다. 사용자 입장에서는 검색해서 재생하려던 곡이 그냥 없어진 것처럼 보인다.

### 수정
필터를 제거하고, 이미 저장된 곡에는 "저장됨" 배지를 표시한다. `ResultRow`에 `saved?: boolean` prop을 추가해 `onAdd` 버튼 대신 배지를 렌더한다.

### 완료 조건
- 라이브러리에 있는 곡을 검색하면 "Apple Music에서 검색" 섹션에도 나타나고, 추가 버튼 대신 저장됨 표시가 보인다.

---

## P2-11. 자잘한 정리

- **`.gitignore`**: `cookies.txt`가 두 번 적혀 있다(중간과 맨 끝). 중복 제거하고 파일 끝 개행 추가.
- **`components/player/visualizer.tsx`**: `analyser.getByteTimeDomainData(timeData as any)`와 `getByteFrequencyData(freqData as any)`의 `as any`. TypeScript의 `Uint8Array<ArrayBufferLike>` 제네릭 변경과 관련된 것으로 보인다. `as any` 없이 컴파일되는지 확인하고, 안 되면 `new Uint8Array(analyser.frequencyBinCount)`로 크기를 맞춰볼 것. 그래도 안 되면 `as any` 대신 정확한 타입 단언으로 좁힐 것.
- **`app/fonts/SF-Pro-Display-Medium.otf`**: 애플 SF Pro는 재배포 제한이 있는 폰트다. MIT 라이선스 공개 저장소에 바이너리로 커밋된 상태다. 저장소에서 제거하고 시스템 폰트 스택(`-apple-system`)이나 자유 라이선스 대체 폰트로 교체할 것. `app/fonts/index.ts`와 `tailwind.config.js` 수정 필요. **git 히스토리에서도 지우려면 별도 작업이 필요하니, 일단 현재 트리에서만 제거하고 사용자에게 히스토리 정리 여부를 물을 것.**
- **`lib/youtube.ts`의 `parseIsoDuration()`**: `P#D` 형식(1일 넘는 영상)을 처리하지 않는다. 음악 카테고리라 실질적으로 문제는 없지만 정규식에 `(?:(\d+)D)?`를 추가해두면 안전하다.

---

# 테스트 추가 (P2 이후)

현재 테스트가 하나도 없다. 다음 순수 함수들은 테스트 비용이 거의 0이다. `bun test`로 작성할 것(추가 의존성 불필요).

- `lib/lyrics.ts`의 `parseLrc()` — 타임스탬프 파싱, 밀리초 자릿수(1~3자리), 빈 줄 무시, 정렬
- `lib/youtube.ts`의 `parseIsoDuration()`, `scoreCandidate()` — 재생시간 근접도 스코어링, 네거티브 키워드 감점
- `lib/auth.ts`의 `createSessionToken()` / `verifySessionToken()` — 왕복 검증, 만료 토큰 거부, 서명 변조 거부, 비밀번호 변경 시 무효화(P1-4 이후)
- `lib/types.ts`의 `parseYoutubeTrack()` (P1-6에서 추가) — 각 검증 규칙별 케이스
- `lib/utils.ts`의 `formatDuration()` — 0, 음수, 1시간 이상

**파일: `.github/workflows/ci.yml`** — `bun install` → `bunx tsc --noEmit` → `bun run lint` → `bun test`를 push/PR에서 실행.

---

# 작업 순서 요약


10. **P2-1** 컨텍스트 분리 — 체감 성능 최대
11. **P2-2 ~ P2-4** 성능
12. **P2-6 ~ P2-9** 구조 정리
13. **P2-10, P2-11** UX/잡정리
14. **P2-5** ffmpeg 트랜스먹싱 (회귀 위험, 마지막)
15. 테스트 + CI

각 단계 후 수동 확인 경로: **로그인 → 검색 → 결과 클릭 재생 → 가사 표시 → 다음 곡 → 시크 → 새로고침 후 같은 곡 재생(캐시 히트)**
