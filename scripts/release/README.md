# Release asset assembly

검증된 Buildroot artifact와 complete legal-info를 project asset release 한 벌로 조립할 때 다음 명령을
쓴다. 출력은 안전을 위해 저장소 `.cache` 아래만 허용한다. 명령은 manifest의 source archive를 다시
받아 검증하고 base config, profile fragment, kernel fragment, rootfs 입력, legal-info 전체 checksum,
zip, 모든 원본 자산의 크기와 SHA-256을 `releaseAssets.json`에 봉인한다.

```sh
buildCommit="$(git rev-parse HEAD)"
npm run assets:buildroot-release -- \
  --verified-dir .cache/node-release/verified \
  --legal-dir .cache/node-release/legal \
  --tag buildroot-pyproc-node-i686-v1 \
  --target-commit "$buildCommit" \
  --out .cache/node-release/release
```

`--verified-dir`에는 일치가 확인된 image, build manifest, SBOM, reproducibility manifest가 있어야 한다.
`--legal-dir`에는 Buildroot `legal-info` 전체가 있어야 한다. source 또는 license file 누락, 예상하지 않은
warning, config digest 불일치, image digest 불일치는 release directory를 만들기 전에 실패한다.
release target commit은 이중 빌드 reproducibility manifest의 `headSha`와 정확히 같아야 하며, Node profile은
source identity와 실제 target runtime oracle까지 일치해야 한다.
조립은 최종 출력의 형제 임시 작업공간에서 수행하고 legal-info 입력 사본만 봉인한다. 입력 디렉터리는
바꾸지 않으며 모든 검증이 끝난 뒤에만 최종 출력 디렉터리를 교체한다.
Buildroot repository와 source URL은 자격증명 없는 공개 HTTPS여야 하고 exact revision, commit,
source SHA-256, source date epoch가 완결돼야 한다. source archive는 256MiB 상한 아래에서 streaming
수신하며 CycloneDX 1.6 SBOM은 같은 Buildroot version을 가리켜야 한다.
legal ZIP은 외부 archive 명령 없이 Node 표준 라이브러리로 streaming 작성한다. manifest의
`sourceDateEpoch`, 정렬된 파일 목록, CRC32와 저장 방식을 고정해 같은 입력을 다시 조립해도
byte-identical해야 한다.
