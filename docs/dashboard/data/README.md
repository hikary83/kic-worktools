# 📁 CWIZ Enterprise 주간 엑셀 데이터 보관 폴더

이 폴더(`docs/dashboard/data/`)에 주간 엑셀 5개를 넣어두면, 직원이 대시보드 페이지에 접속할 때 자동으로 불러와 표시됩니다.

## 📌 파일명 규칙
아래 5개 고정 파일명으로 넣거나, 원본 파일명(`_YYYY-MM-DD.xlsx`)을 넣은 뒤 `manifest.json`을 수정하시면 됩니다.

1. `이용신청.xlsx` (또는 `이용신청_YYYY-MM-DD.xlsx`)
2. `고객사현황.xlsx` (또는 `고객사현황_YYYY-MM-DD.xlsx`)
3. `고객사계측기현황.xlsx` (또는 `고객사계측기현황_YYYY-MM-DD.xlsx`)
4. `데이터변경이력.xlsx` (또는 `데이터변경이력_YYYY-MM-DD.xlsx`)
5. `보안접속이력.xlsx` (또는 `보안접속이력_YYYY-MM-DD.xlsx`)

## 🚀 매주 갱신 방법 (관리자)
1. 새 엑셀 5개를 이 폴더에 복사 (덮어쓰기)
2. Git 커밋 및 푸시:
   ```bash
   git add docs/dashboard/data
   git commit -m "data: update weekly dashboard excel files"
   git push origin main
   ```
