# claudex — 개발 스펙 문서

> **claudex**: Claude Code의 빌트인 슬래시 명령어와 번들 스킬을 공식 문서에서 매일 자동
> 수집해 색인하고, 정적 웹앱으로 검색·열람하게 해주는 "도감(dex)" 도구.

| 항목 | 값 |
| --- | --- |
| 문서 버전 | 0.1 |
| 작성일 | 2026-06-20 |
| 상태 | `packages/core` + `apps/web` 구현 완료 (MVP) |
| 패키지 매니저 / 런타임 | pnpm · Node 22+ |
| 현재 데이터 | 98 entries (명령어 90 + 번들 스킬 8) |

---

## 1. 목적과 컨셉

### 1.1 한 줄 정의
Pokédex처럼, Claude Code의 명령어·스킬을 **자동 등록·색인**해 누구나 검색만으로 찾아볼 수 있게 한다.

### 1.2 풀려는 문제
- Claude Code의 명령어/스킬은 공식 문서에 흩어져 있고 자주 바뀐다.
- 설치 없이, 검색 한 번으로 "이 명령어 뭐였지?"를 해결하고 싶다.

### 1.3 핵심 원칙
1. **사용자 비용 0** — 인증·API 키·과금 전부 없음. 사용자는 결과 JSON을 읽기만 한다.
2. **수집은 내 쪽에서만** — GitHub Actions가 공개 문서를 fetch·파싱·머지한다.
3. **검색 로직은 한 곳에(core)** — 웹/데스크탑/확장이 동일 로직을 재사용한다.
4. **정적 호스팅 가능** — 빌드 결과물은 어떤 정적 서버에도 올라간다.

---

## 2. 비기능 요구사항 / 제약

| 구분 | 요구사항 |
| --- | --- |
| 가용성 | 정적 파일만으로 동작 (백엔드/DB 없음) |
| 비용 | 사용자 측 0원, 0 인증 |
| 신선도 | 매일 1회 자동 수집 (00:00 UTC = 09:00 KST) |
| 안정성 | 문서 구조가 바뀌어 파싱이 깨지면 빌드를 **실패**시켜 잘못된 데이터 커밋 방지 |
| 보안 | 웹앱은 신뢰 불가 텍스트(설명/링크)를 렌더링 → **XSS 방지 필수** |
| 접근성 | 키보드 포커스 가시화, `prefers-reduced-motion` 존중, 모바일 반응형 |
| 이식성 | core는 플랫폼 독립(DOM/브라우저 API·fetch 경로 의존 금지) |

---

## 3. 아키텍처 (모노레포)

```
claudex/
├── packages/
│   └── core/                       # 공유 패키지: 데이터 + 검색 로직 (플랫폼 독립)
│       ├── data/entries.json       #   수집 결과 (single source of truth)
│       └── src/
│           ├── types.ts            #   Entry, Dictionary, EntryType
│           ├── search.ts           #   점수 기반 검색 (순수 함수)
│           └── index.ts            #   named export 재노출
├── apps/
│   └── web/                        # 정적 웹앱 (Vite)
│       ├── index.html              #   UI + 스타일(터미널 테마)
│       ├── src/main.ts             #   렌더링/이벤트 (검색은 core 사용)
│       └── public/data/entries.json#   core/data 의 배포 복사본
├── scripts/
│   ├── lib/markdown.ts             # 공유 파싱 유틸
│   ├── fetch-commands.ts           # 소스 A: 빌트인 명령어
│   ├── fetch-skills.ts             # 소스 B: 번들 스킬
│   └── build-index.ts              # 머지 → entries.json 생성/복사
├── .github/workflows/sync.yml      # 매일 자동 수집
├── pnpm-workspace.yaml · turbo.json · tsconfig.base.json
└── package.json · README.md · docs/SPEC.md
```

### 3.1 의존 방향 (중요)
```
scripts ─┐
apps/web ─┼─▶ packages/core   (core는 아무것도 import 하지 않음)
```
- 검색 로직·타입·데이터는 **반드시 core**. 앱·스크립트는 `@claudex/core` 를 import 한다.
- core는 DOM/`fetch` 경로/번들러 가정 같은 플랫폼 의존을 갖지 않는다.

