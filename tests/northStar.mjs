// tests/northStar.mjs - 북극성 축 원장(SSOT). 데이터와 렌더만 산다. 판정은 tests/run.mjs [북극성] 절이 한다.
//
// 왜 원장이 코드인가: 산문 증거는 썩는다. "이 축은 게이트가 있다"는 문장은 그 게이트 파일이
// 개명되거나 삭제되거나 러너에 한 번도 안 꽂혀도 그대로 남는다(xlpod의 같은 장치가 존재하는
// 이유이고, 이 저장소에서도 probe 15개가 게이트 폴더에 있으면서 아무도 안 돌리던 사건이 있었다).
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
// 각 단을 왜 그 순서로 미는지와 우선순위를 재배열할 외부 트리거는 docs/product/vision.md가 정본이다.

export const NORTH_STAR = Object.freeze({
  en: Object.freeze({
    statement: "Make the browser a computer that boots more than one guest operating system - and make that computer pyproc itself.",
    rule: "Scores are anchored to gates that actually run in CI. A path no automated gate runs does not score, however complete the implementation is, and an axis whose evidence includes a manual-only probe is held below 9. A 10 means the axis is finished: repeatedly verified in a real browser, with nothing left for a consumer to work around.",
    total: (total, max, average) => `Today that is **${total} / ${max}, average ${average} / 10**.`,
    header: "| Axis | Score | Where it stands today | Where it has to land | Next move |",
    divider: "|---|---:|---|---|---|",
    rung: (at) => `rung ${at}`,
  }),
  ko: Object.freeze({
    statement: "브라우저를 여러 guest OS가 부팅되는 컴퓨터로 만들고, 그 컴퓨터를 pyproc 자신으로 만든다.",
    rule: "점수의 근거는 CI에서 실제로 도는 게이트다. 자동으로 실행되지 않는 경로는 구현이 아무리 완성돼 있어도 점수로 세지 않고, 증거에 수동 probe가 섞인 축은 9점 아래로 묶인다. 10점은 그 축이 끝난 상태다: 실제 브라우저에서 반복 검증됐고 소비자가 우회해야 할 것이 남지 않았다.",
    total: (total, max, average) => `지금 총점은 **${total} / ${max}, 평균 ${average} / 10**이다.`,
    header: "| 축 | 현재 점수 | 지금 서 있는 자리 | 도달해야 하는 자리 | 다음 수 |",
    divider: "|---|---:|---|---|---|",
    rung: (at) => `${at}단`,
  }),
});

// 천장 사다리의 틀. 단 목록 자체는 축의 next에 살고(단이 어느 축을 움직이는지가 강제된다),
// 여기에는 두 벽의 프레이밍과 정본 링크만 둔다. 벽의 논증은 docs/product/vision.md가 정본이다.
export const CEILING_LADDER = Object.freeze({
  en: Object.freeze({
    intro: "The distance that remains is two walls with different fates. The transport wall (a tab accepting an inbound connection) is opening, so it gets climbed in order. The native wall (web content spawning a native process) never opens, by the design of the web itself, so what only local machines run moves inward instead. Every rung names the axis it moves:",
    axis: (title) => `moves: ${title}`,
    outro: "Why the order is what it is, and the external triggers that would reorder it, are in the [product direction](docs/product/vision.md#where-the-ceiling-moves-next). The rungs are registered in the axis ledger, so a rung cannot drift away from the score it claims to move.",
  }),
  ko: Object.freeze({
    intro: "남은 거리는 운명이 다른 두 벽이다. 전송 벽(탭이 인바운드 연결을 받는 것)은 열리는 중이라 순서대로 오른다. 네이티브 벽(웹 콘텐츠가 네이티브 프로세스를 띄우는 것)은 웹 자체의 설계상 열리지 않으니, 로컬 머신만 돌리는 것은 대신 안으로 옮긴다. 모든 단은 자기가 움직이는 축을 밝힌다:",
    axis: (title) => `움직이는 축: ${title}`,
    outro: "순서가 왜 이 순서인지와 우선순위를 재배열할 외부 트리거는 [제품 방향](docs/product/vision.md#where-the-ceiling-moves-next)에 있다. 단은 축 원장에 등재되므로, 자기가 움직인다고 주장한 점수에서 떨어져 나갈 수 없다.",
  }),
});

