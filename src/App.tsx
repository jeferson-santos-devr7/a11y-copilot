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
// ==========================================
const runLocalSecurityChecks = (code: string): DiagnosticError[] => {
  const localErrors: DiagnosticError[] = [];
  const normalizedCode = code.toLowerCase();

  if (normalizedCode.includes('<img') && !normalizedCode.includes('alt=')) {
    localErrors.push({
      id: 'local-err-img',
      rule: 'Imagem sem texto alternativo (alt)',
      severity: 'critical',
      message: 'Foi encontrada uma tag <img> sem o atributo de descrição alt. Usuários cegos não saberão o que essa imagem representa.',
      codeSnippet: code.match(/<img[^>]*>/i)?.[0] || '<img>',
      suggestion: 'Adicione o atributo alt="..." descrevendo a imagem, ou use alt="" se ela for puramente decorativa.'
    });
  }

  if (normalizedCode.includes('<button') && !normalizedCode.includes('aria-label=') && !normalizedCode.includes('aria-labelledby=')) {
    if (normalizedCode.match(/<button[^>]*>\s*<\/button>/) || normalizedCode.includes('<svg') || normalizedCode.includes('class="fa') || normalizedCode.includes('class="bi')) {
      localErrors.push({
        id: 'local-err-btn',
        rule: 'Botão sem rótulo textual legível',
        severity: 'warning',
        message: 'Este botão contém um ícone ou está vazio. Leitores de tela não conseguem adivinhar a função do botão sem um texto explicativo.',
        codeSnippet: code.match(/<button[^>]*>([\s\S]*?)<\/button>/i)?.[0] || '<button>',
        suggestion: 'Adicione um atributo aria-label (ex: aria-label="Fechar menu") ou insira um texto visível dentro do botão.'
      });
    }
  }

  if (normalizedCode.includes('<h1') && normalizedCode.includes('<h3') && !normalizedCode.includes('<h2')) {
    localErrors.push({
      id: 'local-err-hierarchy',
      rule: 'Hierarquia de títulos saltada',
      severity: 'info',
      message: 'O código pula de um título principal (H1) direto para um subtítulo de terceiro nível (H3). Isso confunde a navegação estrutural.',
      codeSnippet: '<h1>...</h1> e <h3>...</h3> encontrados sem um <h2>',
      suggestion: 'Substitua a tag <h3> por uma tag <h2> para manter a ordem cronológica correta.'
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

  // Função principal que chama a IA do Gemini ou o motor local
  const handleAnalyze = async () => {
    if (!codeInput.trim()) return
    setLoading(true)

    const localIssues = runLocalSecurityChecks(codeInput)
    
    // ✅ CORRIGIDO: Agora a chave puxa com segurança do arquivo local externo!
    const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const prompt = `Analise o seguinte código HTML/React e retorne um relatório detalhado de acessibilidade:\n${codeInput}`

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: {
          systemInstruction: "Você é um validador de acessibilidade automatizado (WCAG 2.2). Identifique erros como falta de 'alt', botões sem label e quebras de hierarquia. Retorne obrigatoriamente as respostas estruturadas em formato JSON válido e em português do Brasil.",
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
                    severity: { type: Type.STRING, enum: ["critical", "warning", "info"] },
                    message: { type: Type.STRING },
                    codeSnippet: { type: Type.STRING },
                    suggestion: { type: Type.STRING }
                  },
                  required: ["id", "rule", "severity", "message", "codeSnippet", "suggestion"]
                }
              }
            },
            required: ["score", "passed", "failed", "errors", "fixedCode"]
          }
        }
      })

      if (response.text) {
        const result = JSON.parse(response.text) as AnalysisResult
        updateAppStats(result, codeInput)
      }
    } catch (error) {
      console.error("Usando Motor Local (offline):", error)
      const failed = localIssues.length || 1
      const fallbackResult: AnalysisResult = {
        score: Math.max(0, 100 - (failed * 25)),
        passed: 1,
        failed: failed,
        fixedCode: codeInput,
        errors: localIssues.length ? localIssues : [{
          id: "err-api-fallback",
          rule: "Conexão instável (Motor Local Ativado)",
          severity: "warning",
          message: "O Gemini não pôde responder, mas o motor local vasculhou o código rápido e não achou erros crassos.",
          codeSnippet: "API Ocupada",
          suggestion: "Tente novamente em alguns segundos para obter a versão gerada pela inteligência artificial."
        }]
      }
      updateAppStats(fallbackResult, codeInput)
    } finally {
      setLoading(false)
    }
  }

  const updateAppStats = (result: AnalysisResult, code: string) => {
    setCurrentResult(result)
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      code,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      result
    }
    setHistory(prev => [newItem, ...prev])
  }

  // Função para baixar o relatório .txt
  const handleExportReport = () => {
    if (!currentResult) return
    const dateStr = new Date().toLocaleDateString('pt-BR')
    let txt = `==================================================\n   RELATÓRIO DE ACESSIBILIDADE - A11yCopilot\n==================================================\n\n`
    txt += `Score Geral: ${currentResult.score}/100\nPassaram: ${currentResult.passed} | Falharam: ${currentResult.failed}\n\n`
    txt += `PROBLEMAS DETALHADOS:\n`
    currentResult.errors.forEach((err, i) => {
      txt += `${i + 1}. [${err.severity.toUpperCase()}] ${err.rule}\n   Motivo: ${err.message}\n   Sugestão: ${err.suggestion}\n\n`
    })
    
    const element = document.createElement("a")
    const file = new Blob([txt], { type: 'text/plain;charset=utf-8' })
    element.href = URL.createObjectURL(file)
    element.download = `relatorio-a11y-${dateStr.replace(/\//g, '-')}.txt`
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* 🧭 BARRA LATERAL (HISTÓRICO) */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 flex flex-col justify-between hidden md:flex">
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
                  className="w-full text-left p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-850 text-xs text-slate-300 flex justify-between items-center transition-all cursor-pointer"
                >
                  <span className="truncate max-w-[120px] font-mono">{item.code}</span>
                  <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">{item.timestamp}</span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-2 text-center font-mono">v1.2.0 - Híbrido</div>
      </aside>

      {/* 💻 PAINEL CENTRAL */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">
          
          {/* TOPO */}
          <header className="flex justify-between items-center mb-6 border-b border-slate-900 pb-4">
            <div>
              <h1 className="text-xl font-extrabold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">♿ A11yCopilot</h1>
              <p className="text-[11px] text-slate-400 mt-0.5">Validador de acessibilidade em tempo real</p>
            </div>
            <button
              onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all active:scale-95"
            >
              ❓ Como Usar
            </button>
          </header>

          {/* CAIXA DE ENTRADA DO CÓDIGO */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Cole o seu código HTML ou React:</h2>
            <textarea
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Ex: <img src='banner.jpg'> <button>❌</button>"
              className="w-full h-40 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-blue-500 resize-none"
            />
            <button
              onClick={handleAnalyze}
              disabled={loading || !codeInput.trim()}
              className="w-full mt-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs py-2.5 rounded-lg transition-all cursor-pointer active:scale-[0.99]"
            >
              {loading ? '🧠 Analisando com o Gemini e Regras Locais...' : '🔍 Analisar Código'}
            </button>
          </div>

          {/* EXIBIÇÃO DE RESULTADOS */}
          {currentResult && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl mt-6">
              <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-200">📊 Diagnóstico do Motor</h3>
                </div>
                <button
                  onClick={handleExportReport}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] px-2.5 py-1.5 rounded border border-slate-700 cursor-pointer"
                >
                  📥 Exportar (.txt)
                </button>
              </div>

              {/* PLACAR */}
              <div className="grid grid-cols-3 gap-3 mb-5 text-center">
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-850">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Score</div>
                  <div className={`text-xl font-black ${currentResult.score >= 80 ? 'text-emerald-400' : 'text-rose-400'}`}>{currentResult.score}</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-850">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Passaram</div>
                  <div className="text-xl font-black text-emerald-400">{currentResult.passed}</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-850">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Falharam</div>
                  <div className="text-xl font-black text-rose-400">{currentResult.failed}</div>
                </div>
              </div>

              {/* LISTAGEM DE ERROS */}
              <div className="space-y-3">
                {currentResult.errors.length === 0 ? (
                  <p className="text-xs text-emerald-400 bg-emerald-500/5 p-3 rounded-lg text-center border border-emerald-500/10">✨ Nenhum problema encontrado! Código limpo.</p>
                ) : (
                  currentResult.errors.map(err => (
                    <div key={err.id} className="p-3 bg-slate-950 border border-slate-850 rounded-lg text-xs">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-slate-200">{err.rule}</span>
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-rose-400">{err.severity}</span>
                      </div>
                      <p className="text-slate-400 mb-2 leading-relaxed">{err.message}</p>
                      <div className="bg-slate-900 border border-slate-850 p-2 rounded text-emerald-400">💡 {err.suggestion}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* 📜 MODAL DO MANUAL DE AJUDA */}
      {isHelpOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">📖 Manual de Uso</h2>
              <button onClick={() => setIsHelpOpen(false)} className="text-slate-400 hover:text-slate-100 text-xs cursor-pointer">❌ Fechar</button>
            </div>
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p><strong>1. Inserir Código:</strong> Cole seu bloco HTML no campo principal (tente um <code className="bg-slate-950 px-1 rounded text-rose-400">&lt;img&gt;</code> vazio para testar).</p>
              <p><strong>2. Executar:</strong> Clique em "Analisar". O motor vai acionar o Gemini ou o scanner offline para avaliar a acessibilidade do código.</p>
              <p><strong>3. Relatórios:</strong> Veja a nota de 0 a 100 na tela e use o botão <strong>"Exportar (.txt)"</strong> para baixar a avaliação completa.</p>
            </div>
            <div className="bg-slate-950 p-2.5 rounded border border-slate-850 text-[10px] text-slate-500 text-center font-mono">
              A11yCopilot — Web Acessível para Todos ♿
            </div>
          </div>
        </div>
      )}

    </div>
  )
}