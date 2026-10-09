export function requireLosslessExport(report, format) {
  if (!report || report.schemaVersion !== 1 || report.outputFormat !== format ||
      !Number.isSafeInteger(report.count) || report.count < 0 ||
      !Array.isArray(report.losses) || report.losses.length !== report.count) {
    throw new Error('내보내기 내용 보존 검사를 확인할 수 없습니다. 결과는 저장하지 않았습니다.');
  }
  if (report.count) {
    throw new Error(`내보내기 중 ${report.count}건의 내용 손실이 감지되어 저장을 중단했습니다. 원본과 변경 기록은 보존됩니다.`);
  }
  return report;
}
