# Buildroot guest 재현 recipe

`buildroot-pyproc-i686.bin` 공식 guest 자산을 다시 만드는 자체 빌드 경로다. Buildroot
`2025.02.16` tag의 exact commit, 저장된 i686 config, `SOURCE_DATE_EPOCH`, UTC locale을 고정한다.
`linux.fragment`는 v86의 9P virtio와 VT console driver를 고정하고, `rootfsOverlay/`는
`host9p`를 `/mnt/web`에 mount하며 serial/VGA shell을 분리한다.

Linux 또는 WSL에서 Buildroot 필수 host package를 설치한 뒤 실행한다.

```sh
npm run assets:buildroot
```

산출물은 `.cache/buildrootGuest/dist/`에 생긴다.

- `buildroot-pyproc-i686.bin`: initramfs가 포함된 v86용 bzImage
- `build-manifest.json`: source/config/output digest 영수증
- `buildroot.cyclonedx.json`: Buildroot `show-info` 기반 SBOM
- `output/legal-info/`: source, license, manifest, 경고

허용 목록 밖 `legal-info` warning, `unknown`, `not saved`가 하나라도 있으면 빌드는 실패한다.
Buildroot archive 자체는 recipe의 exact SHA-256으로 별도 전달되므로 legal-info가 내는
`WARNING: the Buildroot source code has not been saved` 한 줄만 manifest의 `acceptedNotices`에
남는다. 빌드 성공만으로 현재 catalog 자산을 자동 교체하지 않는다.

2026-07-26 GitHub run `30182336754`에서 서로 독립된 두 build가 SHA-256
`c3fc456de757e333a3fe543fb126d6aeddda19835e1a6fda187b27f1ce56a606`으로 일치했고, 2026-08-01
후보 이미지가 Python-Linux packet과 process cold restore probe 15/15를 통과했다. 2026-08-01
`buildroot-pyproc-i686-v1` GitHub Release에 image, exact source archive, complete legal-info,
CycloneDX, config, build/repro manifest를 함께 게시했다. `releaseAssets.json`이 7개 자산의
이름, 크기, SHA-256을 하나로 묶고, catalog가 그 manifest 자체의 SHA-256을 고정한다.
