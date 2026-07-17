# boundary-radius - 경계가 어디까지 같은가

> **폐기 (2026-07-17).** 이 이니셔티브가 재려던 것의 답을 저장소가 이미 갖고 있었다:
> `src/processOs/worker.js`가 "메인과 워커는 힙 길이가 같아도 바이트가 다르다"고 적어놨고,
> 측정은 그걸 기기 축에서 재확인했을 뿐이다(기기 대 기기 184p/480p 상이, 브라우저만 바꿔도
> 178p 상이, 내용은 같고 주소가 다름). 그 숫자는 어떤 제품 결정도 바꾸지 않는다: fork는
> 원래 워커끼리만 했고 머신 이미지는 힙을 통째로 나른다. **조사가 의제를 정하게 놔둔 것이
> 개설 오류다.** 선행조사 기록(아래와 원장)은 이 폴더의 유일한 산출물로 남는다: 발명 서사를
> 죽인 대조 표는 재발 방지 장치다. 측정 장치가 살던 `tests/attempts/boundaryRadius/` 캠페인은
> 질문이 답을 얻어 종결됐고 attempts 수명주기대로 폴더째 삭제됐다(이력은 git, 숫자는 원장).

## 한 문장

**경계의 동일성 반경을 측정하고, 그 반경이 닿는 데까지만 주장한다.**

## 왜 이게 근본인가

이 프로젝트의 논지는 하나다: **상태 = 다시부팅(매니페스트) + 페이지 델타.** 뺄셈이 성립하려면
빼는 쪽과 빼일 쪽의 경계가 같아야 한다. **그 "같음"이 어디까지 미치는지가 이 라이브러리가
주장할 수 있는 것의 전부를 정한다.**

| 반경 | 성립하는 것 | 측정 상태 |
|---|---|---|
| 워커 대 워커 (같은 탭) | `fork`, `forkMany` | **바이트 동일 실측** (`forkLiveProbe` 8/8) |
| 메인 대 워커 (같은 탭) | - | **다름. 실측** (`worker.js:10`: "힙 길이는 같아도 바이트가 다르다") |
| 탭 대 탭 (같은 기기) | `.pymachine` 이동 | **미측정** |
| 기기 대 기기 | 이미지 배포 | **미측정** |
| 버전 대 버전 | 경계 재사용 | **미측정** |

`bootDeterminismProbe`는 `let a = await boot(), b = await boot()`다. **같은 탭에서 두 번**이고,
같은 Chromium, 같은 CPU, 같은 Pyodide 빌드다. **"180페이지 -> 0페이지"는 그 반경 안의 사실이다.**

그리고 우리 자신의 실측이 이미 반례를 갖고 있다: **한 브라우저 안 두 실행 컨텍스트에서도
경계가 갈라진다.** 로더와 컨텍스트가 다르면 바이트가 다르다.

**그러므로 "같은 매니페스트를 쓰는 모두가 같은 경계를 얻는다"는 측정이 아니라 외삽이고,
우리 실측이 반대를 가리킨다.** 반경을 재기 전에는 이동·배포·공유에 관한 어떤 주장도 근거가 없다.

## 세상 대조가 남긴 것 (2026-07-17)

바깥을 정면으로 뒤진 결과, 새롭다고 믿던 것 대부분이 이미 있었다. **발명 서사는 못 버틴다.**

