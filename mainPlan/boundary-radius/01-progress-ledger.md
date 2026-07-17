# 01 - 진행 원장

재개 지점은 항상 이 문서의 마지막 줄이다.

## 2026-07-17 개설

### 결정 1: "경계는 공공재" 서사를 폐기했다

이 폴더는 원래 그 서사로 열렸다. **바깥을 정면으로 뒤진 결과 무너졌다.** 기각 근거는
[README](README.md)의 대조 표가 정본이고, 결정적인 셋만 적는다.

**JVM CDS가 2019년(JDK 12)부터 지구상 모든 Java 사용자에게 배송 중이다.** 벤더가 경계를
세상에서 한 번 만들어 JDK에 넣고, mmap으로 모든 프로세스가 공유하고, 앱은 Dynamic CDS
"top layer"(= 델타)만 얹는다.

**SEUSS(EuroSys 2020)가 우리 문장을 그대로 썼다.** 인용: "JavaScript 인터프리터의 무거운
Snapshot 하나를 base Snapshot으로 쓰고, 이후 Snapshot들은 함수별 메모리 상태만 담는다."
Snapshot Stack은 각 항목이 앞 항목의 페이지 단위 diff다. **언어 런타임 base + 델타**가 2019년
arXiv, 2020년 EuroSys다.

**AWS는 그걸 메모리 스냅샷에 대해 내용주소로 출시했다**(ATC 2023 Best Paper). 논문 문장:
"이 같은 시스템이 메모리 스냅샷으로 cold start를 줄이는 Lambda SnapStart에서 스냅샷 내용을
저장·적재하는 데 쓰인다." 신규 업로드의 80%가 고유 청크 0개.

**Cloudflare workerd는 정정한다.** 처음에 "공유 base + 사용자별 델타를 출시했다"고 적었는데
**틀렸다.** 소스를 직접 열어보니 `makeLinearMemorySnapshot`이 `encodeSnapshot(Module.HEAP8, ...)`을
부른다 = **baseline이든 dedicated이든 힙 전체**다. `snapshotType`은 메타데이터만 바꾸고,
그 파일에 `hash|sign|digest|delta|diff`가 없다. `soMemoryBases`/`loadOrder` 승계는 **주소
고정**이지 델타 인코딩이 아니다. 즉 **Cloudflare는 공유 baseline은 있지만 사용자별 스냅샷이
전체 이미지고 내용주소도 서명도 없다.** Pyodide 기질 위에서 그 자리는 아직 비어 있다.
다만 **개념이 아니라 엔지니어링의 공백**이다(개념은 SEUSS·AWS가 이미 발표했다).

**이 정정 자체가 이 세션의 교훈이다.** 파일을 안 열고 쓴 문장이 또 나왔고, 이번엔 방향만
반대였다(자기 과소평가). 틀린 건 똑같이 틀린 것이다.

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
| 경계 = 공공재 | **JVM CDS(2019)가 배송 중.** workerd는 공유 baseline이 있으나 델타가 아니다(위 정정) |
| 언어 런타임 base + 함수별 델타 | **SEUSS(EuroSys 2020)**가 문장까지 같다 |
| 내용주소 + 공유 base 델타 + 무결성 + 메모리 스냅샷 | **AWS(ATC 2023 Best Paper)**, SnapStart가 그 청크 저장소를 쓴다고 논문이 명시 |
| live 파이썬 상태의 분기 트리 | **Multiverse Notebook(OOPSLA 2024)**: POSIX fork로 process tree = live 상태 트리, 동시 진행. 단 원문에 `wasm`/`browser` **0회**이고 fork+CoW 전제라 **브라우저 이식 불가** |
| 스냅샷 -> 복원 -> 또 스냅샷 | **Pyodide 자체 테스트 `test_snapshot_stacked`**가 py1->py2->py3 선형 체인을 이미 실증한다 |
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
- **Vizier가 출판한 문제 진술을 WASM이 깬다(우리에게 유리한 유일한 발견).** CIDR 2020 원문:
  "전형적 REPL의 상태는 가변 객체의 복잡한 그래프라 **완전하게 체크포인트하거나 효율적으로
  하거나 둘 중 하나지 동시에는 안 된다.**" 그래서 Vizier는 커널 상태를 아예 포기했고, Kishu는
  pickle로 갔고, Multiverse는 POSIX fork로 갔다. **WASM 선형 메모리는 균일 주소공간이라 통째
  복사가 성립한다** = 그 트레이드오프의 전제가 우리 기질에선 거짓이다. **이건 우리가 영리해서가
  아니라 기질이 달라서다.** 그게 정직한 문장이고, 좁게 주장하면 방어된다.

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

### 캠페인 이름 정정

계획 문서에 `tests/attempts/bootDeterminism/`으로 적었다가 `tests/attempts/boundaryRadius/`로
열었다. 이니셔티브 이름과 맞추고, `pythonMachine/bootDeterminismProbe.html`(같은 탭 축, 닫힌
결과)과 이름이 겹쳐 혼동되는 것을 피한다. 캠페인이 묻는 것은 결정성이 아니라 **반경**이다.

재개 지점: `boundaryRadius/radiusProbe.html`을 브라우저에서 실행해 탭 대 탭 상이 페이지 수를
얻는다(`npm run serve` 후 두 탭). 그다음 그 기록을 커밋해 CI 러너(= 두 번째 기기)가 재계산하게
한다.
