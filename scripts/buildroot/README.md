# Buildroot guest 재현 recipe

`buildroot-bzimage68.bin` opaque 자산을 교체하기 위한 자체 빌드 경로다. Buildroot
`2025.02.16` tag의 exact commit, 저장된 i686 config, `SOURCE_DATE_EPOCH`, UTC locale을 고정한다.

Linux 또는 WSL에서 Buildroot 필수 host package를 설치한 뒤 실행한다.

```sh
npm run assets:buildroot
```

산출물은 `.cache/buildrootGuest/dist/`에 생긴다.

- `buildroot-pyproc-i686.bin`: initramfs가 포함된 v86용 bzImage
- `build-manifest.json`: source/config/output digest 영수증
- `buildroot.cyclonedx.json`: Buildroot `show-info` 기반 SBOM
- `output/legal-info/`: source, license, manifest, 경고

`legal-info`에 warning, `unknown`, `not saved`가 하나라도 있으면 빌드는 실패한다. 빌드 성공만으로
현재 catalog 자산을 자동 교체하지 않는다. 서로 독립된 두 build의 output SHA-256가 같고 Web
Computer gate가 새 파일로 통과한 뒤 catalog를 `buildroot-pyproc-i686.bin`으로 승격한다.
