// tests/northStar.mjs - 북극성 축 원장(SSOT). 데이터와 렌더만 산다. 판정은 tests/run.mjs [북극성] 절이 한다.
//
// 왜 원장이 코드인가: 산문 증거는 썩는다. "이 축은 게이트가 있다"는 문장은 그 게이트 파일이
// 개명되거나 삭제되거나 러너에 한 번도 안 꽂혀도 그대로 남는다. 이 저장소에서도 probe 15개가
// 게이트 폴더에 있으면서 아무도 안 돌리던 사건이 있었다.
// 그래서 축마다 실행 가능한 산출물을 등재하고, README 두 판의 표는 여기서 렌더한 문자열이다.
// 문서를 고쳐도 점수는 안 움직이고, 점수를 고치려면 이 파일과 증거 목록을 함께 고쳐야 한다.
//
// lane = 그 증거를 실제로 돌리는 npm script(또는 ci.yml이 직접 부르는 명령을 뜻하는 "ci").
// manual = CI에서 못 도는 증거(헤드리스에 WebGPU 어댑터가 없다, 릴레이를 배송하지 않는다,
// x86 자산이 gitignore다). 수동 증거는 점수를 9점 아래로 묶는다: 사람 기억에만 사는 증거로
// "거의 끝났다"고 주장하지 않는다. 수동 증거가 tests/attempts에 살면 그 폴더를 승격 없이
// 지우는 순간 이 게이트가 RED가 된다. 그것이 의도다(계약 실태 표가 이미 지목한 실패 모드다).
//
// next = 그 축을 다음에 움직이는 수. 축은 "지금 서 있는 자리"(게이트로 고정)와 "도달해야 하는
// 자리"(10점 정의)만으로는 반쪽이다: 둘 사이를 잇는 경로가 원장 밖 산문에 살면 그 경로가 표류한다.
// `rung`을 단 항목은 천장 사다리의 한 단이고(전역 순서 1..N, 벽을 무는 순서), 없는 항목은 그 축
// 국소의 다음 수다. **계획은 증거가 아니다**: next 항목은 path/lane을 갖지 않는다. 한 단이 실현되면
// 그 항목은 next에서 사라지고 evidence가 늘어나며 점수가 움직인다. 그것이 이 원장이 기록하는 졸업이다.
// 각 단의 저장소 내부 수용 조건과 순서는 skills/understand-pyproc/references/vision.md가 정본이다.

export const NORTH_STAR = Object.freeze({
  en: Object.freeze({
    statement: "Make the browser a persistent computer, make Python its default Machine, and make that computer pyproc itself.",
    rule: "Scores measure only capabilities and invariants pyproc owns. Adoption, user counts, release age, other repositories, and market response never score. A path no automated gate runs does not score, and an axis with manual-only evidence stays below 9. A 10 means the capability is complete: repeatedly verified in a real browser, with no workaround left in the public surface.",
    total: (total, max, average) => `Today that is **${total} / ${max}, average ${average} / 10**.`,
    header: "| Axis | Score | Where it stands today | Where it has to land | Next move |",
    divider: "|---|---:|---|---|---|",
    rung: (at) => `rung ${at}`,
  }),
  ko: Object.freeze({
    statement: "브라우저를 영속하는 컴퓨터로 만들고, Python을 기본 Machine으로 삼으며, 그 컴퓨터를 pyproc 자신으로 만든다.",
    rule: "점수는 pyproc이 소유한 능력과 불변식만 잰다. 채택, 사용자 수, 릴리즈 경과, 다른 저장소, 시장 반응은 점수가 아니다. 자동 gate가 돌지 않는 경로는 점수로 세지 않고 수동 증거가 섞인 축은 9점 아래로 묶는다. 10점은 능력이 끝난 상태다: 실제 브라우저에서 반복 검증됐고 공개 표면에 우회로가 없다.",
    total: (total, max, average) => `지금 총점은 **${total} / ${max}, 평균 ${average} / 10**이다.`,
    header: "| 축 | 현재 점수 | 지금 서 있는 자리 | 도달해야 하는 자리 | 다음 수 |",
    divider: "|---|---:|---|---|---|",
    rung: (at) => `${at}단`,
  }),
});

// 천장 사다리의 틀. 단 목록 자체는 축의 next에 살고(단이 어느 축을 움직이는지가 강제된다),
// 여기에는 두 벽의 프레이밍과 정본 링크만 둔다. 벽의 논증은 skills/understand-pyproc/references/vision.md가 정본이다.
export const CEILING_LADDER = Object.freeze({
  en: Object.freeze({
    intro: "The distance that remains is two walls with different fates. The transport wall (a tab accepting an inbound connection) is opening, so it gets climbed in order. The native wall (web content spawning a native process) never opens, by the design of the web itself, so what only local machines run moves inward instead. Every rung names the axis it moves:",
    axis: (title) => `moves: ${title}`,
    outro: "The repo-local acceptance condition and order of every rung are in the [product direction](skills/understand-pyproc/references/vision.md#where-the-ceiling-moves-next). The rungs are registered in the axis ledger, so no outside adoption signal can move a score or reorder the work.",
  }),
  ko: Object.freeze({
    intro: "남은 거리는 운명이 다른 두 벽이다. 전송 벽(탭이 인바운드 연결을 받는 것)은 열리는 중이라 순서대로 오른다. 네이티브 벽(웹 콘텐츠가 네이티브 프로세스를 띄우는 것)은 웹 자체의 설계상 열리지 않으니, 로컬 머신만 돌리는 것은 대신 안으로 옮긴다. 모든 단은 자기가 움직이는 축을 밝힌다:",
    axis: (title) => `움직이는 축: ${title}`,
    outro: "각 단의 저장소 내부 수용 조건과 순서는 [제품 방향](skills/understand-pyproc/references/vision.md#where-the-ceiling-moves-next)에 있다. 단은 축 원장에 등재되므로 외부 채택 신호가 점수나 작업 순서를 움직일 수 없다.",
  }),
});

