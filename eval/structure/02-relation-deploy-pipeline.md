GitHub Actions로 배포 파이프라인을 구성할 때 권장하는 단계는 다음과 같습니다. 각 단계는 앞 단계가 성공해야만 다음으로 넘어가도록 `needs`로 연결하세요.

1. **코드 푸시** — 개발자가 main 브랜치로 PR을 머지하면 워크플로가 트리거됩니다.
2. **린트 및 타입 검사** — ESLint와 `tsc --noEmit`을 실행합니다. 가장 빨리 실패하는 단계라 맨 앞에 둡니다.
3. **단위 테스트** — Vitest로 단위 테스트를 돌립니다. 커버리지 리포트도 이때 업로드합니다.
4. **빌드** — 프로덕션 번들을 만들고 아티팩트로 저장합니다.
5. **스테이징 배포** — 빌드 아티팩트를 스테이징 환경에 올립니다.
6. **E2E 테스트** — Playwright로 스테이징 환경에서 주요 사용자 흐름을 검증합니다.
7. **수동 승인** — `environment: production`에 required reviewers를 설정해 사람이 승인하도록 합니다.
8. **프로덕션 배포** — 승인 후 같은 아티팩트를 프로덕션에 배포합니다.

추가로, 프로덕션 배포 직후에는 **헬스 체크**를 돌리고, 헬스 체크가 실패하면 **자동 롤백**이 실행되도록 구성하는 것이 좋습니다.

예시 워크플로 일부는 아래와 같습니다.

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm lint && pnpm typecheck
  test:
    needs: lint
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
```

> 팁: 의존성 설치 시간을 줄이려면 `actions/setup-node`의 캐시 옵션을 켜세요. 빌드 단계가 눈에 띄게 빨라집니다.
