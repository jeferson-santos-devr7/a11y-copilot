export interface DiagnosticError {
  id: string;
  rule: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  codeSnippet: string;
  suggestion: string;
  location?: string;
  fixedSnippet?: string;  // trecho corrigido individual
  source?: 'ai' | 'local'; // qual motor detectou
}

export interface AnalysisResult {
  score: number;
  passed: number;
  failed: number;
  errors: DiagnosticError[];
  fixedCode: string; // HTML completo corrigido
}

export interface HistoryItem {
  id: string;
  code: string;
  timestamp: string;
  result: AnalysisResult;
}
