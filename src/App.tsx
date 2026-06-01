import { useState, useRef } from 'react'
import { GoogleGenAI, Type } from '@google/genai'
import type { DiagnosticError, AnalysisResult, HistoryItem } from './types'
import { runLocalSecurityChecks } from './utils/localEngine'

// ── Helpers ────────────────────────────────────────────────────────
const getScoreColor = (score: number) =>
  score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-rose-400'

const getSeverityStyle = (severity: string) =>
  severity === 'critical'
    ? 'text-rose-400 border-rose-400/40 bg-rose-500/10'
    : severity === 'warning'
    ? 'text-yellow-400 border-yellow-400/40 bg-yellow-500/10'
    : 'text-blue-400 border-blue-400/40 bg-blue-500/10'

const SourceBadge = ({ source }: { source?: string }) =>
  source === 'local' ? (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 ml-1">
      LOCAL
    </span>
  ) : (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-purple-500/40 bg-purple-500/10 text-purple-400 ml-1">
      IA
    </span>
  )

const CopyButton = ({ text, label = 'Copiar' }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer shrink-0"
    >
      {copied ? '✅ Copiado!' : `📋 ${label}`}
    </button>
  )
}

const CodeDiff = ({ err }: { err: DiagnosticError }) => (
  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
    <div className="rounded border border-rose-500/20 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-rose-500/10 border-b border-rose-500/20">
        <span className="text-[10px] font-bold text-rose-400">❌ Código com problema</span>
        <CopyButton text={err.codeSnippet} label="Copiar" />
      </div>
      <pre className="p-2 text-[11px] font-mono text-rose-300 overflow-x-auto whitespace-pre-wrap bg-slate-950">
        {err.codeSnippet}
      </pre>
    </div>
    <div className="rounded border border-emerald-500/20 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-emerald-500/10 border-b border-emerald-500/20">
        <span className="text-[10px] font-bold text-emerald-400">✅ Código corrigido</span>
        <CopyButton text={err.fixedSnippet || err.suggestion} label="Copiar" />
      </div>
      <pre className="p-2 text-[11px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap bg-slate-950">
        {err.fixedSnippet || err.suggestion}
      </pre>
    </div>
  </div>
)

