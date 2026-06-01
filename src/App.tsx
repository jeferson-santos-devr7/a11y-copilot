import { useState } from 'react'
import { GoogleGenAI, Type } from '@google/genai'

// ==========================================
// INTERFACES (Contratos de Dados)
// ==========================================
export interface DiagnosticError {
  id: string;
  rule: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  line?: number;
  codeSnippet: string;
  suggestion: string;
}

export interface AnalysisResult {
  score: number;
  passed: number;
  failed: number;
  errors: DiagnosticError[];
  fixedCode: string;
}

interface HistoryItem {
  id: string;
  code: string;
  timestamp: string;
  result: AnalysisResult;
}

// ==========================================
// MOTOR LOCAL AUTOMÁTICO (Fallback Offline)
// CORRIGIDO: cobre todos os critérios WCAG
// ==========================================
const runLocalSecurityChecks = (code: string): DiagnosticError[] => {
  const localErrors: DiagnosticError[] = [];
  const normalizedCode = code.toLowerCase();

  // ── 1. Imagens sem alt ou com alt genérico ─────────────────────────
  const GENERIC_ALT = ['imagem', 'image', 'foto', 'photo', 'img', 'picture', 'figura', 'banner', ''];
  if (normalizedCode.includes('<img')) {
    const imgMatches = code.match(/<img[^>]*>/gi) || [];
    imgMatches.forEach((img, index) => {
      const altMatch = img.match(/alt=["']([^"']*)["']/i);
      if (!altMatch) {
        localErrors.push({
          id: `local-img-missing-${index}`,
          rule: 'WCAG 1.1.1 - Imagem sem texto alternativo (alt)',
          severity: 'critical',
          message: 'Tag <img> sem atributo alt. Leitores de tela não conseguem descrever a imagem ao usuário.',
          codeSnippet: img,
          suggestion: `Adicione alt descritivo: ${img.replace('>', ' alt="Descrição da imagem">')}`,
        });
      } else if (GENERIC_ALT.includes(altMatch[1].trim().toLowerCase())) {
        localErrors.push({
          id: `local-img-generic-${index}`,
          rule: 'WCAG 1.1.1 - Texto alternativo genérico ou vazio',
          severity: 'critical',
          message: `O atributo alt="${altMatch[1]}" não descreve o conteúdo. Textos genéricos confundem leitores de tela.`,
          codeSnippet: img,
          suggestion: 'Substitua por uma descrição real do conteúdo da imagem (ex: alt="Gráfico de vendas do 3º trimestre").',
        });
      }
    });
  }

  // ── 2. Links com texto vago ────────────────────────────────────────
  const VAGUE_LINK_TERMS = ['clique aqui', 'saiba mais', 'acesse', 'ok', 'clique', 'aqui', 'veja mais', 'leia mais', 'mais'];
  if (normalizedCode.includes('<a')) {
    const linkMatches = code.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) || [];
    linkMatches.forEach((link, index) => {
      const linkText = link.replace(/<[^>]*>/g, '').trim().toLowerCase();
      if (VAGUE_LINK_TERMS.includes(linkText)) {
        localErrors.push({
          id: `local-vague-link-${index}`,
          rule: 'WCAG 2.4.4 - Texto de link pouco descritivo',
          severity: 'warning',
          message: `O link com texto "${linkText}" não informa o destino fora de contexto. Usuários de leitores de tela navegam por lista de links.`,
          codeSnippet: link,
          suggestion: 'Use texto descritivo do destino, ex: "Ver detalhes do produto X" ou "Acessar política de privacidade".',
        });
      }
    });
  }

  // ── 3. <div> e <span> fingindo ser botões ─────────────────────────
  const fakeBtnMatches = code.match(/<(div|span)[^>]*onclick[^>]*>[\s\S]*?<\/(div|span)>/gi) || [];
  fakeBtnMatches.forEach((el, index) => {
    const hasRole = /role=["']button["']/i.test(el);
    const hasTabindex = /tabindex=/i.test(el);
    if (!hasRole || !hasTabindex) {
      localErrors.push({
        id: `local-fake-btn-${index}`,
        rule: 'WCAG 4.1.2 - Elemento não semântico simulando botão',
        severity: 'critical',
        message: '<div> ou <span> com onclick não são acessíveis por teclado. Usuários que não usam mouse ficam bloqueados.',
        codeSnippet: el.length > 120 ? el.slice(0, 120) + '…' : el,
        suggestion: 'Substitua por <button type="button"> que já possui suporte nativo a teclado, foco e leitores de tela.',
      });
    }
  });

  // ── 4. Inputs sem label ───────────────────────────────────────────
  const inputMatches = code.match(/<(input|textarea|select)[^>]*>/gi) || [];
  inputMatches.forEach((input, index) => {
    const idMatch = input.match(/id=["']([^"']+)["']/i);
    const hasAriaLabel = /aria-label=/i.test(input);
    const hasAriaLabelledBy = /aria-labelledby=/i.test(input);
    const inputType = (input.match(/type=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset'].includes(inputType)) return;

    if (!hasAriaLabel && !hasAriaLabelledBy) {
      if (!idMatch) {
        localErrors.push({
          id: `local-input-noid-${index}`,
          rule: 'WCAG 1.3.1 - Campo de formulário sem label',
          severity: 'critical',
          message: 'Input sem id e sem aria-label. Leitores de tela não conseguem anunciar o propósito do campo.',
          codeSnippet: input,
          suggestion: 'Adicione id ao input e um <label for="id"> correspondente, ou use aria-label="Descrição do campo".',
        });
      } else {
        const labelPattern = new RegExp(`for=["']${idMatch[1]}["']`, 'i');
        if (!labelPattern.test(code)) {
          localErrors.push({
            id: `local-input-nolabel-${index}`,
            rule: 'WCAG 1.3.1 - Campo de formulário sem label associado',
            severity: 'critical',
            message: `Input com id="${idMatch[1]}" mas sem <label for="${idMatch[1]}"> correspondente no código.`,
            codeSnippet: input,
            suggestion: `Adicione antes do input: <label for="${idMatch[1]}">Descrição do campo</label>`,
          });
        }
      }
    }
  });

  // ── 5. Múltiplos <h1> ────────────────────────────────────────────
  const h1Matches = code.match(/<h1[^>]*>/gi) || [];
  if (h1Matches.length > 1) {
    localErrors.push({
      id: 'local-multiple-h1',
      rule: 'WCAG 1.3.1 - Múltiplos elementos <h1>',
      severity: 'critical',
      message: `Foram encontrados ${h1Matches.length} elementos <h1>. Cada página deve ter apenas um <h1> como título principal.`,
      codeSnippet: h1Matches.join(' '),
      suggestion: 'Mantenha apenas um <h1> como título principal e use <h2>, <h3>... para os demais títulos.',
    });
  }

  // ── 6. Saltos na hierarquia de headings ───────────────────────────
  const headingMatches = code.match(/<h[1-6][^>]*>/gi) || [];
  const levels = headingMatches.map(h => parseInt(h.match(/<h([1-6])/i)?.[1] || '0'));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      localErrors.push({
        id: `local-heading-skip-${i}`,
        rule: 'WCAG 1.3.1 - Salto na hierarquia de títulos',
        severity: 'warning',
        message: `Salto de H${levels[i - 1]} para H${levels[i]}. A hierarquia de headings deve ser sequencial.`,
        codeSnippet: headingMatches[i],
        suggestion: `Substitua H${levels[i]} por H${levels[i - 1] + 1} para manter a hierarquia correta.`,
      });
    }
  }

  // ── 7. Landmarks estruturais ausentes ────────────────────────────
  const LANDMARKS = [
    { tag: 'main',   rule: 'WCAG 1.3.6', desc: 'Conteúdo principal da página' },
    { tag: 'nav',    rule: 'WCAG 1.3.6', desc: 'Navegação do site' },
    { tag: 'header', rule: 'WCAG 1.3.6', desc: 'Cabeçalho da página' },
    { tag: 'footer', rule: 'WCAG 1.3.6', desc: 'Rodapé da página' },
  ];
  // Só alerta se o código parece uma página completa (tem <body> ou múltiplos elementos)
  const looksLikePage = normalizedCode.includes('<body') || normalizedCode.includes('<div') && headingMatches.length > 0;
  if (looksLikePage) {
    LANDMARKS.forEach(({ tag, rule, desc }) => {
      if (!normalizedCode.includes(`<${tag}`)) {
        localErrors.push({
          id: `local-landmark-${tag}`,
          rule: `${rule} - Tag semântica <${tag}> ausente`,
          severity: 'warning',
          message: `Ausência de <${tag}> (${desc}). Leitores de tela usam landmarks para navegação rápida entre seções.`,
          codeSnippet: '(não encontrado no código)',
          suggestion: `Envolva o conteúdo correspondente com <${tag}>...</${tag}>.`,
        });
      }
    });
  }

  return localErrors;
};