### 3.2 데이터 흐름
```
commands.md ─┐
             ├─▶ build-index ─▶ packages/core/data/entries.json ─▶ apps/web/public/data/entries.json
skills.md ───┘                         (원본)                              (배포 복사본)
```

---

## 4. 데이터 모델

`packages/core/src/types.ts`:

```ts
export type EntryType = 'command' | 'skill'

export interface Entry {
  type: EntryType          // 'command' | 'skill'
  name: string             // 슬래시 포함, 예: "/clear"
  args: string             // 인자 표기 원본, 예: "<path>", "[model|off]", ""
  hasRequiredArg: boolean  // <...> 가 하나라도 있으면 true
  description: string      // 마크다운 (상대링크는 절대경로화). 영어 원문
  descriptionKo: string    // description의 한국어 번역 (없으면 ""). 링크/코드 보존
  aliases: string[]        // 예: ["/reset", "/new"]
  searchText: string       // 마크다운/링크 제거한 순수 검색 텍스트
}

export interface Dictionary {
  fetchedAt: string        // ISO timestamp
  sources: string[]        // 수집한 문서 URL 목록
  count: number
  entries: Entry[]         // name 오름차순 정렬 (안정적 diff)
}
```

---

## 5. 데이터 수집 파이프라인

### 5.1 소스 A — 빌트인 명령어 (`fetch-commands.ts`)
- URL: `https://code.claude.com/docs/en/commands.md`
- commands.md의 마크다운 표를 파싱. 각 행은 `` | `/cmd <arg>` | 설명 | `` 형식.
- 행에서 추출: `name`, `args`, `hasRequiredArg`, `description`, `aliases`, `searchText`, `type='command'`.

### 5.2 소스 B — 번들 스킬 (`fetch-skills.ts`)
- URL: `https://code.claude.com/docs/en/skills.md`
- "## Bundled skills" 섹션(다음 `##` 전까지)만 잘라 처리:
  1. "Run and verify your app" 표 → `/run`, `/verify`, `/run-skill-generator` (이름+설명)
  2. 본문 인라인 `` `/x` `` 패턴(예: "including `/code-review`, `/batch`, …") → 표에 없는 것은 `description="Bundled skill"`
- 모든 항목 `type='skill'`.

### 5.3 파싱 규칙 / 함정 (실제 겪은 버그 포함)
> 아래는 회귀 방지를 위한 **명시 규칙**. 코드 수정 시 반드시 유지할 것.

1. **별칭 정규식은 `/Alias(?:es)?:/i`** 를 쓴다.
   `/Aliases?:/` 는 "Aliase"가 필수가 되어 단수 "Alias:"에 매칭 실패한다.
   별칭은 키워드 위치 뒤 ~60자 내에서 `/[\w-]+` 패턴으로 수집한다.
   - 예: `Alias: \`/bg\`` → `["/bg"]`, `Aliases: \`/reset\`, \`/new\`` → `["/reset","/new"]`
