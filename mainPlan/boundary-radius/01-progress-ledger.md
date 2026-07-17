# 01 - 진행 원장

재개 지점은 항상 이 문서의 마지막 줄이다.

## 2026-07-17 개설

### 결정 1: "경계는 공공재" 서사를 폐기했다

이 폴더는 원래 그 서사로 열렸다. **바깥을 정면으로 뒤진 결과 무너졌다.** 기각 근거는
[README](README.md)의 대조 표가 정본이고, 결정적인 셋만 적는다.

**JVM CDS가 2019년(JDK 12)부터 지구상 모든 Java 사용자에게 배송 중이다.** 벤더가 경계를
세상에서 한 번 만들어 JDK에 넣고, mmap으로 모든 프로세스가 공유하고, 앱은 Dynamic CDS
"top layer"(= 델타)만 얹는다.

**Cloudflare workerd가 같은 것을 Pyodide 위에서 출시했다.** 소스에서 직접 확인했다:
`snapshotType: 'baseline' | 'dedicated'`, 그리고 주석 그대로 "stacked snapshot을 만들 때
baseline의 `soMemoryBases`와 `loadOrder`를 포함시켜라". **공유 base + 사용자별 델타를 주소
고정한 채 쌓는 것**이 우리 헤드라인인데 남의 출시된 오픈소스다(2024-04 공표, 2025-12 출시).

**인과가 거꾸로였다.** 결정성은 "세상에 한 번 빌드하고 공유"의 전제가 아니다. Nix는
input-addressed라 결정성 **없이** 그걸 한다. 공유는 매니페스트에서 나온 키가 만들고 신뢰는
서명이 준다. 결정성이 사주는 건 **델타 주소지정 가능성과 검증 가능성**이지 공유가 아니다.

### 결정 2: 우리 자신의 실측이 반례를 갖고 있었다

이게 서사를 죽인 결정타이고, 바깥이 아니라 **우리 저장소 안에 있었다.**

`src/processOs/worker.js:10`: "메인 커널과 워커 커널의 리플레이는 힙 길이는 같아도 **바이트가
다르다**(로더/컨텍스트 차이). 워커 대 워커는 **바이트 동일**하다."

`bootDeterminismProbe.html:35`: `let a = await boot(), b = await boot()` -> **같은 탭에서 두 번**,
같은 Chromium, 같은 CPU, 같은 Pyodide 빌드.

**"180페이지 -> 0페이지"는 그 반경 안의 사실이다.** 한 브라우저 안 두 실행 컨텍스트에서도 경계가
갈라지는데 "같은 매니페스트를 쓰는 모두가 같은 경계를 얻는다"는 측정이 아니라 외삽이고, 우리
실측이 반대를 가리킨다.

### 결정 3: 이 이니셔티브는 짓는 게 아니라 재는 것이다

독립 조사 넷이 각자 다른 문헌(체크포인트/포크, 시간여행/리플레이, 브라우저 에뮬레이터,
컨테이너/Nix)을 뒤지고 **같은 잔여**를 지목했다: 조율 없는 참가자들이 각자 부팅해 **바이트
동일한 경계**에 도달하는 것을 **경계를 전송하지 않고 증명**하기. NOT FOUND. 그리고 넷 다
**"아키텍처가 아니라 실험이 기여"**라고 말했다.

그래서 1단계가 측정 장치다. 상세는 [00-plan.md](00-plan.md).

**두 번째 기기를 살 필요가 없다는 것이 이 계획의 유일한 비자명한 수다: CI 러너가 두 번째
기기다.** 다른 CPU, 다른 커널, 종종 다른 Chromium 빌드. 해시 벡터(약 20KB)를 커밋하고 CI가
재계산하면 그게 기기 대 기기 측정이고 비용이 0이다.

### 폐기한 주장 목록 (다시 꺼내지 않기 위해)

