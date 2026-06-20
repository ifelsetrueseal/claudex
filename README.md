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