2. **표 행은 백틱 우선 셀로 판별**한다. 정규식
   `` /^\s*\|\s*`([^`]+)`\s*\|(.*)\|\s*$/ `` —
   첫 셀을 백틱으로 잡고, 설명은 "마지막 파이프까지"로 잡아서
   설명 셀 안의 이스케이프된 파이프(`\|`)나 `[a|b]` 표기에도 깨지지 않는다.
   - 예: `` `/advisor [model\|off]` `` → name `/advisor`, args `[model|off]`
3. **상대링크 절대경로화**: 설명 안의 `](/en/...)` → `](https://code.claude.com/docs/en/...)`
4. **MDX 주석 제거**: `{/* min-version: 2.1.x */}` 같은 인라인 마커는 설명에서 제거.
5. **searchText**: 링크는 텍스트만, 인라인 코드/강조 마커 제거한 순수 텍스트.

### 5.4 머지 규칙 (`build-index.ts`)
- 번들 스킬(`/code-review`, `/loop`, `/verify` 등)은 **commands.md에도 존재**한다.
- **이름 기준 dedup**:
  - 이름이 양쪽에 있으면 → `type`을 `skill`로 바꾸고 별칭을 합집합.
    설명은 더 **풍부한(긴) 실제 설명**을 유지 (commands.md 쪽이 보통 더 상세).
  - 소스 B에만 있는 스킬은 그대로 추가.
- 최종 `entries`는 **name 오름차순 정렬**(안정적 diff).

### 5.5 무결성 가드
- `commands.length < 30` 또는 `skills.length < 3` 이면 에러로 종료(문서 구조 변경 감지).
- 이전 `entries.json` 과 `entries` 배열만 비교(`fetchedAt` 제외)해 변경 여부를 로그로 출력.
- 변경이 없으면 이전 `fetchedAt` 을 유지(byte-identical write)해 CI에서 빈 커밋이 생기지 않게 함.

### 5.6 설명 번역 (EN→KO, DeepL Free)
- `scripts/lib/translate.ts` 가 DeepL Free(`api-free.deepl.com`)로 설명을 번역.
- **마크다운 보존**: 텍스트를 escape 후 인라인 코드와 링크 URL을 `<x>…</x>` 로 감싸고
  `tag_handling=xml&ignore_tags=x` 로 보냄 → 링크 텍스트만 번역되고 URL·코드는 그대로.
- **증분 + 캐시**: 영어 `description` 이 직전과 동일하면 이전 `descriptionKo` 재사용(API 호출 0).
  바뀐/새 항목만 번역 → 월 사용량이 무료 한도(50만 자) 안에서 사실상 0에 수렴.
- **키 선택적**: `DEEPL_API_KEY` 없으면 번역 건너뜀(기존 KO 유지), 수집은 정상.
- 번역이 있으면 그 평문을 `searchText` 에 덧붙여 **한국어 검색**도 매칭되게 함.

---

## 6. 검색 알고리즘 (`packages/core/src/search.ts`)

```ts
export function search(entries: Entry[], query: string): { entry: Entry; score: number }[]
```

### 6.1 점수 체계 (단어 1개 기준)
| 매칭 위치 | 점수 |
| --- | --- |
| 이름 정확 일치 | 100 |
| 이름 접두 일치 | 50 |
| 이름 부분 포함 | 30 |
| 별칭 포함 | 20 |
| 설명(searchText) 포함 | 8 |
| 어디에도 없음 | 0 |

- **슬래시 정규화**: 비교 시 이름·쿼리·별칭의 선행 `/` 를 제거한다.
  사용자는 `clear`로 검색하지 `/clear`로 검색하지 않으므로, `clear` → `/clear` 가 100점이 되도록 한다.

### 6.2 조합 규칙
- 여러 단어는 **AND**: 모든 단어가 어딘가 매칭돼야 결과에 포함. (한 단어라도 0점이면 제외)
- 총점 = 단어별 점수의 합.
- 정렬: **점수 내림차순**, 동점이면 **이름 오름차순**.
- 빈 쿼리: 전체를 score 0으로, 이름 오름차순 반환.

### 6.3 검증 예시
```
clear         => /clear(100)
mod           => /model(50)
review        => /review(100), /code-review(30), /security-review(30)
model effort  => /effort(108), /model(108)      // AND, 두 단어 합산
/bg           => /background(20)                 // 별칭, 슬래시 무시
zzzznope      => (없음)
```

---

## 7. 웹앱 (`apps/web`)

### 7.1 기능
- `./data/entries.json` fetch → 렌더링. 검색은 **core의 `search` 사용**(UI는 그리기만).
- **필터 탭**: 전체 / 명령어 / 스킬 (type 필터).
- 스킬엔 청록 `SKILL` 뱃지, 명령어엔 muted `CMD` 뱃지.
- 검색어 하이라이트(`<mark>`), 결과 카운트 `N / 전체`.
- 인자 색상: `<req>` 금색, `[opt]` 청색.
- 별칭 표시, 설명의 인라인 `code`/링크 렌더링.
- `/` 키로 검색창 포커스, 입력 debounce 80ms.
- 헤더 메타: 총 항목 수, 마지막 업데이트 날짜, 출처.

### 7.2 보안 (XSS 방지) — 필수
1. 모든 동적 텍스트는 **먼저 `escapeHtml`** 적용.
2. 하이라이트(`<mark>`)는 **이스케이프된, 태그 없는 텍스트 노드에만** 삽입.
3. 링크는 **`http(s)` 만** 앵커로 렌더링, 그 외 스킴은 텍스트로 표시.
4. `target="_blank"` 에는 `rel="noopener noreferrer"`.

### 7.3 다국어 (i18n)
- 우상단 **EN / 한국어** 토글. 기본값은 브라우저 언어 감지, 선택은 `localStorage('claudex-lang')` 저장.
- UI 문자열은 `I18N` 테이블(en/ko)로 즉시 전환.
- 설명은 `lang==='ko' && descriptionKo` 면 한국어, 아니면 영어 원문(폴백).

### 7.4 디자인
- 터미널/CLI 도감 컨셉. 모노스페이스, 다크 배경(`#0d0e11`), 슬래시(`/`)에 테라코타(`#d97757`) 액센트,
  깜빡이는 커서, 아주 약한 스캔라인. `prefers-reduced-motion` 에서 애니메이션 정지.
- 카피: "N entries registered", "updated daily".

### 7.5 빌드 / 경로
- Vite, `base: './'` → GitHub Pages 프로젝트 경로(`/<repo>/`) 하위에서도 동작.
- 데이터 경로는 `${import.meta.env.BASE_URL}data/entries.json`.

---

## 8. 자동화 (`.github/workflows/sync.yml`)

- 트리거: `cron: "0 0 * * *"`(매일) + `workflow_dispatch`(수동).
- 단계: checkout → pnpm/Node 22 셋업 → `pnpm install --frozen-lockfile` → `pnpm sync`.
- `packages/core/data/entries.json` 및 web 복사본이 **변경됐을 때만** `github-actions[bot]` 명의로 자동 커밋·푸시.
- `permissions: contents: write`.

---

## 9. 빌드 / 실행

```bash
pnpm install
pnpm sync       # 수집 → entries.json 생성 + web으로 복사
pnpm dev        # 웹앱 개발 서버
pnpm build      # core 타입체크 + web 정적 빌드(apps/web/dist)
pnpm typecheck  # 전체 타입체크
```

- 스크립트 실행은 `tsx` (`tsx scripts/build-index.ts`).
- TS 설정: ESM, strict, target ES2022, `moduleResolution: bundler`.
- core의 `exports` 는 소스(`src/index.ts`)를 가리키며, Vite/tsx가 TS를 직접 번들/실행한다.

---

## 10. 배포 (GitHub Pages)

1. `pnpm sync && pnpm build:web` → `apps/web/dist` 생성.
2. Settings → Pages 에서 `apps/web/dist` 결과물을 서빙
   (gh-pages 브랜치 배포 또는 Actions Pages 워크플로 추가).
- `entries.json` 원본은 `packages/core/data`, 배포 복사본은 `apps/web/public/data`.

---

## 11. 로드맵 (지금은 구현 안 함, 구조만 대비)

| 순위 | 항목 | 메모 |
| --- | --- | --- |
| 1 | **SDK 기반 최신 수집** | 설치된 Claude Code의 `system/init` 메시지 `slash_commands` 배열을 소스 C로 추가. build-index가 머지 구조라 끼워넣기만 하면 됨. |
| 2 | **변경 이력 타임라인** | 매일 diff를 기록해 "언제 무엇이 추가/삭제됐는지" 표시. 도감의 차별화 포인트. |
| 3 | **데스크탑 앱 (Tauri)** | 같은 `index.html` + core 재사용, entries.json 번들해 오프라인 검색. `apps/desktop`. |
| 4 | **크롬 확장** | popup/새 탭으로 도감. CSP 때문에 entries.json을 확장 내부에 번들. `apps/extension`. |

설계 불변식: **검색 로직·타입·데이터는 core에 유지**. 새 앱/소스는 core를 재사용하거나 build-index에 머지로 끼운다.

---

## 12. 현재 상태 (2026-06-20)

- ✅ `packages/core` (types, search, index) — 타입체크 통과
- ✅ `scripts` (fetch-commands, fetch-skills, build-index) — `pnpm sync` 정상, 98 entries(스킬 8)
- ✅ `apps/web` — `pnpm build:web`/`pnpm dev` 정상, 데이터 로드·검색 경로 확인
- ✅ `.github/workflows/sync.yml`, README, 본 SPEC 문서
- ⏳ GitHub 레포 생성/푸시, Pages 배포 — 미진행
