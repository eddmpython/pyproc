# 00. 제품 판단

## 문제

핵심 알고리즘보다 공개 계약과 운영 표면의 표류가 제품 신뢰를 제한한다. package export, 타입,
문서 예제, 엔진 교체 계약, 메모리 운영, guest image provenance를 실행 가능한 계약으로 묶는다.

## 완료 조건

1. 문서 import가 실제 package 값-export와 일치한다.
2. custom engine은 명시 계약으로 검증되고 WASI/Pyodide가 최소 runtime 계약을 공유한다.
3. journal과 contract tests가 책임 폴더로 분리된다.
4. reactive pressure가 byte/node budget으로 관측된다.
5. Buildroot 자체 recipe가 source/config/legal-info/SBOM 영수증을 만든다.
6. 새 Experimental 공개 표면이 기계적으로 동결된다.