export const NORTH_STAR_AXES = Object.freeze([
  Object.freeze({
    id: "runPython",
    score: 9.7,
    en: Object.freeze({
      title: "Real Python in the tab",
      state: "`open` is the durable Machine and `boot` is the transient workbench; both drive CPython on WebAssembly. The pinned engine is prepared by the shipped zero-dependency CLI, served from the same origin, checked against catalog and lock hashes, then core-verified again in the browser with zero third-party requests. Browser, installed-package, demo, and agent gates run it. The platform is Chromium and Edge only.",
      target: "The Python a local interpreter runs, running in a tab, with no server and no setup ritual.",
    }),
    ko: Object.freeze({
      title: "탭 안의 진짜 파이썬",
      state: "`open`은 내구 Machine이고 `boot`은 휘발 작업대이며 둘 다 WebAssembly 위 CPython을 몬다. 게시된 무의존 CLI가 pin된 engine을 준비하고, same-origin에서 catalog와 lock hash를 검증한 뒤 브라우저가 core를 다시 검증하며 제3자 요청은 0이다. 브라우저, 설치 패키지, 데모, 에이전트 게이트가 이를 돌린다. 플랫폼은 Chromium과 Edge뿐이다.",
      target: "로컬 인터프리터가 돌리는 파이썬을 서버도 준비 의식도 없이 탭에서 그대로 돌린다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/browser/examples.mjs", lane: "test:examples" }),
      Object.freeze({ path: "tests/browser/mcpSandbox.mjs", lane: "test:mcp" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "broadenBrowserPlatform",
        en: "Broaden the browser platform without weakening the Machine contract or hiding unavailable capabilities",
        ko: "Machine 계약을 약화하거나 없는 능력을 숨기지 않고 브라우저 플랫폼 범위를 넓힌다",
      }),
    ]),
  }),
  Object.freeze({
    id: "timeTravelState",
    score: 9.3,
    en: Object.freeze({
      title: "State you can rewind",
      state: "Checkpoint, restore, branch, and prune run at execution boundaries over complete heap hashing: a full-heap byte-equality round trip, sibling-delta isolation across a branch tree, and a violated boundary that falls back to a full rehash instead of restoring something corrupt. History is a first-class value beyond the session: named durable branches with provenance notes, adopt as the consuming verb (heap states cannot merge), serial attempts that race candidate solutions without contamination, and daily auto milestones that make going back to yesterday one verb - on the single-controller journal and on the elected durable machine through the same exactly-once command pipeline. Node property and fuzz gates cover delta soundness, tree integrity, and ref-protocol branch laws. An arbitrary instant is still not capturable, because in-flight promises and network requests live outside the boundary.",
      target: "Any past state comes back instantly, including the work that was in flight when it was left.",
    }),
    ko: Object.freeze({
      title: "되감을 수 있는 상태",
      state: "체크포인트, 복원, 분기, 가지치기가 완전 힙 해시 위에서 실행 경계마다 돈다: 전 바이트 동일 full-heap 왕복, 분기 나무의 형제 델타 격리, 경계를 어겼을 때 오염된 복원 대신 전체 재해시로 물러나는 경로까지 게이트가 문다. 역사는 세션 너머의 1급 값이다: 이름 있는 내구 가지와 provenance note, 채택(adopt)이라는 소비 동사(힙 상태는 병합이 성립하지 않는다), 오염 없이 후보를 경쟁시키는 직렬 attempts, 어제로 돌아가기를 동사 하나로 만드는 일일 자동 이정표가 단일 컨트롤러 저널과 선출 내구 머신 양쪽에서 - 같은 정확히 한 번 명령 파이프라인으로 - 돈다. 델타 건전성, 나무 무결성, ref 프로토콜 가지 법은 Node property/fuzz 게이트가 덮는다. 임의 순간의 포획은 아직 아니다: 진행 중인 promise와 네트워크 요청은 경계 밖에 산다.",
      target: "떠날 때 진행 중이던 작업까지 포함해 과거의 어느 상태든 즉시 돌아온다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "arbitraryInstantCapture",
        en: "Capture an arbitrary instant rather than an execution boundary, by pulling in-flight promises and requests inside the boundary",
        ko: "실행 경계가 아니라 임의 순간을 포획한다: 진행 중인 promise와 요청을 경계 안으로 들인다",
      }),
    ]),
  }),
  Object.freeze({
    id: "parallelProcesses",
    score: 8.6,
    en: Object.freeze({
      title: "Processes and real parallelism",
      state: "Workers are processes: snapshot-fork spawn, `map`, `forkMany`, a signal table, kill, job control, nested containers, pool exhaustion, and mid-flight worker death all converge under the browser gate. N interpreters are N GILs, so the parallelism is structural rather than scheduled. The installed engine build-seals a versioned `worker-processes` thread capability: its WASM memory is not shared, it has no thread spawn import, and CPython reports `pthread-stubs` with the exact thread-creation failure. There is no shared-memory threading and no arbitrary POSIX process tree.",
      target: "A process model with the vocabulary of a real operating system, threads included once the platform allows them.",
    }),
    ko: Object.freeze({
      title: "프로세스와 진짜 병렬",
      state: "워커가 프로세스다: 스냅샷 fork 생성, `map`, `forkMany`, 시그널 표, kill, 잡 컨트롤, 중첩 컨테이너, 풀 소진, mid-flight 워커 사망까지 브라우저 게이트에서 수렴한다. 독립 인터프리터 N개 = 독립 GIL N개라 병렬성이 스케줄이 아니라 구조에서 나온다. 설치 엔진은 versioned `worker-processes` thread capability를 build에 봉인한다. WASM memory는 비공유이고 thread spawn import가 없으며 CPython은 `pthread-stubs`와 정확한 thread 생성 실패를 보고한다. 공유 메모리 스레딩과 임의의 POSIX 프로세스 트리는 없다.",
      target: "진짜 운영체제의 어휘를 가진 프로세스 모델. 플랫폼이 허락하는 순간 스레드까지.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/browser/examples.mjs", lane: "test:examples" }),
      Object.freeze({ path: "tests/browser/ownedEngineCoreProduct.html", lane: "owned-engine" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "sharedMemoryThreads",
        en: "Replace the build-sealed worker-process boundary only when shared WASM memory, a thread spawn import, Python thread join, and checkpoint quiescence pass one product gate",
        ko: "공유 WASM memory, thread spawn import, Python thread join과 checkpoint quiescence가 한 제품 gate를 통과할 때만 build에 봉인된 worker-process 경계를 교체한다",
      }),
    ]),
  }),
  Object.freeze({
    id: "durableDisk",
    score: 9.2,
    en: Object.freeze({
      title: "A disk that survives",
      state: "The state kernel commits content-addressed generations into OPFS under a write-order law: a tampered blob is caught, a broken HEAD falls back to PREV instead of impersonating a first boot, journals pack, and an unchanged re-commit writes zero bytes. A versioned browser-storage receipt now distinguishes persistent from best-effort mode and marks usage and quota as rough estimates. A forced quota failure returns one stable code, preserves prior state, and removes the false empty object created before the failed write. After a total OPFS clear, a receipt retained outside the origin turns silent first boot into an explicit eviction error. The browser cannot recover the deleted bytes from the deleted bucket, so recovery still requires an external Machine copy.",
      target: "Durability with the guarantees of a real filesystem: no torn commit, no silent loss, exactly one format.",
    }),
    ko: Object.freeze({
      title: "살아남는 디스크",
      state: "상태 커널이 내용 주소 세대를 쓰기 순서 법 아래 OPFS에 커밋한다: 변조된 blob은 적발되고, 파손된 HEAD는 첫 부팅을 위장하지 않고 PREV로 후퇴하며, 저널은 pack되고, 바뀐 것이 없는 재커밋은 0바이트를 쓴다. 이제 versioned browser-storage 영수증이 persistent와 best-effort를 구분하고 usage와 quota가 거친 추정임을 밝힌다. 강제 quota 실패는 한 안정 code로 끝나며 기존 상태를 보존하고 쓰기 전 생성된 거짓 빈 object를 제거한다. OPFS 전체 삭제 뒤에는 origin 밖에 보관한 영수증이 조용한 첫 부팅을 명시적 축출 오류로 바꾼다. 지워진 bucket 스스로는 바이트를 복구할 수 없으므로 복구에는 외부 Machine 사본이 필요하다.",
      target: "진짜 파일시스템의 보장을 가진 내구성: 찢어진 커밋 없음, 조용한 손실 없음, 포맷은 하나.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/generationContractProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
      Object.freeze({ path: "tests/browser/storageDurabilityProduct.mjs", lane: "test:storage-durability" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "evictionRecoveryCopy",
        en: "Bind an external Machine copy to the eviction witness and restore it after a total browser bucket clear",
        ko: "외부 Machine 사본을 축출 witness에 묶고 browser bucket 전체 삭제 뒤 그 사본으로 복구한다",
      }),
    ]),
  }),
  Object.freeze({
    id: "survivesTabDeath",
    score: 9.7,
    en: Object.freeze({
      title: "A machine that outlives its tab",
      state: "Argument-free `open()` now enters the named OPFS Machine rather than a transient kernel. Commands and commits are serialized, and every completed run reaches a generation carrying heap, `/home/web`, and forwarded outcome before settling; the installed package cold-reopens that state without a manual commit. Leader election spans same-origin tabs, a repeated request ID is answered from its durable record, and commit failure is non-retryable outcome-unknown. A normal follower still cannot prove a cut-off leader heap portable, so failover of an in-flight call remains `PYPROC_RPC_OUTCOME_UNKNOWN`. The complete rule is the [durable RPC state table](skills/use-pyproc-runtime/references/consumer-contract.md#durable-rpc-state-table-normative).",
      target: "The machine keeps running while any tab is open, and every command it accepted resolves exactly once.",
    }),
    ko: Object.freeze({
      title: "탭보다 오래 사는 머신",
      state: "인자 없는 `open()`이 휘발 kernel 대신 이름 있는 OPFS Machine으로 들어간다. 명령과 commit은 직렬화되고, 완료된 run은 heap, `/home/web`, 전달된 outcome을 실은 generation에 도달한 뒤 settle된다. 설치 package는 수동 commit 없이 그 상태를 cold reopen한다. leader 선출이 동일 origin tab을 가로지르고 반복 request ID는 durable record로 답하며 commit 실패는 non-retryable outcome-unknown이다. 일반 follower는 끊긴 leader heap의 이식성을 증명할 수 없으므로 in-flight failover는 여전히 `PYPROC_RPC_OUTCOME_UNKNOWN`이다. 전체 규칙은 [durable RPC 상태표](skills/use-pyproc-runtime/references/consumer-contract.md#durable-rpc-state-table-normative)다.",
      target: "탭이 하나라도 열려 있는 동안 머신은 계속 살고, 받아들인 명령은 정확히 한 번 수렴한다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "revivedKernelServesReplay",
        en: "Carry a fenced portability fact to ordinary followers so they can safely use the outcome-record path; a proxy-bearing heap remains outcome-unknown",
        ko: "fenced portability fact를 일반 follower에게 전달해 outcome-record 경로를 안전하게 쓰게 한다. proxy-bearing heap은 outcome-unknown으로 남는다",
      }),
    ]),
  }),
  Object.freeze({
    id: "portableMachineImage",
    score: 9.0,
    en: Object.freeze({
      title: "A machine you can carry",
      state: "`.pymachine` and `.webmachine` files are signed content-addressed envelopes: signature and trusted-key verification, byte-tamper rejection, layout-independent reparse, worker-to-worker revival, and a cross-context transport refused on an `h0` mismatch instead of opened silently. The product gate exports a signed image and imports it into a fresh browser profile behind an explicit signer trust screen. Portability still assumes the same engine and manifest. A JS proxy handle cannot cross an image at all, so a surface that installs one poisons every proxy path in the revived kernel; the packet device and the permission jail were moved to value boundaries and survive a revival in CI, while a blocking surface (the syscall bridge behind input(), sockets, GPU) cannot move and is refused at export unless the caller acknowledges it.",
      target: "A machine file verifies and revives offline in a clean profile under one explicit execution contract; every mismatch is rejected with an actionable error.",
    }),
    ko: Object.freeze({
      title: "들고 다니는 머신",
      state: "`.pymachine`과 `.webmachine`은 서명된 내용 주소 봉투다: 서명과 신뢰 공개키 검증, 바이트 변조 거부, 레이아웃 독립 재파싱, 워커 사이 부활, 문맥을 건너는 이식은 조용히 열리는 대신 `h0` 불일치로 거부된다. 제품 게이트가 서명 이미지를 내보내고 새 브라우저 프로필에서 명시적 서명자 신뢰 화면을 거쳐 가져온다. 이식성은 아직 같은 엔진과 같은 매니페스트를 전제하고, JS 프록시 핸들은 이미지를 건너지 못해서, 프록시를 심는 표면은 부활 커널의 프록시 경로 전부를 오염시킨다. packet 장치와 권한 감옥은 값 경계로 옮겨 부활 뒤에도 살아나는 것을 CI가 물지만, 블로킹 표면(input() 뒤의 syscall 다리, socket, GPU)은 구조상 옮길 수 없어 이미지를 뜰 때 명시 승인 없이는 거부된다.",
      target: "머신 파일이 명시된 실행 계약 아래 새 프로필에서 오프라인으로 검증·부활하고, 모든 불일치는 행동 가능한 오류로 거부된다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "handlesSurviveMaterialisation",
        en: "Rebind JS handles after materialisation, or find a blocking mechanism that needs none, so a machine that used input() can still ship a portable image",
        ko: "물질화 뒤 핸들을 다시 묶는 엔진 층 길이나 핸들 없는 블로킹 기전을 찾아, input()을 쓴 머신도 이식 가능한 이미지를 내게 한다",
      }),
      Object.freeze({
        id: "offlineCleanProfileRevival",
        en: "Prove offline signed-image revival in a clean browser profile while rejecting every engine or manifest mismatch",
        ko: "새 브라우저 프로필에서 서명 image의 오프라인 부활을 증명하고 engine 또는 manifest 불일치를 모두 거부한다",
      }),
    ]),
  }),
  Object.freeze({
    id: "multiGuestComputer",
    score: 9.0,
    en: Object.freeze({
      title: "A computer that boots guests",
      state: "The Web Machine host lives inside this package behind `createWebComputer`, and Python and x86 Linux guests use the same lifecycle, device, generation, and envelope contracts. Host contract, dual-engine, owner succession, durable generation, and guest-network probes run in CI, and the product gate boots both guests, survives a browser-process restart, and moves the pair as one signed image. The x86 lane puts the real Python and Linux guests on one switch: Linux pings Python, a Python-sent Ethernet frame increments Linux's NIC receive counter, and both directions survive one generation commit and a process cold restore. A guest can also run in its own worker (`pyproc-worker`), so a CPU-bound guest no longer stalls the others. The reproducible Linux build is checked against exact source, legal inventory, SBOM, config, and an independent byte-identical build receipt.",
      target: "Any guest with an adapter boots on the browser computer, and its image ships as freely as the host does.",
    }),
    ko: Object.freeze({
      title: "guest를 부팅하는 컴퓨터",
      state: "Web Machine host가 `createWebComputer` 뒤에서 이 패키지 안에 살고, Python guest와 x86 Linux guest가 같은 lifecycle, 장치, 세대, 봉투 계약을 쓴다. host 계약, dual-engine, owner 승계, 내구 세대, guest 네트워크 probe가 CI에서 돌고, 제품 게이트는 두 guest를 부팅해 브라우저 프로세스 재시작을 견디고 둘을 한 서명 image로 옮긴다. x86 레인은 실제 Python과 Linux guest를 한 switch에 올리고 양방향 통신을 한 세대 commit과 process cold restore 뒤에도 유지한다. guest를 자기 worker에 얹는 길과 frame을 canvas에 올리는 경로도 CI가 문다. 재현 Linux build는 exact source, 전체 legal inventory, SBOM, config, 독립 byte-identical build 영수증에 대조된다.",
      target: "어댑터를 가진 guest는 무엇이든 브라우저 컴퓨터에서 부팅하고, 그 이미지는 host만큼 자유롭게 나간다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/webMachine/browser/probes/hostContractProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/ownerSuccessorProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
      Object.freeze({ path: "tests/browser/gate.js", lane: "test:browser" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/dualBootProbe.html", lane: "test:web-machine:v86" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/linuxGuestProbe.html", lane: "test:web-machine:v86" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/nestedBrowserBoundaryProbe.html", lane: "test:web-machine:v86" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "memory64",
        rung: 5,
        en: "Enable memory64 once the engine contract can prove it, lifting the per-module heap ceiling a large guest hits first",
        ko: "engine 계약이 증명할 수 있게 되면 memory64를 켜서 큰 guest가 먼저 부딪히는 모듈별 힙 상한을 올린다",
      }),
      Object.freeze({
        id: "nodeGuest",
        rung: 7,
        en: "Boot a Node guest beside Python and Linux, making JavaScript CLI tools residents of the computer",
        ko: "Python과 Linux 옆에 Node guest를 부팅해 JavaScript CLI 도구를 이 컴퓨터의 거주자로 만든다",
      }),
    ]),
  }),
  Object.freeze({
    id: "engineIndependence",
    score: 7.0,
    en: Object.freeze({
      title: "Primitives that outlive the engine",
      state: "The installed owned-kernel lane boots source-built CPython 3.14.6 on WASI in a worker and verifies typed values, checkpoints, restore, process clone, terminal, pure-Python packages, and Machine images through PyProc contracts.",
      target: "Every primitive runs on any CPython-on-WebAssembly engine, with the same package reach on each.",
    }),
    ko: Object.freeze({
      title: "엔진보다 오래 사는 프리미티브",
      state: "설치된 owned kernel 레인이 브라우저 worker에서 source-built CPython 3.14.6을 부팅하고 typed value, checkpoint, restore, process clone, terminal, pure Python package와 Machine image를 PyProc 계약으로 검증한다.",
      target: "모든 프리미티브가 어떤 CPython-on-WebAssembly 엔진에서도 돌고, 패키지 도달 범위도 같다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/ownedEngineCoreProduct.html", lane: "owned-engine" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/contracts/kernelRuntimeV2.mjs", lane: "test:contracts" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "wasiParity",
        en: "Close the WASI gap: dynamic linking (cpython#142234) for C extensions, and a value bridge that is not JSON only",
        ko: "WASI 격차를 닫는다: C 확장을 위한 동적 링킹(cpython#142234)과 JSON만이 아닌 값 다리",
      }),
    ]),
  }),
  Object.freeze({
    id: "virtualizedNetwork",
    score: 8.0,
    en: Object.freeze({
      title: "Network, the browser way",
      state: "An in-kernel ASGI server answers `fetch` from Python with concurrent requests kept apart, a virtual origin serves it from the installed package, `urllib` performs real HTTP through the syscall bridge, and the permission jail decides `connectSrc` per host. Python-to-Python traffic is gated without assets, while the x86 lane proves the real cross-engine path: Linux pings Python and a Python-sent Ethernet frame arrives at the Linux NIC before and after process cold restore. Outbound raw sockets still need a WS-to-TCP relay this package does not ship, but a hermetic lane starts the in-repo relay and a local TCP origin and reads bytes back through Python `urllib`.",
      target: "Python network code runs unmodified, and the relay boundary is the only thing a reader has to know.",
    }),
    ko: Object.freeze({
      title: "브라우저 방식의 네트워크",
      state: "커널 내 ASGI 서버가 파이썬으로 `fetch`에 답하고 동시 요청이 서로를 덮지 않는다. 가상 오리진이 설치 패키지에서 그것을 서빙하고, `urllib`이 syscall 다리로 진짜 HTTP를 하며, 권한 감옥이 host별 `connectSrc`를 가른다. Python-to-Python 통신은 무자산 레인이, 실제 교차 엔진 경로는 x86 레인이 증명한다. Linux가 Python을 ping하고 Python이 보낸 Ethernet frame이 process cold restore 전후 Linux NIC에 도착한다. 아웃바운드 raw 소켓은 여전히 이 패키지가 배송하지 않는 WS-TCP 릴레이를 요구하지만, 밀폐 레인이 저장소 안 릴레이와 로컬 TCP 오리진을 띄우고 Python `urllib`로 바이트를 읽는다.",
      target: "파이썬 네트워크 코드가 고쳐지지 않고 돌고, 읽는 사람이 알아야 할 것은 릴레이 경계 하나뿐이다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/contracts/productHostCapabilities.mjs", lane: "test:contracts" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/nestedBrowserBoundaryProbe.html", lane: "test:web-machine:v86" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "inTabTls",
        rung: 1,
        en: "Terminate TLS inside the tab, so a relay carries ciphertext it cannot read and needs no trust",
        ko: "탭 안에서 TLS를 종단해 릴레이가 읽지 못하는 암호문만 나르게 하고 신뢰를 요구하지 않게 한다",
      }),
      Object.freeze({
        id: "relayMultiplexing",
        rung: 2,
        en: "Carry many sockets over one WebSocket, the Wisp class of relay hardening",
        ko: "WebSocket 하나가 소켓 여럿을 나르게 한다(Wisp 계열 릴레이 강화)",
      }),
      Object.freeze({
        id: "peerTransport",
        rung: 3,
        en: "Open a direct tab-to-tab transport over WebRTC as an opt-in subpath, once the surface freeze clears",
        ko: "표면 동결이 풀리는 대로 WebRTC 위에 탭 사이 직접 전송을 opt-in subpath로 연다",
      }),
      Object.freeze({
        id: "isolatedWebAppLane",
        rung: 4,
        en: "Keep an Isolated Web App packaging lane ready for the day Direct Sockets opens a real inbound listen",
        ko: "Direct Sockets가 진짜 인바운드 listen을 여는 날을 위해 Isolated Web App 패키징 레인을 준비해 둔다",
      }),
    ]),
  }),
  Object.freeze({
    id: "localPythonParity",
    score: 8.7,
    en: Object.freeze({
      title: "Everything local Python does",
      state: "The package environment resolves standard metadata, canonicalizes equivalent Requires-Python declarations, hashes wheels, and installs them transactionally. The installed core and data engines ship as separate reproducible distributions. Their source-pinned catalogs seal wrapper wheels, metadata, native sources and ABIs to exact engines and profiles. The data engine runs real wasm-simd128 float64 oracles and NumPy 2.5.1 built from its exact sdist as 13 static modules, with array, dot, FFT, linalg, seeded random, clone, and Machine image oracles. Verified package layers survive process clone and Machine image revival, while mutated embedded wheels fail closed. The installed GPU subpath verifies registered compute and rendered-pixel results on real hardware. SciPy, pandas, and Polars remain explicit absences, and arbitrary native wheels await dynamic linking.",
      target: "Whatever runs in a local interpreter runs in the tab, at a speed that needs no apology.",
    }),
    ko: Object.freeze({
      title: "로컬 파이썬이 하는 전부",
      state: "package environment가 표준 metadata와 의미가 같은 Requires-Python 선언을 canonicalize하고 wheel을 hash 검증해 transaction으로 설치한다. 설치 core와 data engine은 별도 재현 배포본으로 배송된다. 각 source-pinned catalog는 wrapper wheel, metadata, native source와 ABI를 exact engine과 profile에 봉인한다. data engine은 실제 wasm-simd128 float64 oracle과 exact sdist에서 13개 static module로 빌드한 NumPy 2.5.1을 실행한다. array, dot, FFT, linalg, seeded random, process clone과 Machine image oracle이 이를 검증한다. 포함 wheel 변조는 안전 거절되고 설치 GPU subpath는 실제 hardware에서 compute와 rendered-pixel 결과를 검증한다. SciPy, pandas, Polars는 명시적 미포함이며 임의 native wheel은 dynamic linking을 기다린다.",
      target: "로컬 인터프리터에서 도는 것은 무엇이든 탭에서 돌고, 그 속도에 변명이 필요 없다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/ownedEngineDataProduct.html", lane: "owned-engine" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/contracts/nativePackageCatalog.mjs", lane: "test:contracts" }),
      Object.freeze({ path: "tests/browser/hardwareVisualOracleProduct.mjs", lane: "test:hardware-visual-oracle" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "wasmToolLayer",
        rung: 6,
        en: "Bring the tools a working machine assumes (the git and ripgrep class) inside as wasm residents, so shelling out is real",
        ko: "일하는 머신이 전제하는 도구(git·ripgrep 급)를 wasm 거주자로 안에 들여 셸 호출이 진짜가 되게 한다",
      }),
    ]),
  }),
  Object.freeze({
    id: "agentBrowserAutomation",
    score: 9.5,
    en: Object.freeze({
      title: "Browser eyes and hands for an agent",
      state: "The exact-installed Control, MCP, FrameSpace, and Python paths share Situation, paged semantic inventory, durable locators, proof-carrying actions, provider-neutral action convergence, and resource accounting. A product gate repeats observe, screenshot, confirmed click, artifact deletion, detach, and target close 20 times and returns every owned resource, process, and temporary profile to baseline. The packed convergence gate binds every proof-carrying action to at most two candidates, one reobservation, zero effect retries, and 30 seconds before the first effect. Same-document stale and navigation replacement each send one verified effect, transient occlusion waits then sends one, and ambiguous or persistently occluded targets send zero. FrameSpace proves the same receipt and records one unknown effect attempt without retry. A headed installed-package gate now verifies registered compute and rendered-pixel results on a nonfallback hardware adapter through two request-scoped GPU hostcalls.",
      target: "A Situation-to-effect loop that re-observes and rebinds across document changes, disambiguates targets, makes occluded targets interactable, never sends an unproven duplicate effect, and returns every owned resource to baseline within a fixed bound.",
    }),
    ko: Object.freeze({
      title: "agent의 브라우저 눈과 팔",
      state: "정확히 설치한 Control, MCP, FrameSpace, Python 경로가 Situation, page 단위 의미 inventory, 내구 locator, 증거를 싣는 action, provider-neutral action 수렴과 자원 계수를 공유한다. 제품 gate는 관찰, screenshot, confirmed click, artifact 삭제, detach, target close를 20회 반복하고 소유 자원, process, 임시 profile을 모두 기준선으로 되돌린다. 설치 tarball 수렴 gate는 proof-carrying action마다 후보 최대 2개, 재관찰 최대 1회, effect retry 0회, 첫 effect 전 30초를 고정한다. 같은 문서 stale과 navigation 교체는 각각 검증된 effect 1회, 일시 가림은 기다린 뒤 1회, ambiguous와 지속 가림은 0회다. FrameSpace도 같은 영수증을 내고 outcome unknown effect 1회를 재시도하지 않음을 증명한다. headed 설치 제품 gate는 nonfallback hardware adapter와 request-scoped GPU hostcall 2회로 등록된 compute와 rendered-pixel 결과를 검증한다.",
      target: "Situation에서 effect까지 document 교체를 다시 관찰하고 rebind하며, 대상을 명확히 고르고 occlusion을 해소하고, 증명되지 않은 effect를 중복 전송하지 않으며, 모든 소유 자원을 고정 상한 안에 기준선으로 되돌린다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/contracts/perceptionSpace.mjs", lane: "test:contracts" }),
      Object.freeze({ path: "tests/contracts/actionConvergence.mjs", lane: "test:contracts" }),
      Object.freeze({ path: "tests/browser/actionConvergenceProduct.mjs", lane: "test:action-convergence" }),
      Object.freeze({ path: "tests/browser/apxProduct.mjs", lane: "test:apx" }),
      Object.freeze({ path: "tests/browser/automationLifecycleProduct.mjs", lane: "test:automation-lifecycle" }),
      Object.freeze({ path: "tests/browser/hardwareVisualOracleProduct.mjs", lane: "test:hardware-visual-oracle" }),
      Object.freeze({ path: "tests/browser/frameSpaceProduct.mjs", lane: "test:frame-space" }),
      Object.freeze({ path: "tests/browser/installedMcpProduct.mjs", lane: "test:mcp-product" }),
      Object.freeze({ path: "tests/pythonSdk/frameJourney.py", lane: "test:python-sdk" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "multiVendorVisualConformance",
        en: "Run the same result receipt on a second independent hardware and browser implementation and bind it into provider conformance",
        ko: "같은 결과 영수증을 두 번째 독립 hardware와 browser 구현에서 실행하고 provider conformance에 묶는다",
      }),
    ]),
  }),
  Object.freeze({
    id: "gatheredProductEntry",
    score: 10.0,
    en: Object.freeze({
      title: "One gathered product entrance",
      state: "The `pyproc` root gathers the complete choice: `open` for the durable Python Machine, `boot` for an explicit transient Machine, `createWebComputer` for the multi-guest host, and `checkEnvironment` for preflight. Errors share one contract, advanced plumbing stays in named subpaths, and installed-package plus browser gates prove every root door without a deep import.",
      target: "One root import that shows every product door, the handle each door returns, and the capability path beneath it, with no competing top-level identity.",
    }),
    ko: Object.freeze({
      title: "한곳에 모인 제품 진입점",
      state: "`pyproc` root가 전체 선택을 모은다. `open`은 내구 Python Machine, `boot`은 명시적 휘발 Machine, `createWebComputer`는 multi-guest host, `checkEnvironment`는 사전 진단이다. 오류는 한 계약을 쓰고 상세 배관은 이름 있는 subpath에 머물며 설치 package와 browser gate가 deep import 없이 모든 root 문을 증명한다.",
      target: "제품의 모든 문, 각 문이 돌려주는 handle, 그 아래 capability 경로를 하나의 root import에서 보여주며 경쟁하는 최상위 정체성은 없다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/contracts/publicSurface.mjs", lane: "test" }),
      Object.freeze({ path: "tests/contracts/moduleBoundaries.mjs", lane: "test" }),
      Object.freeze({ path: "tests/packageGate.mjs", lane: "test" }),
      Object.freeze({ path: "tests/tsconfig.json", lane: "test:types" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/browser/preflightNoCoi.html", lane: "test:preflight" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([]),
  }),
  Object.freeze({
    id: "supplyChainIntegrity",
    score: 9.0,
    en: Object.freeze({
      title: "A supply chain you can verify",
      state: "The zero-dependency engine CLI verifies catalog-pinned boot anchors and every lock-listed package before same-origin deployment; runtime pins the script SRI, re-verifies fetched core bytes, and the browser gate proves zero third-party requests. The asset CLI seals the worker and Service Worker graph, bad hashes refuse spawn, and machine images verify signers before import. The Linux guest and data engine are checked by byte-identical independent rebuilds. The NumPy lane additionally seals the exact sdist, build tools, compatibility overlay, static module registry, wheel, numeric oracle, SBOM, and manifest.",
      target: "Every byte pyproc executes is either built by a repository recipe or pinned by a digest, and every mismatch fails before execution.",
    }),
    ko: Object.freeze({
      title: "검증 가능한 공급망",
      state: "무의존 engine CLI가 catalog에 pin된 boot anchor와 lock이 등재한 package를 전수 검증한 뒤 same-origin에 배포하고, runtime은 script SRI와 fetch된 core를 다시 검증하며 브라우저 gate는 제3자 요청 0을 증명한다. 자산 CLI는 worker와 Service Worker graph를 봉인하고 나쁜 hash는 spawn을 거부하며 Machine image는 import 전에 서명자를 검증한다. Linux guest와 data engine은 독립 byte-identical rebuild로 확인한다. NumPy 레인은 exact sdist, build tool, compatibility overlay, static module registry, wheel, 수치 oracle, SBOM과 manifest까지 봉인한다.",
      target: "pyproc이 실행하는 모든 byte는 저장소 recipe로 build되거나 digest로 pin되고, 불일치는 실행 전에 실패한다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/installedPackageGate.mjs", lane: "test:installed" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "remainingReproducibleAssets",
        en: "Build the remaining firmware and emulator assets twice from repository recipes and gate every digest in the final execution graph",
        ko: "남은 firmware와 emulator 자산을 저장소 recipe로 두 번 build하고 최종 실행 graph의 모든 digest를 gate로 대조한다",
      }),
    ]),
  }),
]);