| 주장 | 선행 |
|---|---|
| 계산을 값으로 저장·부활 | **Smalltalk-80 Blue Book 1983**(primitive 97이 "활성 컨텍스트를 반드시 저장하라"고 **규격으로 명령**), Interlisp SYSOUT 1974, CRIU 2011 |
| 스냅샷 트리 + 부모-자식 델타 | **SEUSS(EuroSys 2020)**: "snapshot image를 tree lineage로 유지하고 parent-child 사이 델타만 보관". VM snapshot tree는 20년 |
| 경계 + 델타(메모리) | SEUSS(2020), **Medes(EuroSys 2022)**: 64B 청크 전역 해시 테이블 + base page + "patch and a pointer", BuildBuddy(2026) |
| live fork -> N 레인 | **SnowFlock(EuroSys 2009)**: "VM fork", 부모 상태를 **multicast로 N 자식에 병렬 전파**, 목적이 parallel computing. 우리 `forkMany`(수확 1회 + SAB 방송)와 같은 추상 |
| **경계 = 공공재** | **JVM CDS(JDK 12, 2019)가 지구상 모든 Java 사용자에게 배송 중.** 벤더가 경계를 세상에서 한 번 만들어 JDK에 넣고, mmap으로 모든 프로세스가 공유하고, 앱은 Dynamic CDS "top layer"(= 델타)만 얹는다. **이게 진짜 "경계는 공공재"이고 이미 출시돼 있다** |
| **경계 + 델타(메모리, 언어 런타임)** | **SEUSS(EuroSys 2020)가 우리 문장을 그대로 썼다**: "**JavaScript 인터프리터의 무거운 Snapshot 하나를 base Snapshot으로 쓰고, 이후 Snapshot들은 함수별 메모리 상태만 담는다.**" Snapshot Stack = 각 항목이 앞 항목의 페이지 단위 diff |
| 내용주소 청크 + 공유 base 델타 + 무결성 + **메모리 스냅샷** | **AWS(ATC 2023 Best Paper).** 512KiB 청크를 ciphertext 해시로 명명, convergent encryption, manifest MAC 검증. 논문이 직접 말한다: "**이 같은 시스템이 메모리 스냅샷으로 cold start를 줄이는 Lambda SnapStart에서 스냅샷 내용을 저장·적재하는 데 쓰인다.**" 신규 업로드의 **80%가 고유 청크 0개**, 나머지 평균 4.3% |
| 결정적 메모리 이미지 방법론 | **Node/V8이 2024년에 startup snapshot을 바이트 재현 가능하게 만들었다**(`--random_seed=42 --predictable`, 두 번 생성 후 바이트 비교). Wizer 문서(2021)가 해시 시드를 **바로 그 예시로 경고**한다 |
| "엔트로피 고정" | **Reproducible Builds 표준 플레이북 그대로**(time -> SOURCE_DATE_EPOCH 2015, hash seed -> PYTHONHASHSEED, getentropy -> randomness). RB 정의 문장과 우리 주장은 같은 문장이다. Debian은 2026-05-10에 이걸 **의무화**했다 |
| "레시피가 아니라 물건" | **허수아비.** Nix substituter = "빌드하는 대신 가져오는 store", `cache.nixos.org`가 기본값·기본 신뢰·425TiB. Docker도 Dockerfile이 아니라 내용주소 blob을 배포한다 |
| 브라우저 이동식 이미지, boot 없이 | **v86 `initial_state`, 2014년부터.** copy.sh에 12개 OS 상태 이미지가 라이브다. 결정적으로 **`archlinux`(복원)와 `archlinux-boot`(냉부팅)이 별도 프로필** = **부팅 없는 복원이 기본값이고 냉부팅이 예외**다. PCjs는 2016년에 에뮬레이터+디스크+상태를 **한 파일**로 묶었다(우리보다 자기충족적이다). nanokrnl(**2026-07-03, 14일 전**)은 "Boot / Fast Boot" 버튼으로 같은 걸 한다 |
| 브라우저 내용주소 | **v86이 이미 한다.** 9p 저장소가 inode마다 `sha256sum`을 갖고 blob을 **내용 해시로 fetch**한다(6.6GB 파일시스템에 대해 라이브 검증됨) |
| 브라우저 base 대비 델타 | **v86이 이미 한다.** `AsyncXHRBuffer.get_state`가 **dirty 블록만** 저장한다(디스크 층이지만) |
| 브라우저 공유 base + per-user delta | **WebVM**: "all users access the same disk image from the CDN, with their individual changes being preserved locally" (디스크) |
| **dirty-page 없이 해시로 델타** | **libhashckpt(Sandia, EuroMPI 2011).** 인용: "현행 증분 방식은 **페이지 보호 기제에 의존**해서 크기를 못 줄인다... 페이지 기반 기제만 쓰면 OS 페이지 입도에 갇힌다" -> 답이 **메모리 블록 해싱**이다. **rr도 이미 메모리를 체크섬한다**(목적만 반대: 재구성이 아니라 발산 탐지) |
| WASM 힙을 바이트 동일하게 독립 생산 | **Internet Computer(DFINITY)가 합의로 강제 중.** 독립 머신의 독립 replica가 비트 단위로 일치해야 한다. `wasm_threads(false)`, `cranelift_nan_canonicalization(true)`, 힙은 `vmemory_0.bin`, `manifest.rs`가 SHA-256 청크 해시, 불일치는 `panic_with_replica_diverged_at_height`. **우리 결정성 논지가 출시돼 있고 합의로 집행된다** |
| 내용주소 공유 baseline Pyodide 스냅샷 | **Cloudflare workerd.** `make_snapshots.py`에 `key = "baseline-snapshot/" + hexdigest(file)` |
| "WASM은 ASLR이 없어 스냅샷이 쉽다" | **Pyodide가 2024-05에 직접 발표했다**(0.26 릴리즈): "이 작업은 매 시작마다 하지만 **결과가 매번 같다**", "WebAssembly는 **스냅샷을 몹시 어렵게 만드는 ASLR 같은 보안 기능이 필요없다**" |
| 엔트로피 고정으로 힙 이미지 재현 | **Node/V8, 2024.** `--random_seed=42 --predictable` + **CI 회귀 시험**. Cloudflare는 "poison seed" -> PRNG state 불변 assert -> 복원 후 reseed까지 하고 **위반을 배포 실패로 기계 차단**한다 |
| Web Worker = 프로세스, fork = 힙+PC 복사 | **Browsix(ASPLOS 2017).** 그대로 인용: "C 프로세스가 **fork**를 부르면 런타임이 **C 스택과 힙을 포함한 전역 메모리 배열의 복사본을 현재 PC와 함께** 커널에 보낸다... 커널이 **새 Web Worker**를 띄운 뒤 그 복사본과 PC를 초기화 메시지로 전달한다." **우리 프로세스 OS 기둥이 2017년 논문이다** |
| 브라우저 WASM 힙을 살아있는 채로 기기 이동 | **Jeong et al.(SoCC 2019).** 실행 중 Web Worker를 linear memory 포함해 엣지로 마이그레이션 |
| 힙 수준 파이썬 세션 시간여행 + 브랜치 트리 | **Kishu(PVLDB 18, 2025).** "Checkpoint Graph는 **Git commit graph와 유사한 트리 구조**", 과거로 checkout 후 실행하면 "**새 브랜치**가 생긴다", sub-second. 단 **pickle 층위**(`__reduce__`)이지 raw 힙이 아니고 서버 CPython이다 |
| "히스토리는 트리다" 개념 | **Driscoll-Sarnak-Sleator-Tarjan(STOC 1986).** 절 제목이 "The Version Tree and the Version List", 용어가 "fully persistent", "rooted version tree". **40년 됐다.** JS 구현은 **Worlds(VPRI 2011)** |

