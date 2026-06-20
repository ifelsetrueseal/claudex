# claudex

**Claude Code 슬래시 명령어 & 번들 스킬 도감 (dex).**

Claude Code의 빌트인 슬래시 명령어와 번들 스킬을 공식 문서에서 **매일 자동 수집**해
정적 웹앱으로 검색·열람하게 해주는 도구입니다. Pokédex처럼 항목을 자동 등록·색인하는 컨셉.
사용자는 Claude Code 설치 없이 웹페이지에서 검색만 하면 됩니다.

> 비공식 도구입니다. 데이터 출처는 [Anthropic 공식 문서](https://code.claude.com/docs/en/commands)이며,
> 수집은 전부 GitHub Actions에서 일어나고 사용자에게는 인증·API 키·비용이 전혀 없습니다.

📄 설계·구현 상세는 **[개발 스펙 문서 (docs/SPEC.md)](docs/SPEC.md)** 참고.

## 구조 (모노레포)

```
claudex/
├── packages/
│   └── core/                 # 공유 패키지: 데이터 + 검색 로직 (플랫폼 독립)
│       ├── data/entries.json #   수집 결과 (single source of truth)
│       └── src/              #   types.ts, search.ts, index.ts
├── apps/
│   └── web/                  # 정적 웹앱 (Vite). core를 import해 검색
│       └── public/data/      #   core/data 의 배포 복사본
├── scripts/                  # 수집·머지 스크립트 (tsx로 실행)
│   ├── fetch-commands.ts     #   소스 A: 빌트인 명령어
│   ├── fetch-skills.ts       #   소스 B: 번들 스킬
│   └── build-index.ts        #   머지 → entries.json 생성/복사
└── .github/workflows/sync.yml
```

검색 로직과 타입은 **반드시 `packages/core`** 에 두고, 앱은 그것을 재사용합니다.
플랫폼 의존 코드(DOM, fetch 경로 등)는 core에 넣지 않습니다.

### 향후 확장 (구조만 대비)

- `apps/desktop` — Tauri 데스크탑 앱. 같은 core + entries.json 번들로 오프라인 검색.
- `apps/extension` — 크롬 확장. CSP 때문에 entries.json을 확장 내부에 번들.

둘 다 `packages/core` 의 검색 로직과 데이터를 그대로 재사용합니다.

## 데이터 소스

| 소스 | URL | 내용 |
| --- | --- | --- |
| A | `https://code.claude.com/docs/en/commands.md` | 빌트인 슬래시 명령어 표 |
| B | `https://code.claude.com/docs/en/skills.md` | "Bundled skills" 섹션의 번들 스킬 |

`build-index`는 두 소스를 머지합니다. 번들 스킬은 commands.md에도 나타나므로 이름으로
중복을 제거하고, 해당 항목은 `type`을 `skill`로 표시하되 더 풍부한 설명을 유지합니다.
파싱 결과가 비정상적으로 적으면(문서 구조 변경 감지) 에러로 종료합니다.

**수집 주기:** 매일 09:00 KST (00:00 UTC). 변경분이 있을 때만 자동 커밋됩니다.
수동 실행은 GitHub Actions의 `sync` 워크플로 `Run workflow` 로 가능합니다.

## 로컬 실행

요구사항: **Node 22+**, **pnpm**.

```bash
pnpm install
pnpm sync     # 문서 수집 → packages/core/data/entries.json 생성 + web으로 복사
pnpm dev      # 웹앱 개발 서버
```

기타 스크립트:

```bash
pnpm build      # core 타입체크 + web 정적 빌드 (apps/web/dist)
pnpm build:web  # web 만 빌드
pnpm typecheck  # 전체 타입체크
```

## 다국어 (English / 한국어)

웹앱 우상단에서 **EN / 한국어** 토글로 언어를 바꿀 수 있습니다 (브라우저 언어 자동 감지 +
`localStorage` 저장). UI 텍스트는 즉시 전환되고, 명령어 설명은 한국어 번역이 있으면 그걸,
없으면 영어 원문을 보여줍니다.

### 설명 자동 번역 (DeepL Free, 선택)

`build-index` 는 `DEEPL_API_KEY` 가 설정돼 있으면 **바뀐 설명만 EN→KO 번역**(증분 + 캐시)해
`entries.json` 의 `descriptionKo` 에 저장합니다. 마크다운 링크/인라인 코드는 번역하지 않고 보존합니다.

- 키가 없으면 번역은 건너뛰고(기존 한국어 유지), 나머지 수집은 정상 동작합니다.
- 증분이라 첫 1회(약 2.3만 자) 이후엔 문서가 바뀐 며칠만 소량 번역 → 무료 한도(월 50만 자) 안에서 사실상 0.

**로컬에서 한 번에 채우기:**
```bash
DEEPL_API_KEY=xxxxxxxx:fx pnpm sync   # entries.json 의 descriptionKo 채워짐 → 커밋
```

**GitHub Actions 자동화:** 저장소 Settings → Secrets and variables → Actions 에
`DEEPL_API_KEY` 시크릿을 추가하면 `sync` 워크플로가 자동 번역합니다.

> [DeepL Free API 키](https://www.deepl.com/pro-api) 는 무료로 발급할 수 있습니다 (키 끝이 `:fx`).

## GitHub Pages 배포

`apps/web` 의 정적 빌드 결과(`apps/web/dist`)를 서빙하면 됩니다.

1. `pnpm sync && pnpm build:web` 로 `apps/web/dist` 생성.
   (Vite `base: './'` 라서 프로젝트 페이지 `https://<user>.github.io/<repo>/` 하위 경로에서 동작합니다.)
2. 저장소 **Settings → Pages** 에서 소스를 지정:
   - 간단하게는 `apps/web/dist` 결과물을 `gh-pages` 브랜치로 배포하거나,
   - GitHub Actions Pages 워크플로를 추가해 `pnpm sync && pnpm build:web` 후 `apps/web/dist` 를 업로드.

`entries.json` 은 `packages/core/data` 가 원본이며 `apps/web/public/data` 로 복사됩니다.

## 라이선스 / 출처

비공식 프로젝트입니다. 모든 명령어·스킬 데이터의 출처는 Anthropic의 Claude Code 공식 문서입니다.