// 브라우저 레인의 집합. WASM 런타임의 진짜 검증은 브라우저에서만 가능하므로(테스트 규칙),
// 축마다 최소 하나는 여기 속한 레인이어야 한다. Node 게이트만 든 축은 구조만 본 것이다.
export const NORTH_STAR_BROWSER_LANES = Object.freeze([
  "test:browser", "test:installed", "test:examples", "test:mcp", "owned-engine",
  "test:mcp-product", "test:frame-space", "test:python-sdk", "test:apx",
  "test:automation-lifecycle", "test:preflight", "test:web-machine", "test:web-machine:v86",
  "test:web-computer", "test:storage-durability", "test:hardware-visual-oracle", "ci",
]);

/** 총점, 만점, 평균. 표의 숫자는 전부 여기서 나온다(손으로 더한 총점 = 표류의 씨앗). */
export function northStarScore(axes = NORTH_STAR_AXES) {
  const total = axes.reduce((sum, axis) => sum + axis.score, 0);
  const max = axes.length * 10;
  return Object.freeze({
    total: total.toFixed(1),
    max: String(max),
    average: (total / axes.length).toFixed(1),
  });
}

/** 천장 사다리 = rung을 단 next 항목 전부를 전역 순서로 편 것. 각 단은 자기 축을 들고 다닌다. */
export function ceilingLadder(axes = NORTH_STAR_AXES) {
  return axes
    .flatMap((axis) => axis.next.filter((move) => move.rung).map((move) => ({ move, axis })))
    .sort((left, right) => left.move.rung - right.move.rung);
}