**인과도 거꾸로였다.** 결정성은 "세상에 한 번 빌드하고 공유"의 전제가 아니다. Nix는
**input-addressed**라 결정성 **없이** 그걸 한다. 공유는 매니페스트에서 나온 키가 만들고 신뢰는
서명이 준다. **결정성이 사주는 건 델타 주소지정 가능성과 검증 가능성이지 공유가 아니다.**

**그리고 내부 모순이 있었다.** "부팅이 사라진다"를 실현하는 건 경계를 **캐싱·배송**하는
쪽(Wizer/CDS/v86 `initial_state`)이지 **재유도**하는 쪽이 아니다. 리플레이는 부팅 비용을
그대로 낸다.

**"경계 = 공공재"는 이 표에서 두 번 죽는다.** SEUSS(EuroSys 2020)가 그대로 적었다: "런타임
스냅샷은 함수별 정보가 유니커널에 들어오기 **전에** 찍는다. **그래서 서로 다른 사용자의 함수들이
같은 base 스냅샷을 공유할 수 있다.**" 남는 잔여("서로 못 믿는 참가자 + 신뢰 호스트 없음")가
비어 있는 건 부분적으로 **Firecracker가 그걸 insecure라고 부르고 VMware가 꺼버렸기** 때문이다.

### 선행을 못 찾은 것: 둘

1. **이종 guest 둘을 하나의 content-addressed generation에 원자 커밋 후 새 브라우저 프로세스에서
   boot 없이 복원.** 브라우저 에뮬레이터 중 원자적 다중 guest 스냅샷은 없다(v86의
   `two_instances.html`은 두 인스턴스를 host가 교차 배선하면서 `save_state`를 **한 번도 안 부른다**).
   단 개념은 **Chandy-Lamport 1985**이고 VM 클러스터 특허가 있다. **그리고 함정이 있다: 두 guest가
   메시지를 안 주고받으면 일관성 주장은 새로운 게 아니라 공허하다.** 공개 전에 내부에서 결론낸다.
2. **브라우저에서 머신 상태에 서명하는 것.** v86 0건, CheerpX 0건, nanokrnl 0건, env86은 HTTP
   상태코드만 확인, PCjs 0건. **진짜 공백이다. 그러나 발견이 아니라 아무도 안 한 잡일이다**:
   Firecracker 문서가 스냅샷을 "trusted"라 하고 64-bit CRC만 검증하며 "trust boundary를 넘길 때
   인증·암호화를 구현하라"고 **숙제를 이미 내줬다**.