export default function App() {
  const [codeInput, setCodeInput]         = useState('')
  const [loading, setLoading]             = useState(false)
  const [currentResult, setCurrentResult] = useState<AnalysisResult | null>(null)
  const [history, setHistory]             = useState<HistoryItem[]>([])
  const [isHelpOpen, setIsHelpOpen]       = useState(false)
  const [usedFallback, setUsedFallback]   = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)

  const handleAnalyze = async () => {
    if (!codeInput.trim()) return
    setLoading(true)
    setUsedFallback(false)

    const localIssues = runLocalSecurityChecks(codeInput)
    const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''
    const SYSTEM_PROMPT  = import.meta.env.VITE_A11Y_PROMPT ||
      `Você é um auditor sênior de acessibilidade WCAG 2.1. Para cada erro retorne:
id, rule (WCAG X.X.X - nome), severity (critical ou warning),
message (explicação didática), codeSnippet (trecho exato),
fixedSnippet (trecho corrigido pronto para substituição), suggestion (instrução), location.`

    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `Analise o código HTML/React abaixo e retorne relatório de acessibilidade em JSON:\n\n${codeInput}`,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score:     { type: Type.INTEGER },
              passed:    { type: Type.INTEGER },
              failed:    { type: Type.INTEGER },
              fixedCode: { type: Type.STRING },
              errors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id:           { type: Type.STRING },
                    rule:         { type: Type.STRING },
                    severity:     { type: Type.STRING, enum: ['critical', 'warning', 'info'] },
                    message:      { type: Type.STRING },
                    codeSnippet:  { type: Type.STRING },
                    fixedSnippet: { type: Type.STRING },
                    suggestion:   { type: Type.STRING },
                    location:     { type: Type.STRING },
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
        aiResult.errors = aiResult.errors.map(e => ({ ...e, source: 'ai' as const }))
        const aiRules   = new Set(aiResult.errors.map(e => e.rule.toLowerCase()))
        const uniqueLocal = localIssues.filter(e => !aiRules.has(e.rule.toLowerCase()))
        const merged    = [...aiResult.errors, ...uniqueLocal]
        const penalty   = merged.reduce((acc, e) => acc + (e.severity === 'critical' ? 15 : 8), 0)
        finalize({
          ...aiResult,
          errors: merged,
          failed: merged.length,
          passed: Math.max(0, aiResult.passed),
          score:  Math.max(0, Math.min(100, 100 - penalty)),
        })
      }
    } catch (err) {
      console.error('Motor Local ativado:', err)
      setUsedFallback(true)
      const penalty = localIssues.reduce((acc, e) => acc + (e.severity === 'critical' ? 15 : 8), 0)
      finalize({
        score:    Math.max(0, 100 - penalty),
        passed:   0,
        failed:   localIssues.length || 1,
        fixedCode: codeInput,
        errors:   localIssues.length ? localIssues : [{
          id: 'err-api-fallback',
          rule: 'Conexão instável (Motor Local Ativado)',
          severity: 'warning',
          message: 'O Gemini não respondeu. Verifique sua chave VITE_GEMINI_API_KEY no .env.local.',
          codeSnippet: 'VITE_GEMINI_API_KEY=sua_chave_aqui',
          fixedSnippet: '# Configure o .env.local e reinicie com npm run dev',
          suggestion: 'Configure o .env.local e reinicie com npm run dev.',
          source: 'local',
        }],
      })
    } finally {
      setLoading(false)
    }
  }

  const finalize = (result: AnalysisResult) => {
    setCurrentResult(result)
    setHistory(prev => [{
      id: crypto.randomUUID(),
      code: codeInput,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      result,
    }, ...prev])
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  const handleExportReport = () => {
    if (!currentResult) return
    const dateStr = new Date().toLocaleDateString('pt-BR')
    let txt = `==================================================\n   RELATÓRIO DE ACESSIBILIDADE - A11yCopilot\n==================================================\n\n`
    txt += `Score Geral: ${currentResult.score}/100\nPassaram: ${currentResult.passed} | Falharam: ${currentResult.failed}\n\n`
    txt += `PROBLEMAS DETALHADOS:\n`
    currentResult.errors.forEach((err, i) => {
      txt += `${i + 1}. [${err.severity.toUpperCase()}] ${err.rule} [${(err.source || 'ai').toUpperCase()}]\n`
      txt += `   Motivo: ${err.message}\n`
      if (err.location) txt += `   Localização: ${err.location}\n`
      txt += `   Trecho com problema:\n   ${err.codeSnippet}\n`
      txt += `   Código corrigido:\n   ${err.fixedSnippet || err.suggestion}\n\n`
    })
    if (currentResult.fixedCode && currentResult.fixedCode.trim() !== codeInput.trim()) {
      txt += `\n==================================================\n   CÓDIGO COMPLETO CORRIGIDO PELA IA\n==================================================\n\n`
      txt += currentResult.fixedCode
    }
    const el = document.createElement('a')
    el.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }))
    el.download = `relatorio-a11y-${dateStr.replace(/\//g, '-')}.txt`
    document.body.appendChild(el); el.click(); document.body.removeChild(el)
  }

  const handleClear = () => { setCodeInput(''); setCurrentResult(null); setUsedFallback(false) }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">

      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 flex-col justify-between hidden md:flex shrink-0">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Histórico de Análises</h2>
          <div className="space-y-2 overflow-y-auto max-h-[75vh]">
            {history.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-2">Nenhuma análise feita ainda.</p>
            ) : (
              history.map(item => (
                <button key={item.id} onClick={() => setCurrentResult(item.result)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300 flex justify-between items-center transition-all cursor-pointer">
                  <span className="truncate max-w-[110px] font-mono">{item.code.slice(0, 28)}</span>
                  <span className={`text-[10px] font-bold ml-1 shrink-0 ${getScoreColor(item.result.score)}`}>{item.result.score}pt</span>
                </button>
              ))
            )}
          </div>
        </div>
        <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-2 text-center font-mono">v2.0.0 — Motor Híbrido Protegido</div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="max-w-4xl mx-auto">

          <header className="flex justify-between items-center mb-6 border-b border-slate-900 pb-4">
            <div>
              <h1 className="text-xl font-extrabold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">♿ A11yCopilot</h1>
              <p className="text-[11px] text-slate-400 mt-0.5">Validador de acessibilidade em tempo real · WCAG 2.1</p>
            </div>
            <button onClick={() => setIsHelpOpen(true)}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-lg cursor-pointer transition-all active:scale-95">
              ❓ Como Usar
            </button>
          </header>

          {/* Input */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cole o seu código HTML ou React:</h2>
              <span className={`text-[10px] font-mono ${codeInput.length > 8000 ? 'text-rose-400' : 'text-slate-500'}`}>
                {codeInput.length.toLocaleString()} caracteres
              </span>
            </div>
            <textarea value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
              placeholder={'Ex: <img src="banner.jpg"> ou <div onclick="fn()">Botão</div>'}
              className="w-full h-44 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-blue-500 resize-none" />
            <div className="flex gap-2 mt-3">
              <button onClick={handleAnalyze} disabled={loading || !codeInput.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs py-2.5 rounded-lg transition-all cursor-pointer active:scale-[0.99]">
                {loading ? '🧠 Analisando com Gemini + Validador Semântico...' : '🔍 Analisar Acessibilidade'}
              </button>
              {codeInput && (
                <button onClick={handleClear}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs px-4 py-2.5 rounded-lg transition-all cursor-pointer">
                  🗑️ Limpar
                </button>
              )}
            </div>
          </div>

          {usedFallback && (
            <div className="mt-3 p-3 bg-yellow-500/5 border border-yellow-500/20 text-yellow-400 text-xs rounded-lg">
              ⚠️ <strong>Motor Local ativo:</strong> O Gemini não respondeu. Resultado baseado nas regras locais.
            </div>
          )}

          {/* Resultado */}
          {currentResult && (
            <div ref={resultRef} className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl mt-6">
              <div className="flex justify-between items-center mb-4 border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-200">📊 Diagnóstico do Motor</h3>
                <button onClick={handleExportReport}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] px-2.5 py-1.5 rounded border border-slate-700 cursor-pointer transition-all">
                  📥 Exportar (.txt)
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-5 text-center">
                {[
                  { label: 'Score', val: currentResult.score, cls: getScoreColor(currentResult.score), sub: '/100' },
                  { label: 'Passaram', val: currentResult.passed, cls: 'text-emerald-400', sub: '' },
                  { label: 'Falharam', val: currentResult.failed, cls: 'text-rose-400', sub: '' },
                ].map(c => (
                  <div key={c.label} className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                    <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">{c.label}</div>
                    <div className={`text-2xl font-black ${c.cls}`}>{c.val}</div>
                    {c.sub && <div className="text-[9px] text-slate-600">{c.sub}</div>}
                  </div>
                ))}
              </div>

              <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 text-blue-400 text-xs rounded-lg">
                🎨 <strong>Dica:</strong> Validadores estáticos não leem cores renderizadas. Use o DevTools do Chrome para garantir contraste mínimo de <strong>4.5:1</strong>.
              </div>

              <div className="flex gap-3 mb-4 items-center text-[10px]">
                <span className="text-slate-400">Origem:</span>
                <span className="px-1.5 py-0.5 rounded border border-purple-500/40 bg-purple-500/10 text-purple-400 font-bold">IA</span>
                <span className="text-slate-500">Gemini</span>
                <span className="px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-bold">LOCAL</span>
                <span className="text-slate-500">Motor local</span>
              </div>

              <div className="space-y-4">
                {currentResult.errors.length === 0 ? (
                  <p className="text-xs text-emerald-400 bg-emerald-500/5 p-3 rounded-lg text-center border border-emerald-500/10">
                    ✨ Nenhum problema encontrado! Código limpo e de acordo com as boas práticas.
                  </p>
                ) : (
                  currentResult.errors.map(err => (
                    <div key={err.id} className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs">
                      <div className="flex justify-between items-start mb-1 gap-2">
                        <div className="flex items-center flex-wrap gap-1">
                          <span className="font-bold text-slate-200 leading-snug">{err.rule}</span>
                          <SourceBadge source={err.source} />
                        </div>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${getSeverityStyle(err.severity)}`}>
                          {err.severity}
                        </span>
                      </div>
                      <p className="text-slate-400 mb-2 leading-relaxed">{err.message}</p>
                      {err.location && <p className="text-slate-500 mb-2 text-[10px]">📍 {err.location}</p>}
                      <CodeDiff err={err} />
                      <div className="mt-2 bg-slate-900 border border-slate-800 p-2 rounded text-slate-400 text-[11px]">
                        💡 {err.suggestion}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Código completo */}
              {currentResult.fixedCode && currentResult.fixedCode.trim() !== codeInput.trim() && (
                <div className="mt-6 border-t border-slate-800 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">🛠️ Código Completo Corrigido pela IA</h4>
                    <CopyButton text={currentResult.fixedCode} label="Copiar tudo" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded border border-rose-500/20 overflow-hidden">
                      <div className="flex items-center justify-between px-2 py-1 bg-rose-500/10 border-b border-rose-500/20">
                        <span className="text-[10px] font-bold text-rose-400">❌ Original</span>
                        <CopyButton text={codeInput} label="Copiar" />
                      </div>
                      <pre className="p-3 text-[11px] font-mono text-rose-300 overflow-x-auto whitespace-pre-wrap bg-slate-950 max-h-72">{codeInput}</pre>
                    </div>
                    <div className="rounded border border-emerald-500/20 overflow-hidden">
                      <div className="flex items-center justify-between px-2 py-1 bg-emerald-500/10 border-b border-emerald-500/20">
                        <span className="text-[10px] font-bold text-emerald-400">✅ Corrigido</span>
                        <CopyButton text={currentResult.fixedCode} label="Copiar" />
                      </div>
                      <pre className="p-3 text-[11px] font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap bg-slate-950 max-h-72">{currentResult.fixedCode}</pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      {isHelpOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h2 className="text-sm font-bold text-slate-200">📖 Manual de Uso</h2>
              <button onClick={() => setIsHelpOpen(false)} className="text-slate-400 hover:text-slate-100 text-xs cursor-pointer">✕ Fechar</button>
            </div>
            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p><strong>1. Inserir Código:</strong> Cole um bloco HTML ou componente React no campo principal.</p>
              <p><strong>2. Executar:</strong> Clique em "Analisar". O Gemini faz a análise semântica e o motor local valida regras críticas em paralelo.</p>
              <p><strong>3. Resultados:</strong> Cada erro mostra a regra WCAG, o trecho com problema e o trecho corrigido lado a lado com botão de copiar.</p>
              <p><strong>4. Código completo:</strong> No final veja o HTML original vs. corrigido com botão para copiar tudo.</p>
              <p><strong>5. Exportar:</strong> Baixe o relatório em <strong>.txt</strong> para compartilhar com sua equipe.</p>
              <p><strong>6. Limpar:</strong> Use o botão 🗑️ para limpar o campo e começar uma nova análise.</p>
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