/** README 두 판이 담는 블록. 문장, 규칙, 총점, 표가 한 덩어리다. */
export function renderNorthStarMarkdown(locale, axes = NORTH_STAR_AXES) {
  const text = NORTH_STAR[locale];
  if (!text) throw new Error(`북극성 로케일이 없다: ${locale}`);
  const score = northStarScore(axes);
  const rows = axes.map((axis) => {
    const cell = axis[locale];
    const moves = axis.next.map((move) => (move.rung ? `${text.rung(move.rung)}: ${move[locale]}` : move[locale]));
    return `| ${cell.title} | ${axis.score.toFixed(1)} | ${cell.state} | ${cell.target} | ${moves.join("; ")} |`;
  });
  return [
    `**${text.statement}**`,
    "",
    text.rule,
    "",
    text.total(score.total, score.max, score.average),
    "",
    text.header,
    text.divider,
    ...rows,
  ].join("\n");
}

/** 사다리 블록. 표의 "다음 수" 중 벽을 무는 것들만 전역 순서로 다시 세운 것이라 정본은 하나다. */
export function renderCeilingLadderMarkdown(locale, axes = NORTH_STAR_AXES) {
  const text = CEILING_LADDER[locale];
  if (!text) throw new Error(`사다리 로케일이 없다: ${locale}`);
  const rungs = ceilingLadder(axes).map(({ move, axis }) => `${move.rung}. ${move[locale]} (${text.axis(axis[locale].title)})`);
  return [text.intro, "", ...rungs, "", text.outro].join("\n");
}
