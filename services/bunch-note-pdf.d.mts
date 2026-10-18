export interface BunchNotePdfFile {
  job_id: string;
  filename: string;
  base64: string;
}

export function renderBunchNoteReportsPdf(
  reports: unknown[],
  preparedBy: string,
  preparedAt?: Date | string,
): Promise<BunchNotePdfFile[]>;

export function chicagoTimestamp(value: Date | string): string;
export function isPresent(value: unknown): boolean;
