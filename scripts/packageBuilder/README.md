# 게시 package 재현 recipe

working tree는 host의 Git 줄바꿈 설정에 영향을 받는다. 이 recipe는 exact commit을
`core.autocrlf=false`로 archive한 임시 source에서 npm package를 만든다. Node 22.19.0과 npm
11.19.0도 lock에 고정한다.

```sh
npm run package:reproduce -- --tree HEAD --out .cache/canonical-package
```

정식 workflow는 Ubuntu와 Windows에서 각각 pack하고 manifest와 tarball 전체 byte를 대조한다.
`v0.0.23`은 Windows 재현 tarball이 registry tarball과 SHA-256
`084b42764f53269e92c2c9e938d31c27ee62f8120e35d577bc97792ddc3cfc61`로 일치하는 회귀 oracle이다.
publish workflow도 working tree를 직접 게시하지 않고 이 canonical tarball만 게시한다.
