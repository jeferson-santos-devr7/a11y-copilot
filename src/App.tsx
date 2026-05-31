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
// MOTOR LOCAL AUTOMÁTICO (Fallback Offline) - BLINDADO CONTRA ERROS SEMÂNTICOS
// ==========================================
const runLocalSecurityChecks = (code: string): DiagnosticError[] => {
  const localErrors: DiagnosticError[] = [];
  const normalizedCode = code.toLowerCase();

  // 1. Validação de Imagem (Ausência ou termos genéricos/redundantes)
  if (normalizedCode.includes('<img')) {
    const imgMatches = code.match(/<img[^>]*>/gi) || [];
    imgMatches.forEach((img, index) => {
      const altMatch = img.match(/alt=["']([^"']*)["']/i);
      
      if (!altMatch) {
        localErrors.push({
          id: `local-err-img-missing-${index}`,
          rule: 'Imagem sem texto alternativo (alt)',
          severity: 'critical',
          message: 'Foi encontrada uma tag <img> sem o atributo alt. Usuários de leitores de tela não sabem o que ela representa.',
          codeSnippet: img,
          suggestion: 'Adicione o atributo alt="..." descrevendo a imagem de forma clara.'
        });
      } else {
        const altValue = altMatch[1].trim().toLowerCase();
        const genericTerms = ['imagem', 'foto', 'figura', 'graphics', 'picture', 'screenshot'];
        if (genericTerms.includes(altValue)) {
          localErrors.push({
            id: `local-err-img-generic-${index}`,
            rule: 'Atributo alt com texto genérico/redundante',
            severity: 'critical',
            message: `A imagem utiliza alt="${altMatch[1]}". Dizer apenas que é uma imagem é redundante e não ajuda na acessibilidade.`,
            codeSnippet: img,
            suggestion: 'Substitua por um texto descritivo. Ex: alt="Notebook gamer preto com teclado retroiluminado aceso".'
          });
        }
      }
    });
  }

  // 2. Validação de Termos Vagos em Links, Botões ou aria-labels
  const vagueTerms = ['clique aqui', 'saiba mais', 'ok', 'campo', 'botão', 'clique', 'here'];
  
  // Validando textos dentro de links <a>
  if (normalizedCode.includes('<a')) {
    const linkMatches = code.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) || [];
    linkMatches.forEach((link, index) => {
      const linkText = link.replace(/<[^>]*>/g, '').trim().toLowerCase();
      const ariaLabelMatch = link.match(/aria-label=["']([^"']*)["']/i);
      const labelValue = ariaLabelMatch ? ariaLabelMatch[1].trim().toLowerCase() : '';

      if (vagueTerms.includes(linkText) || vagueTerms.includes(labelValue)) {
        localErrors.push({
          id: `local-err-vague-link-${index}`,
          rule: 'Texto ou label de link pouco descritivo',
          severity: 'warning',
          message: 'O link ou o seu aria-label usa expressões vagas que não informam o destino do usuário fora de contexto.',
          codeSnippet: link,
          suggestion: 'Torne o texto explícito sobre o destino. Em vez de "Saiba mais", use "Saiba mais sobre o Notebook Gamer".'
        });
      }
    });
  }

  // Validando textos dentro de botões <button>
  if (normalizedCode.includes('<button')) {
    const btnMatches = code.match(/<button[^>]*>([\s\S]*?)<\/button>/gi) || [];
    btnMatches.forEach((btn, index) => {
      const btnText = btn.replace(/<[^>]*>/g, '').trim().toLowerCase();
      const ariaLabelMatch = btn.match(/aria-label=["']([^"']*)["']/i);
      const labelValue = ariaLabelMatch ? ariaLabelMatch[1].trim().toLowerCase() : '';

      if (vagueTerms.includes(btnText) || vagueTerms.includes(labelValue) || btnText === '') {
        localErrors.push({
          id: `local-err-vague-btn-${index}`,
          rule: 'Botão sem contexto ou texto acessível claro',
          severity: 'warning',
          message: 'O botão possui um rótulo genérico ou vazio (ex: "OK" ou apenas um ícone), dificultando o entendimento da sua ação.',
          codeSnippet: btn,
          suggestion: 'Insira um texto claro na label ou no conteúdo interno do botão. Ex: "Enviar formulário de novidades".'
        });
      }
    });
  }

  // 3. Validação de Div/Span com comportamento de Botão (Semântica Quebrada)
  if (normalizedCode.includes('role="button"') || normalizedCode.includes("role='button'")) {
    const elements = code.match(/<(div|span)[^>]*role=["']button["'][^>]*>([\s\S]*?)<\/\1>/gi) || [];
    elements.forEach((elem, index) => {
      localErrors.push({
        id: `local-err-semantic-button-${index}`,
        rule: 'Elemento genérico simulando botão',
        severity: 'critical',
        message: 'O uso de <div> ou <span> com role="button" é uma má prática. Elementos não-semânticos exigem tratamento manual de teclado para as teclas Enter e Espaço.',
        codeSnippet: elem,
        suggestion: 'Substitua a tag <div> ou <span> diretamente pela tag nativa <button>. Ela já possui acessibilidade de teclado e foco automática.'
      });
    });
  }

  // 4. Validação Básica de Hierarquia de Títulos
  if (normalizedCode.includes('<h1') && normalizedCode.includes('<h3') && !normalizedCode.includes('<h2')) {
    localErrors.push({
      id: 'local-err-hierarchy',
      rule: 'Hierarquia de títulos saltada',
      severity: 'info',
      message: 'O código pula de um título principal (H1) direto para um subtítulo de terceiro nível (H3). Isso confunde leitores de tela.',
      codeSnippet: '<h1>...</h1> e <h3>...</h3> encontrados sem um <h2>',
      suggestion: 'Altere a ordem ou ajuste a tag para <h2> para manter a sequência lógica estrutural.'
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
    
    // Configurações de Segurança puxando dinamicamente do .env.local
    const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
    const SYSTEM_PROMPT = import.meta.env.VITE_A11Y_PROMPT || "Você é um validador de acessibilidade automatizado (WCAG 2.2). Identifique erros como falta de 'alt', botões sem label e quebras de hierarquia. Retorne obrigatoriamente as respostas estruturadas em formato JSON válido e em português do Brasil.";

    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const prompt = `Analise o seguinte código HTML/React e retorne um relatório detalhado de acessibilidade em formato JSON:\n${codeInput}`

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT, // 🔥 AGORA LÊ AS REGRAS RÍGIDAS OCULTAS DO PROMPT DO SEU .ENV!
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
        let result = JSON.parse(response.text) as AnalysisResult
        
        // Se a IA ignorar as regras rígidas por algum motivo, mesclamos os erros do motor local para garantir
        if (localIssues.length > 0 && result.errors.length === 0) {
          result = {
            ...result,
            failed: result.failed + localIssues.length,
            score: Math.max(0, result.score - (localIssues.length * 15)),
            errors: [...result.errors, ...localIssues]
          }
        }
        
        updateAppStats(result, codeInput)
      }
    } catch (error) {
      console.error("Usando Motor Local (offline):", error)
      const failed = localIssues.length || 1
      const fallbackResult: AnalysisResult = {
        score: Math.max(0, 100 - (failed * 20)),
        passed: localIssues.length ? 2 : 1,
        failed: failed,
        fixedCode: codeInput,
        errors: localIssues.length ? localIssues : [{
          id: "err-api-fallback",
          rule: "Conexão instável (Motor Local Ativado)",
          severity: "warning",
          message: "O Gemini não respondeu devido à falta de chaves de API válidas no servidor ou limite excedido. O motor offline avaliou a estrutura básica.",
          codeSnippet: "Fallback Ativo",
          suggestion: "Se você estiver rodando em produção, certifique-se de configurar as variáveis de ambiente VITE_GEMINI_API_KEY no painel da hospedagem."
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
        <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-2 text-center font-mono">v1.2.0 - Motor Híbrido Protegido</div>
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
              {loading ? '🧠 Analisando com Gemini e Validador Semântico...' : '🔍 Analisar Código'}
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

              {/* AVISO PERMANENTE DE CONTRASTE VISUAL (BOAS PRÁTICAS) */}
              <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/20 text-blue-400 text-xs rounded-lg">
                🎨 <strong>Dica de Contraste:</strong> Lembre-se que validadores estáticos de código não conseguem ler as cores renderizadas na tela. Use a ferramenta de inspeção do Chrome/DevTools para garantir um contraste mínimo de <strong>4.5:1</strong> nos textos!
              </div>

              {/* LISTAGEM DE ERROS */}
              <div className="space-y-3">
                {currentResult.errors.length === 0 ? (
                  <p className="text-xs text-emerald-400 bg-emerald-500/5 p-3 rounded-lg text-center border border-emerald-500/10">✨ Nenhum problema encontrado! Código limpo e de acordo com as boas práticas.</p>
                ) : (
                  currentResult.errors.map(err => (
                    <div key={err.id} className="p-3 bg-slate-950 border border-slate-850 rounded-lg text-xs">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-slate-200">{err.rule}</span>
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-rose-400">{err.severity}</span>
                      </div>
                      <p className="text-slate-400 mb-2 leading-relaxed">{err.message}</p>
                      <div className="bg-slate-900 border border-slate-850 p-2 rounded text-slate-300 font-mono text-[11px] mb-2 overflow-x-auto">
                        <code>{err.codeSnippet}</code>
                      </div>
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
              <p><strong>1. Inserir Código:</strong> Cole seu bloco HTML no campo principal.</p>
              <p><strong>2. Executar:</strong> Clique em "Analisar". O motor vai acionar o Gemini de forma segura ou aplicar regras semânticas locais se estiver offline.</p>
              <p><strong>3. Relatórios:</strong> Baixe o arquivo de texto detalhado com as diretrizes do WCAG usando o botão <strong>"Exportar (.txt)"</strong>.</p>
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