| 주장 | 죽인 것 |
|---|---|
| 경계 = 공공재 | JVM CDS(2019), Cloudflare workerd stacked snapshot(2025 출시) |
| 계산을 값으로 저장·부활 | Smalltalk-80 Blue Book(1983)이 **규격으로 명령**, Interlisp SYSOUT(1974) |
| 스냅샷 트리 + 부모-자식 델타 | SEUSS(2020), VMware 스냅샷 트리(~2004, 문서 제목이 "Linear Versus Process Tree") |
| 경계 + 델타(메모리) | Potemkin(SOSP 2005)이 **"delta virtualization"이라고 직접 명명** |
| live fork -> N 레인 (수확 1회 + 방송) | **SnowFlock(2009)이 측정하고 기각했다**(157.29s vs 자기 설계 70.63s) |
| dirty-page 없이 해시로 델타 | **libhashckpt(Sandia, 2011)**, 같은 이유로 같은 수. rr도 이미 메모리를 체크섬한다 |
| 엔트로피 고정으로 결정적 힙 | **ART `--force-determinism`(2016-01): "identity hashcode seed를 고정해야 한다"**. Node/V8(2024) |
| Web Worker = 프로세스, fork = 힙+PC 복사 | **Browsix(ASPLOS 2017)**, 문장 단위로 같다 |
| 부팅 없는 복원 | **v86 `initial_state`(2014)**, 게다가 **복원이 기본이고 냉부팅이 별도 프로필**. PCjs는 **2012년부터 localStorage 자동 재개** |
| 브라우저 내용주소 / base 델타 | **v86이 이미 한다**(9p sha256 blob, `AsyncXHRBuffer.get_state` dirty 블록) |
| 전체 상태 -> 내용주소 이미지 -> registry -> N회 복원 | **Podman `--create-image`(4.1.0, 2022-05-06)**, 표준 OCI |
| "레시피가 아니라 물건" | 허수아비. Nix substituter, Docker 내용주소 blob |

### 살아남은 것

- **Pyodide hiwire 벽 우회.** [#5195](https://github.com/pyodide/pyodide/issues/5195)는 open이고
  에러가 `Unexpected hiwire entry at index 7`이다. 이 저장소는 그 실패 경계를 **상류 이슈보다
  정밀하게 특정했다**("벽 = loadPackage 기계지 dlopen이 아니다"). 이건 진짜다.
- **이종 guest 둘의 원자 커밋.** 브라우저 에뮬레이터 중 없다(v86 `two_instances.html`은 두
  인스턴스를 교차 배선하면서 `save_state`를 한 번도 안 부른다). 단 개념은 Chandy-Lamport(1985)고,
  **두 guest가 메시지를 안 주고받으면 일관성 주장은 새로운 게 아니라 공허하다.** 공개 전 내부 결론 필요.
- **브라우저에서 머신 상태 서명.** v86/CheerpX/nanokrnl/env86/PCjs 전부 0건. 진짜 공백이지만
  **발견이 아니라 아무도 안 한 잡일**이다(Firecracker가 "trust boundary를 넘길 때 인증·암호화를
  구현하라"고 숙제를 이미 내줬다).
- **그리고 이 이니셔티브가 재려는 것.** 넷이 지목한 잔여.

### 방법 기록: 같은 패턴이 세 번째다

structure-evolution에서 도메인 10폴더안이 순환을 1->9로 늘린다는 것이 실측으로 드러나 폐기됐다.
asset-provenance에서 "원리적 불가"가 바이너리를 1초 열어보니 거짓이었다(커널 6.8.12가 헤더에
있었다). 이번엔 "경계는 공공재"가 **우리 자신의 주석 한 줄**에 부딪혀 죽었다.

패턴이 같다: **그럴듯한 설계가 파일을 열지 않고 쓴 문장 위에 서 있었다.**

그리고 이번엔 새 진단이 하나 더 나왔다.

> 이 프로젝트는 **자기 의존성(Pyodide)의 생태계는 철저히 조사했고 시스템/OS 문헌은 전혀 안 봤다.**
> Wizer, Faasm, Firecracker, CRIU, gVisor, OSTree, cosign이 저장소에 **전부 0건**이다.

hiwire 실패 경계를 상류보다 정밀하게 특정할 만큼 파고든 프로젝트가 SnowFlock을 몰랐다.
**이 이니셔티브가 고칠 것은 코드가 아니라 그 비대칭이다.**

재개 지점: 1단계 착수. `tests/attempts/bootDeterminism/` 캠페인 개설(README + 가설·게이트
명문화)부터.