**그리고 1번은 원래 셋이었다.** "dirty-page 추적 없이 해시로 델타 재구성"을 유일한 방어 가능
지점으로 적었다가 지웠다. **libhashckpt가 2011년에 같은 이유로 같은 걸 했다.** 규칙 SSOT가
적어둔 문장("WASM은 mprotect/dirty-page가 없어 실행 경계 해시로 델타를 재구성한다")은 여전히
**우리 설계의 참인 기술**이지만 **발명은 아니다.**

### 진짜 기여(이식)

- **Pyodide의 hiwire 벽 우회.** [#5195](https://github.com/pyodide/pyodide/issues/5195)는 **open**이고 에러가 `Unexpected hiwire entry at index 7`이다. 빈 packages면 성공, 패키지를 로드하면 실패. 상류가 못 하는 걸 리플레이+델타로 한다. **이 저장소는 그 실패 경계를 상류 이슈보다 정밀하게 특정했다**("벽 = loadPackage 기계지 dlopen이 아니다"). **이건 진짜다.**
- SnowFlock의 브라우저판(SAB 방송 fork), VMware 스냅샷 트리 + SnowFlock 동시 라이브 분기의 합성.

### 조사가 내린 진단

> 이 프로젝트는 **자기 의존성(Pyodide)의 생태계는 철저히 조사했고 시스템/OS 문헌은 전혀 안 봤다.**
> Wizer, Faasm, Firecracker, CRIU, gVisor, OSTree, cosign이 저장소에 **전부 0건**이다.

이 이니셔티브가 고칠 것은 코드가 아니라 그 비대칭이다.

## 완료 조건

1. **반경이 수치로 있다.** 최소 두 축을 측정한다: (a) 탭 대 탭(같은 기기) (b) **기기 대 기기**.
   상이 페이지 수가 나온다. **0이 아니면 그 페이지들의 출처가 특정된다 - 그것도 산출물이다.**
2. **반경이 문서에 박힌다.** 능력 매트릭스와 API 문서가 "경계는 이 반경 안에서만 같다"를
   계약으로 말한다. 지금은 아무 데도 그 한정이 없다.
3. **영구 게이트가 반경을 문다.** `enginePort`/`pythonMachine` 폴더가 삭제돼도 증거가 남는다.
4. **우리가 소유한 경계(WASI)도 같은 자로 잰다.** 지금 그 레인은 페이지 결정성이 **미측정**이고
   (파이썬 가시 상태로만 쟀다) 체크포인트가 힙 40MB 통째 복사다(`wasiWorker.js:77`).
   **논지가 우리 엔진에 없다.**
5. **`PYTHONHASHSEED=0` 하자가 계약 실태 표에 오른다.** `bootSession`이 이걸 하드코딩하고
   CPython은 인터프리터 초기화 때 읽으므로 **세션 내내 hash randomization이 꺼진다**
   (CVE-2012-1150 대응책 무력화). V8은 같은 문제를 **역직렬화 때 rehash**로 풀었는데 CPython엔
   그 설비가 없다. 위협 모델상 피해가 자기 탭에 국한되나 트레이드오프는 기록돼야 한다.

## 완료 조건이 아닌 것

- **"경계는 공공재다"를 주장하지 않는다.** JVM CDS가 2019년부터 하고 있고, 우리 반경은 아직
  워커 하나다. 반경이 기기를 넘는 것이 실측되기 전에는 말하지 않는다.
- **기본 엔진을 바꾸지 않는다.** 바꿀 수 없다: `python-3.14.6.wasm`은 export가 **2개**(`memory`,
  `_start`)라 동기 `runSync`를 구현할 호출 지점이 없고, 메모리가 `shared=false`라 메인스레드에서
  `heapU8()`을 못 잡는다(바이너리 직접 파싱). 위상 불일치다. 저장소는 이미 반대를 명문화했다
  (`CHANGELOG`: "production surface는 Pyodide lane").
- **경계를 배포하지 않는다.** 반경을 재기 전에는 배포할 대상이 정의되지 않는다.
- **속도 우위를 주장하지 않는다.** 지금 비교는 저울이 다르고(122ms는 로컬 자산 + 실행 없음,
  3,471ms는 warm CDN + 실제 실행), 공개 표면 숫자 자랑은 강행규칙이 금지한다.

## 정직한 자세

비전 문서는 이미 이 자세로 쓰여 있다("이미 풀린 범주다", "기존 x86 에뮬레이터를 감싼다").
고칠 것은 코드가 아니라 **프레이밍**이다. 서버에서 15년간 확립된 것을 브라우저로 이식했고,
상류가 못 하는 것 하나를 우회했고, 이종 guest 둘의 원자 커밋은 선행을 못 찾았다. **그게
정직한 문장이고, 그것으로 충분하다.**
