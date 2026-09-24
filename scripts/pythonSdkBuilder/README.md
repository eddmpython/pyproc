# Python 배포 자산 recipe

exact commit 하나에서 Python 배포 자산 전부를 만든다.

- source distribution과 순수 wheel(`py3-none-any`): `pythonSdk/`를 `core.autocrlf=false`로 archive한 임시
  source에서 고정 build 도구로 만든다. protocol client만 싣는다.
- platform wheel(`win_amd64`, `manylinux_2_28_x86_64`): 순수 wheel 내용에 같은 commit의 canonical npm package
  tree와 공식 Node runtime을 더한다. `pyproc-control`과 `pyproc-mcp` console 명령을 가지며, Python client는
  PATH보다 이 wheel 안의 host를 먼저 쓴다.

```sh
npm run package:python -- --tree HEAD --out .cache/python-distributions
```

npm package는 `scripts/packageBuilder`의 canonical recipe로 만들므로 같은 Node 22.19.0과 npm 11.19.0 도구가
필요하다. 번들 Node는 `pythonDistributionLock.json`이 nodejs.org 공식 archive의 SHA-256으로 고정한다. 받은
archive와 `.cache/node-dist`의 archive는 매번 이 값과 대조하고, 다르면 어떤 byte도 wheel로 넘어가지 않는다.
Linux wheel은 Node binary가 요구하는 가장 높은 GLIBC symbol version이 태그가 약속한 glibc 이하일 때만 만든다.

platform wheel은 commit, lock, 순수 wheel 내용만의 함수라 build host가 달라도 byte가 같다.
`python-distribution-reproducibility` workflow가 Ubuntu와 Windows에서 각각 만들고
`verifyPythonDistributions.mjs`로 대조한다. sdist와 순수 wheel의 zip, tar byte는 setuptools와 build host가
정하므로 재현 주장 범위 밖이다.