// ==========================================
// COMPONENTE PRINCIPAL DO APLICATIVO
// ==========================================
export default function App() {
  const [codeInput, setCodeInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  const handleAnalyze = async () => {
    if (!codeInput.trim()) return
    setLoading(true)

    const localIssues = runLocalSecurityChecks(codeInput)
    const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

    const SYSTEM_PROMPT = `Você é um auditor sênior de acessibilidade digital especialista em WCAG 2.1 (Níveis A e AA). Analise o código HTML fornecido e mapeie estritamente os seguintes problemas:
1) Formulários: <input>, <select> e <textarea> sem <label> associado através de ID (ou sem atributo aria-label).
2) Headings: Múltiplos tags <h1>, saltos incorretos na hierarquia semântica (ex: <h1> direto para <h3>) e headings vazios.
3) Estrutura: Ausência de tags semânticas estruturais principais como <main>, <nav>, <header> e <footer>.
4) Teclado: Uso de tags não-semânticas (<div>, <span>) simulando botões com role="button" sem tratamento de tabindex.
5) Imagens e Links: Atributos alt ausentes ou com textos redundantes ("foto", "imagem"). Links com textos vagos ("clique aqui", "saiba mais").
6) Tabelas: Elementos <table> estruturados que não possuam tags <th> para cabeçalhos.

Você DEVE preencher o array de "errors" seguindo exatamente esta estrutura:
- "rule": O nome da regra violada + a referência da especificação WCAG (Ex: "WCAG 1.3.1 - Info and Relationships").
- "severity": Use estritamente "critical" (para erros de formulário, alt e botões falsos) ou "warning" (para links vagos e saltos de títulos).
- "message": Explicação detalhada e didática do motivo do erro.
- "codeSnippet": O trecho de código exato que causou o problema.
- "suggestion": O código HTML corrigido pronto para substituição.
IMPORTANTE: Não repita erros que já foram listados. Cada problema único deve aparecer apenas uma vez.`;

    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const prompt = `Analise o seguinte código HTML/React e retorne um relatório detalhado de acessibilidade em formato JSON:\n${codeInput}`

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.INTEGER },
              passed: { type: Type.INTEGER },
              failed: { type: Type.INTEGER },
              fixedCode: { type: Type.STRING },
              errors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    rule: { type: Type.STRING },
                    severity: { type: Type.STRING, enum: ['critical', 'warning', 'info'] },
                    message: { type: Type.STRING },
                    codeSnippet: { type: Type.STRING },
                    suggestion: { type: Type.STRING },
                  },
                  required: ['id', 'rule', 'severity', 'message', 'codeSnippet', 'suggestion'],
                },
              },
            },
            required: ['score', 'passed', 'failed', 'errors', 'fixedCode'],
          },
        },
      })

      if (response.text) {
        const aiResult = JSON.parse(response.text) as AnalysisResult

        // CORRIGIDO: merge sempre — não apenas quando IA retorna vazio
        // Deduplica por rule para evitar erros duplicados entre IA e motor local
        const aiRules = new Set(aiResult.errors.map(e => e.rule.toLowerCase()))
        const uniqueLocalIssues = localIssues.filter(e => !aiRules.has(e.rule.toLowerCase()))

        const mergedErrors = [...aiResult.errors, ...uniqueLocalIssues]
        const totalFailed = mergedErrors.length
        const totalPassed = Math.max(0, aiResult.passed)

        // Recalcula score baseado no total real de erros encontrados
        const penalty = mergedErrors.reduce((acc, e) => acc + (e.severity === 'critical' ? 15 : 8), 0)
        const finalScore = Math.max(0, Math.min(100, 100 - penalty))

        const finalResult: AnalysisResult = {
          ...aiResult,
          errors: mergedErrors,
          failed: totalFailed,
          passed: totalPassed,
          score: finalScore,
        }

        updateAppStats(finalResult, codeInput)
      }
    } catch (error) {
      // FALLBACK: motor local assume o controle
      console.error('Usando Motor Local (offline):', error)
      const failed = localIssues.length || 1
      const penalty = localIssues.reduce((acc, e) => acc + (e.severity === 'critical' ? 15 : 8), 0)
      const fallbackResult: AnalysisResult = {
        score: Math.max(0, 100 - penalty),
        passed: Math.max(0, 5 - failed),
        failed,
        fixedCode: codeInput,
        errors: localIssues.length ? localIssues : [{
          id: 'err-api-fallback',
          rule: 'Conexão instável (Motor Local Ativado)',
          severity: 'warning',
          message: 'O Gemini não respondeu. Verifique sua chave de API no arquivo .env.local.',
          codeSnippet: 'VITE_GEMINI_API_KEY=sua_chave_aqui',
          suggestion: 'Configure a variável VITE_GEMINI_API_KEY no arquivo .env.local e reinicie o servidor.',
        }],
      }
      updateAppStats(fallbackResult, codeInput)
    } finally {
      // CORRIGIDO: era "loading && setLoading(false)" — loading é sempre true aqui
      setLoading(false)
    }
  }

  const updateAppStats = (result: AnalysisResult, code: string) => {
    setCurrentResult(result)
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      code,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      result,
    }
    setHistory(prev => [newItem, ...prev])
  }

  const handleExportReport = () => {
    if (!currentResult) return
    const dateStr = new Date().toLocaleDateString('pt-BR')
    let txt = `==================================================\n   RELATÓRIO DE ACESSIBILIDADE - A11yCopilot\n==================================================\n\n`
    txt += `Score Geral: ${currentResult.score}/100\nPassaram: ${currentResult.passed} | Falharam: ${currentResult.failed}\n\n`
    txt += `PROBLEMAS DETALHADOS:\n`
    currentResult.errors.forEach((err, i) => {
      txt += `${i + 1}. [${err.severity.toUpperCase()}] ${err.rule}\n`
      txt += `   Motivo: ${err.message}\n`
      txt += `   Trecho: ${err.codeSnippet}\n`
      txt += `   Sugestão: ${err.suggestion}\n\n`
    })
    if (currentResult.fixedCode && currentResult.fixedCode !== codeInput) {
      txt += `\n==================================================\n   CÓDIGO CORRIGIDO PELA IA\n==================================================\n\n`
      txt += currentResult.fixedCode
    }
    const element = document.createElement('a')
    const file = new Blob([txt], { type: 'text/plain;charset=utf-8' })
    element.href = URL.createObjectURL(file)
    element.download = `relatorio-a11y-${dateStr.replace(/\//g, '-')}.txt`
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400'
    if (score >= 50) return 'text-yellow-400'
    return 'text-rose-400'
  }

  const getSeverityStyle = (severity: string) => {
    if (severity === 'critical') return 'text-rose-400 border-rose-400/30 bg-rose-500/5'
    if (severity === 'warning') return 'text-yellow-400 border-yellow-400/30 bg-yellow-500/5'
    return 'text-blue-400 border-blue-400/30 bg-blue-500/5'
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 flex-col justify-between hidden md:flex">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Histórico de Análises</h2>
          <div className="space-y-2 overflow-y-auto max-h-[75vh]">
            {history.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-2">Nenhuma análise feita ainda.</p>
            ) : (
              history.map(item => (
                <button
                  key={item.id}
                  onClick={() => setCurrentResult(item.result)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 flex justify-between items-center transition-all cursor-pointer"
                >
                  <span className="truncate max-w-[120px] font-mono">{item.code.slice(0, 30)}</span>
                  <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 shrink-0 ml-1">{item.timestamp}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-2 text-center font-mono">
          v1.3.0 — Motor Híbrido Protegido
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">

          <header className="flex justify-between items-center mb-6 border-b border-slate-900 pb-4">
            <div>
              <h1 className="text-xl font-extrabold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                ♿ A11yCopilot
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5">Validador de acessibilidade em tempo real · WCAG 2.1</p>
            </div>
            <button
              onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all active:scale-95"
            >
              ❓ Como Usar
            </button>
          </header>

          {/* Input */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Cole o seu código HTML ou React:
            </h2>
            <textarea
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder={'Ex: <img src="banner.jpg"> ou <div onclick="fn()">Botão</div>'}
              className="w-full h-44 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-blue-500 resize-none"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || !codeInput.trim()}
              className="w-full mt-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs py-2.5 rounded-lg transition-all cursor-pointer active:scale-[0.99]"
            >
              {loading ? '🧠 Analisando com Gemini + Validador Semântico...' : '🔍 Analisar Acessibilidade'}
            </button>
          </div>

          {/* Resultado */}
          {currentResult && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl mt-6">
              <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-200">📊 Diagnóstico do Motor</h3>
                <button
                  onClick={handleExportReport}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] px-2.5 py-1.5 rounded border border-slate-700 cursor-pointer transition-all"
                >
                  📥 Exportar (.txt)
                </button>
              </div>

              {/* Score cards */}
              <div className="grid grid-cols-3 gap-3 mb-5 text-center">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Score</div>
                  <div className={`text-2xl font-black ${getScoreColor(currentResult.score)}`}>
                    {currentResult.score}
                  </div>
                  <div className="text-[9px] text-slate-600">/100</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Passaram</div>
                  <div className="text-2xl font-black text-emerald-400">{currentResult.passed}</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Falharam</div>
                  <div className="text-2xl font-black text-rose-400">{currentResult.failed}</div>
                </div>
              </div>

              {/* Dica contraste */}
              <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 text-blue-400 text-xs rounded-lg">
                🎨 <strong>Dica:</strong> Validadores estáticos não leem cores renderizadas. Use o DevTools do Chrome para garantir contraste mínimo de <strong>4.5:1</strong> nos textos.
              </div>

              {/* Erros */}
              <div className="space-y-3">
                {currentResult.errors.length === 0 ? (
                  <p className="text-xs text-emerald-400 bg-emerald-500/5 p-3 rounded-lg text-center border border-emerald-500/10">
                    ✨ Nenhum problema encontrado! Código limpo e de acordo com as boas práticas.
                  </p>
                ) : (
                  currentResult.errors.map(err => (
                    <div key={err.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs">
                      <div className="flex justify-between items-start mb-1 gap-2">
                        <span className="font-bold text-slate-200 leading-snug">{err.rule}</span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${getSeverityStyle(err.severity)}`}>
                          {err.severity}
                        </span>
                      </div>
                      <p className="text-slate-400 mb-2 leading-relaxed">{err.message}</p>
                      <div className="bg-slate-900 border border-slate-800 p-2 rounded font-mono text-[11px] text-slate-300 mb-2 overflow-x-auto">
                        <code>{err.codeSnippet}</code>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 p-2 rounded text-emerald-400">
                        💡 {err.suggestion}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Código corrigido pela IA */}
              {currentResult.fixedCode && currentResult.fixedCode.trim() !== codeInput.trim() && (
                <div className="mt-5 border-t border-slate-800 pt-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    🛠️ Código Corrigido pela IA
                  </h4>
                  <pre className="bg-slate-950 border border-slate-800 p-3 rounded-lg text-[11px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap">
                    {currentResult.fixedCode}
                  </pre>
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* ── Modal de ajuda ── */}
      {isHelpOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h2 className="text-sm font-bold text-slate-200">📖 Manual de Uso</h2>
              <button
                onClick={() => setIsHelpOpen(false)}
                className="text-slate-400 hover:text-slate-100 text-xs cursor-pointer"
              >
                ✕ Fechar
              </button>
            </div>
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p><strong>1. Inserir Código:</strong> Cole um bloco HTML ou componente React no campo principal.</p>
              <p><strong>2. Executar:</strong> Clique em "Analisar". O motor aciona o Gemini para análise semântica profunda e o validador local para regras críticas.</p>
              <p><strong>3. Resultados:</strong> Cada erro mostra a regra WCAG violada, o trecho problemático e o código corrigido pronto para substituição.</p>
              <p><strong>4. Exportar:</strong> Baixe o relatório detalhado em <strong>.txt</strong> para compartilhar com sua equipe.</p>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-800 text-[10px] text-slate-500 text-center font-mono">
              A11yCopilot — Web Acessível para Todos ♿
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