export const NORTH_STAR_AXES = Object.freeze([
  Object.freeze({
    id: "runPython",
    score: 9.5,
    en: Object.freeze({
      title: "Real Python in the tab",
      state: "`boot` / `run` / `loadPackages` drive CPython on WebAssembly from one handle, with a terminal REPL, PEP 723 scripts, a wheel cache, and a declared-environment lane. The browser gate, the installed-package consumer gate, the demo gate, and the agent (MCP) gate all run it. Engine assets come from a CDN unless you self-host, and the platform is Chromium and Edge only.",
      target: "The Python a local interpreter runs, running in a tab, with no server and no setup ritual.",
    }),
    ko: Object.freeze({
      title: "탭 안의 진짜 파이썬",
      state: "`boot` / `run` / `loadPackages`가 핸들 하나로 WebAssembly 위 CPython을 몰고, 터미널 REPL, PEP 723 스크립트, wheel 캐시, 선언 환경 레인이 붙는다. 브라우저 게이트, 설치 패키지 소비자 게이트, 데모 게이트, 에이전트(MCP) 게이트가 전부 이것을 돌린다. 자체 호스팅하지 않으면 엔진 자산은 CDN에서 오고, 플랫폼은 Chromium과 Edge뿐이다.",
      target: "로컬 인터프리터가 돌리는 파이썬을 서버도 준비 의식도 없이 탭에서 그대로 돌린다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
      Object.freeze({ path: "tests/browser/examples.mjs", lane: "test:examples" }),
      Object.freeze({ path: "tests/browser/mcpSandbox.mjs", lane: "test:mcp" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "assetLaneWithoutCdn",
        en: "Make the verified self-hosted asset lane the default path, so a first boot depends on no CDN",
        ko: "검증된 자체 호스팅 자산 레인을 기본 경로로 올려 첫 부팅이 CDN에 의존하지 않게 한다",
      }),
    ]),
  }),
  Object.freeze({
    id: "timeTravelState",
    score: 9.0,
    en: Object.freeze({
      title: "State you can rewind",
      state: "Checkpoint, restore, branch, and prune run at execution boundaries over complete heap hashing: a full-heap byte-equality round trip, sibling-delta isolation across a branch tree, and a violated boundary that falls back to a full rehash instead of restoring something corrupt. Node property and fuzz gates cover delta soundness and tree integrity. An arbitrary instant is still not capturable, because in-flight promises and network requests live outside the boundary.",
      target: "Any past state comes back instantly, including the work that was in flight when it was left.",
    }),
    ko: Object.freeze({
      title: "되감을 수 있는 상태",
      state: "체크포인트, 복원, 분기, 가지치기가 완전 힙 해시 위에서 실행 경계마다 돈다: 전 바이트 동일 full-heap 왕복, 분기 나무의 형제 델타 격리, 경계를 어겼을 때 오염된 복원 대신 전체 재해시로 물러나는 경로까지 게이트가 문다. 델타 건전성과 나무 무결성은 Node property/fuzz 게이트가 덮는다. 임의 순간의 포획은 아직 아니다: 진행 중인 promise와 네트워크 요청은 경계 밖에 산다.",
      target: "떠날 때 진행 중이던 작업까지 포함해 과거의 어느 상태든 즉시 돌아온다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
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
    score: 8.5,
    en: Object.freeze({
      title: "Processes and real parallelism",
      state: "Workers are processes: snapshot-fork spawn, `map`, `forkMany`, a signal table, kill, job control, nested containers, pool exhaustion, and mid-flight worker death all converge under the browser gate. N interpreters are N GILs, so the parallelism is structural rather than scheduled. There is no shared-memory threading and no arbitrary POSIX process tree.",
      target: "A process model with the vocabulary of a real operating system, threads included once the platform allows them.",
    }),
    ko: Object.freeze({
      title: "프로세스와 진짜 병렬",
      state: "워커가 프로세스다: 스냅샷 fork 생성, `map`, `forkMany`, 시그널 표, kill, 잡 컨트롤, 중첩 컨테이너, 풀 소진, mid-flight 워커 사망까지 브라우저 게이트에서 수렴한다. 독립 인터프리터 N개 = 독립 GIL N개라 병렬성이 스케줄이 아니라 구조에서 나온다. 공유 메모리 스레딩과 임의의 POSIX 프로세스 트리는 없다.",
      target: "진짜 운영체제의 어휘를 가진 프로세스 모델. 플랫폼이 허락하는 순간 스레드까지.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
      Object.freeze({ path: "tests/browser/examples.mjs", lane: "test:examples" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "sharedMemoryThreads",
        en: "Take shared-memory threading the moment nogil and WASM threads land upstream, without changing the process vocabulary",
        ko: "nogil과 WASM 스레드가 upstream에 착륙하는 순간 프로세스 어휘를 바꾸지 않은 채 공유 메모리 스레딩을 받는다",
      }),
    ]),
  }),
  Object.freeze({
    id: "durableDisk",
    score: 8.0,
    en: Object.freeze({
      title: "A disk that survives",
      state: "The state kernel commits content-addressed generations into OPFS under a write-order law: a tampered blob is caught, a broken HEAD falls back to PREV instead of impersonating a first boot, journals pack, an unchanged re-commit writes zero bytes, and the durable generation is what the browser computer restores after its process restarts. Readers for the old envelope are still carried, and their sunset waits for the next breaking release.",
      target: "Durability with the guarantees of a real filesystem: no torn commit, no silent loss, exactly one format.",
    }),
    ko: Object.freeze({
      title: "살아남는 디스크",
      state: "상태 커널이 내용 주소 세대를 쓰기 순서 법 아래 OPFS에 커밋한다: 변조된 blob은 적발되고, 파손된 HEAD는 첫 부팅을 위장하지 않고 PREV로 후퇴하며, 저널은 pack되고, 바뀐 것이 없는 재커밋은 0바이트를 쓴다. 브라우저 컴퓨터가 프로세스 재시작 뒤 복원하는 것이 바로 그 내구 세대다. 구 봉투 reader는 아직 함께 간다. 일몰은 다음 브레이킹 릴리즈 대기다.",
      target: "진짜 파일시스템의 보장을 가진 내구성: 찢어진 커밋 없음, 조용한 손실 없음, 포맷은 하나.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/generationContractProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "oldEnvelopeSunset",
        en: "Sunset the old envelope readers at the next breaking release, leaving exactly one format on disk",
        ko: "다음 브레이킹 릴리즈에서 구 봉투 reader를 일몰해 디스크 위 포맷을 하나로 남긴다",
      }),
    ]),
  }),
  Object.freeze({
    id: "survivesTabDeath",
    score: 8.0,
    en: Object.freeze({
      title: "A machine that outlives its tab",
      state: "One logical machine spans same-origin tabs through leader election: a forcibly removed leader is taken over, followers commit through the leader, and the committed heap and `/home/web` cold-reopen after every participant closes, all of it exercised on the installed package. An interrupted command reports `PYPROC_RPC_OUTCOME_UNKNOWN` and is never replayed, so exactly-once resolution is declared rather than delivered.",
      target: "The machine keeps running while any tab is open, and every command it accepted resolves exactly once.",
    }),
    ko: Object.freeze({
      title: "탭보다 오래 사는 머신",
      state: "리더 선출로 논리 머신 하나가 동일 오리진 탭들을 가로지른다: 강제 제거된 리더는 승계되고, 팔로워는 리더를 통해 커밋하며, 참가자가 전부 닫힌 뒤에도 커밋된 힙과 `/home/web`이 콜드 재개된다. 전부 설치 패키지 위에서 돈다. 끊긴 명령은 `PYPROC_RPC_OUTCOME_UNKNOWN`을 보고하고 절대 재실행되지 않는다: 정확히 한 번의 수렴은 아직 선언이지 배송이 아니다.",
      target: "탭이 하나라도 열려 있는 동안 머신은 계속 살고, 받아들인 명령은 정확히 한 번 수렴한다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/immortalProductGate.js", lane: "test:consumer" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "exactlyOnceDelivery",
        en: "Deliver exactly-once resolution instead of declaring it: an idempotency token and a result journal that survive an interrupted command",
        ko: "정확히 한 번의 수렴을 선언이 아니라 배송으로 만든다: 끊긴 명령을 건너 살아남는 멱등 토큰과 결과 저널",
      }),
    ]),
  }),
  Object.freeze({
    id: "portableMachineImage",
    score: 9.0,
    en: Object.freeze({
      title: "A machine you can carry",
      state: "`.pymachine` and `.webmachine` files are signed content-addressed envelopes: signature and trusted-key verification, byte-tamper rejection, layout-independent reparse, worker-to-worker revival, and a cross-context transport refused on an `h0` mismatch instead of opened silently. The product gate exports a signed image and imports it into a fresh browser profile behind an explicit signer trust screen. Portability still assumes the same engine and manifest. A JS proxy handle cannot cross an image at all, so a surface that installs one poisons every proxy path in the revived kernel; the packet device and the permission jail were moved to value boundaries and survive a revival in CI, while a blocking surface (the syscall bridge behind input(), sockets, GPU) cannot move and is refused at export unless the caller acknowledges it.",
      target: "A machine file opens on any compatible profile from a verified signer, across engine versions.",
    }),
    ko: Object.freeze({
      title: "들고 다니는 머신",
      state: "`.pymachine`과 `.webmachine`은 서명된 내용 주소 봉투다: 서명과 신뢰 공개키 검증, 바이트 변조 거부, 레이아웃 독립 재파싱, 워커 사이 부활, 문맥을 건너는 이식은 조용히 열리는 대신 `h0` 불일치로 거부된다. 제품 게이트가 서명 이미지를 내보내고 새 브라우저 프로필에서 명시적 서명자 신뢰 화면을 거쳐 가져온다. 이식성은 아직 같은 엔진과 같은 매니페스트를 전제하고, JS 프록시 핸들은 이미지를 건너지 못해서, 프록시를 심는 표면은 부활 커널의 프록시 경로 전부를 오염시킨다. packet 장치와 권한 감옥은 값 경계로 옮겨 부활 뒤에도 살아나는 것을 CI가 물지만, 블로킹 표면(input() 뒤의 syscall 다리, socket, GPU)은 구조상 옮길 수 없어 이미지를 뜰 때 명시 승인 없이는 거부된다.",
      target: "머신 파일이 검증된 서명자에게서 왔다면 엔진 버전을 건너서도 호환 프로필 어디서나 열린다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/imagePortabilityProbe.html", lane: "test:web-machine" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "handlesSurviveMaterialisation",
        en: "Rebind JS handles after materialisation, or find a blocking mechanism that needs none, so a machine that used input() can still ship a portable image",
        ko: "물질화 뒤 핸들을 다시 묶는 엔진 층 길이나 핸들 없는 블로킹 기전을 찾아, input()을 쓴 머신도 이식 가능한 이미지를 내게 한다",
      }),
      Object.freeze({
        id: "manifestNegotiation",
        en: "Open an image across engine versions by negotiating the manifest instead of demanding an exact match",
        ko: "매니페스트 정확 일치를 요구하는 대신 협상해서 엔진 버전을 건너 이미지를 연다",
      }),
    ]),
  }),
  Object.freeze({
    id: "multiGuestComputer",
    score: 8.5,
    en: Object.freeze({
      title: "A computer that boots guests",
      state: "The Web Machine host ships inside this package behind `createWebComputer`, and a Python guest and an x86 Linux guest consume the same lifecycle, device, generation, and envelope contracts. Host contract, dual-engine, owner succession, durable generation, and guest-network probes run in CI, and the product gate boots both guests, survives a browser-process restart, and moves the pair as one signed image. A guest can also be hosted in its own worker (`pyproc-worker`), so a CPU-bound guest no longer stalls the others and a frame round-trips while another guest is inside a loop, all proven in CI. Presenting a frame onto a canvas is gated in CI as well (`CanvasRgbaFrameSink`). The display, packet-network, and dual-boot probes need x86 assets and run only in a local lane, and the Linux engine and image stay a hash-pinned development channel that cannot be redistributed.",
      target: "Any guest with an adapter boots on the browser computer, and its image ships as freely as the host does.",
    }),
    ko: Object.freeze({
      title: "guest를 부팅하는 컴퓨터",
      state: "Web Machine host가 `createWebComputer` 뒤에서 이 패키지 안에 실려 나가고, Python guest와 x86 Linux guest가 같은 lifecycle, 장치, 세대, 봉투 계약을 소비한다. host 계약, dual-engine, owner 승계, 내구 세대, guest 네트워크 probe가 CI에서 돌고, 제품 게이트는 두 guest를 부팅해 브라우저 프로세스 재시작을 견디고 둘을 한 서명 이미지로 옮긴다. guest를 자기 워커에 얹는 길도 생겼다(`pyproc-worker`): CPU 바운드 guest가 다른 guest를 멈추지 않고 프레임이 상대의 루프 도중에 왕복하는 것을 CI가 문다. 프레임을 캔버스에 올리는 경로도 CI가 문다(`CanvasRgbaFrameSink`). 디스플레이, 패킷 네트워크, dual-boot probe는 x86 자산이 필요해 로컬 레인에서만 돌고, Linux 엔진과 이미지는 재배포 불가한 해시 고정 개발 채널로 남아 있다.",
      target: "어댑터를 가진 guest는 무엇이든 브라우저 컴퓨터에서 부팅하고, 그 이미지는 host만큼 자유롭게 나간다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/webMachine/browser/probes/hostContractProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/dualEngineProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/ownerSuccessorProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/workerHostedGuestProbe.html", lane: "test:web-machine" }),
    ]),
    manual: Object.freeze([
      Object.freeze({ path: "tests/webMachine/browser/probes/dualBootProbe.html", why: "x86 engine/firmware/guest image are gitignored, so the lane cannot be built in CI" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/linuxGuestProbe.html", why: "same x86 asset lane: run locally with the v86 script" }),
    ]),
    next: Object.freeze([
      Object.freeze({
        id: "redistributableGuestImage",
        en: "Finish the self-built Linux image, so a guest ships as freely as the host and its lane can run in CI",
        ko: "Linux 자체 빌드를 끝내 guest가 host만큼 자유롭게 나가고 그 레인이 CI에서 돌게 한다",
      }),
      Object.freeze({
        id: "memory64",
        rung: 5,
        en: "Adopt memory64 to lift the per-module heap ceiling that a large guest hits first",
        ko: "memory64를 채택해 큰 guest가 가장 먼저 부딪히는 모듈별 힙 상한을 올린다",
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
      state: "A non-Pyodide lane boots CPython 3.14.6 on WASI in the browser and takes checkpoint, time travel, repeated branching, and pure-Python wheel installation through the same contracts, which is what proves the primitives are not Pyodide internals. That lane has no `dlopen`, so it carries no dynamic C extensions, and its value bridge is JSON only.",
      target: "Every primitive runs on any CPython-on-WebAssembly engine, with the same package reach on each.",
    }),
    ko: Object.freeze({
      title: "엔진보다 오래 사는 프리미티브",
      state: "비 Pyodide 레인이 브라우저에서 WASI 위 CPython 3.14.6을 부팅하고, 체크포인트, 시간여행, 반복 분기, 순수 파이썬 wheel 설치를 같은 계약으로 통과한다. 프리미티브가 Pyodide 내부가 아니라는 증명이 이것이다. 그 레인에는 `dlopen`이 없어 동적 C 확장을 못 싣고, 값 다리는 JSON뿐이다.",
      target: "모든 프리미티브가 어떤 CPython-on-WebAssembly 엔진에서도 돌고, 패키지 도달 범위도 같다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/wasiGate.html", lane: "ci" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/dualEngineProbe.html", lane: "test:web-machine" }),
      Object.freeze({ path: "tests/contracts/runtimeContract.mjs", lane: "test" }),
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
    score: 7.5,
    en: Object.freeze({
      title: "Network, the browser way",
      state: "An in-kernel ASGI server answers `fetch` from Python with concurrent requests kept apart, a virtual origin serves it from the installed package, `urllib` performs real HTTP through the syscall bridge, the permission jail decides `connectSrc` per host, and two guests exchange IPv4 frames on one switch. Outbound raw sockets need a WS-to-TCP relay this package does not ship, so that subpath has no headless gate at all.",
      target: "Python network code runs unmodified, and the relay boundary is the only thing a reader has to know.",
    }),
    ko: Object.freeze({
      title: "브라우저 방식의 네트워크",
      state: "커널 내 ASGI 서버가 파이썬으로 `fetch`에 답하고 동시 요청이 서로를 덮지 않는다. 가상 오리진이 설치 패키지에서 그것을 서빙하고, `urllib`이 syscall 다리로 진짜 HTTP를 하고, 권한 감옥이 host별 `connectSrc`를 가르고, 두 guest가 한 스위치에서 IPv4 프레임을 주고받는다. 아웃바운드 raw 소켓은 이 패키지가 배송하지 않는 WS-TCP 릴레이가 필요해 그 subpath에는 헤드리스 게이트가 아예 없다.",
      target: "파이썬 네트워크 코드가 고쳐지지 않고 돌고, 읽는 사람이 알아야 할 것은 릴레이 경계 하나뿐이다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
      Object.freeze({ path: "tests/webMachine/browser/probes/guestNetworkProbe.html", lane: "test:web-machine" }),
    ]),
    manual: Object.freeze([
      Object.freeze({ path: "tests/attempts/socketBridge/socketCapProbe.html", why: "outbound sockets need a WS-to-TCP relay this package does not ship" }),
    ]),
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
    score: 7.5,
    en: Object.freeze({
      title: "Everything local Python does",
      state: "Pyodide's `dlopen` already loads native C-extension wheels (numpy, pandas, scipy and more), packages install from a cache, `%pip` and `freeze` work inside the machine, and the WASI lane installs pure-Python wheels. The long tail is what is missing: an arbitrary package needs a published pyemscripten wheel, numpy has no SIMD build, threading is upstream-pending, and the GPU lane has no headless adapter, so what CI holds is the byte identity of the WGSL each consumer path compiles, not its result on a GPU.",
      target: "Whatever runs in a local interpreter runs in the tab, at a speed that needs no apology.",
    }),
    ko: Object.freeze({
      title: "로컬 파이썬이 하는 전부",
      state: "Pyodide의 `dlopen`이 이미 네이티브 C 확장 wheel(numpy, pandas, scipy 등)을 싣고, 패키지가 캐시에서 설치되고, 머신 안에서 `%pip`과 `freeze`가 돌고, WASI 레인이 순수 파이썬 wheel을 설치한다. 없는 것은 롱테일이다: 임의 패키지는 게시된 pyemscripten wheel을 요구하고, numpy에는 SIMD 빌드가 없고, 스레딩은 upstream 대기이며, GPU 레인은 헤드리스 어댑터가 없어 CI가 무는 것은 소비자 경로가 컴파일에 넘기는 WGSL의 바이트 동일성이지 GPU에서의 결과가 아니다.",
      target: "로컬 인터프리터에서 도는 것은 무엇이든 탭에서 돌고, 그 속도에 변명이 필요 없다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/wasiGate.html", lane: "ci" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
    ]),
    manual: Object.freeze([
      Object.freeze({ path: "tests/attempts/gpuCompute/gpuPythonProbe.html", why: "headless CI has no WebGPU adapter, so shader byte identity is the ceiling" }),
    ]),
    next: Object.freeze([
      Object.freeze({
        id: "packageReach",
        en: "Widen package reach where it is thin: a pyemscripten wheel for the long tail, and a SIMD numpy build",
        ko: "얇은 곳의 패키지 도달 범위를 넓힌다: 롱테일의 pyemscripten wheel과 SIMD numpy 빌드",
      }),
      Object.freeze({
        id: "wasmToolLayer",
        rung: 6,
        en: "Bring the tools a working machine assumes (the git and ripgrep class) inside as wasm residents, so shelling out is real",
        ko: "일하는 머신이 전제하는 도구(git·ripgrep 급)를 wasm 거주자로 안에 들여 셸 호출이 진짜가 되게 한다",
      }),
    ]),
  }),
  Object.freeze({
    id: "consumableKernel",
    score: 9.0,
    en: Object.freeze({
      title: "One kernel that products import",
      state: "The public surface is one noun and its verbs, fixed by the structure gate, the public-surface and module-boundary contracts, a typechecked `index.d.ts`, an installed-package gate, and a browser product gate that imports the packed tarball by public specifier. dartlab runs it in production, codaro and xlpod consume the same seam. `pyproc/runtime` is unreleased and needs a SHA pin until the next release, and a breaking change is queued in the changelog.",
      target: "Every consumer builds on the public surface and the shipped types, pinned to an exact version, with no deep path.",
    }),
    ko: Object.freeze({
      title: "제품이 실제로 import하는 커널 하나",
      state: "공개 표면은 명사 하나와 그 동사들이고, 구조 게이트, 공개 표면과 모듈 경계 계약, 타입체크된 `index.d.ts`, 설치 패키지 게이트, pack한 tarball을 공개 specifier로 import하는 브라우저 제품 게이트가 그것을 고정한다. dartlab이 프로덕션에서 돌리고 codaro와 xlpod가 같은 이음매를 소비한다. `pyproc/runtime`은 미출시라 다음 릴리즈까지 SHA 핀이 필요하고, 브레이킹 1건이 CHANGELOG에 쌓여 있다.",
      target: "모든 소비자가 공개 표면과 함께 나가는 타입만으로, 정확한 버전에 핀으로, deep path 없이 짓는다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/contracts/publicSurface.mjs", lane: "test" }),
      Object.freeze({ path: "tests/contracts/moduleBoundaries.mjs", lane: "test" }),
      Object.freeze({ path: "tests/packageConsumer.mjs", lane: "test" }),
      Object.freeze({ path: "tests/tsconfig.json", lane: "test:types" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
      Object.freeze({ path: "tests/browser/preflightNoCoi.html", lane: "test:preflight" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "releaseQueuedSurface",
        en: "Release the queued breaking change, so `pyproc/runtime` is consumable by an exact version pin instead of a SHA",
        ko: "쌓인 브레이킹을 릴리즈해 `pyproc/runtime`을 SHA가 아니라 정확 버전 핀으로 소비하게 한다",
      }),
      Object.freeze({
        id: "localAgentContract",
        rung: 8,
        en: "Specify the local-agent boundary once (pairing, authorization, capability list), so consumers stop reinventing the share that stays outside",
        ko: "밖에 남는 몫을 위해 로컬 에이전트 경계(페어링·인가·능력 목록)를 한 번 명세해 소비자마다 다시 짓지 않게 한다",
      }),
    ]),
  }),
  Object.freeze({
    id: "supplyChainIntegrity",
    score: 8.5,
    en: Object.freeze({
      title: "A supply chain you can verify",
      state: "The asset CLI emits SRI over the worker and Service Worker import graph, `verifyPyProcAssetIntegrity` refuses a spawn on a bad hash, engine boot supports fail-closed SRI with a re-verifying offline cache, npm releases publish through OIDC trusted publishing with provenance and manual publishes disabled, and the browser computer verifies a signer before importing an image. The provenance of the Linux development channel is not reproducible yet.",
      target: "Every byte that executes traces back to a source somebody else can rebuild and verify.",
    }),
    ko: Object.freeze({
      title: "검증 가능한 공급망",
      state: "자산 CLI가 워커와 Service Worker import 그래프 위에 SRI를 내고, `verifyPyProcAssetIntegrity`가 해시 불일치에서 spawn을 거부하고, 엔진 부팅이 재검증 오프라인 캐시와 함께 fail-closed SRI를 지원하고, npm 게시는 provenance가 붙는 OIDC trusted publishing으로만 나가며(수동 게시 비활성), 브라우저 컴퓨터는 이미지를 가져오기 전에 서명자를 검증한다. Linux 개발 채널의 provenance는 아직 재현 가능하지 않다.",
      target: "실행되는 모든 바이트가 남이 다시 빌드하고 검증할 수 있는 출처로 이어진다.",
    }),
    evidence: Object.freeze([
      Object.freeze({ path: "tests/browser/gate.html", lane: "test:browser" }),
      Object.freeze({ path: "tests/browser/productConsumer.mjs", lane: "test:consumer" }),
      Object.freeze({ path: "tests/run.mjs", lane: "test" }),
      Object.freeze({ path: "tests/browser/webComputerProduct.mjs", lane: "test:web-computer" }),
    ]),
    manual: Object.freeze([]),
    next: Object.freeze([
      Object.freeze({
        id: "reproducibleGuestChannel",
        en: "Make the Linux development channel reproducible, so its provenance is rebuildable like every other byte",
        ko: "Linux 개발 채널을 재현 가능하게 만들어 그 provenance도 나머지 바이트처럼 다시 빌드되게 한다",
      }),
    ]),
  }),
]);

// 브라우저 레인의 집합. WASM 런타임의 진짜 검증은 브라우저에서만 가능하므로(테스트 규칙),
// 축마다 최소 하나는 여기 속한 레인이어야 한다. Node 게이트만 든 축은 구조만 본 것이다.
export const NORTH_STAR_BROWSER_LANES = Object.freeze([
  "test:browser", "test:consumer", "test:examples", "test:mcp",
  "test:preflight", "test:web-machine", "test:web-computer", "ci",
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
