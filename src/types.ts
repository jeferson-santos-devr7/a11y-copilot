export interface DiagnosticError {
  id: string;
  rule: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  codeSnippet: string;
  suggestion: string;
  location?: string;
  fixedSnippet?: string;
  source?: 'ai' | 'local';
}

export interface AnalysisResult {
  score: number;
  passed: number;
  failed: number;
  errors: DiagnosticError[];
  fixedCode: string;
}

export interface HistoryItem {
  id: string;
  code: string;
  timestamp: string;
  result: AnalysisResult;
}
