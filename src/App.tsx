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
  codeSnippet: string;
  suggestion: string;
  location?: string;
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
// MOTOR LOCAL (Fallback Offline)
// ==========================================
const runLocalSecurityChecks = (code: string): DiagnosticError[] => {
  const localErrors: DiagnosticError[] = [];
  const normalizedCode = code.toLowerCase();

  // 1. Imagens sem alt ou com alt genérico
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
          message: 'Tag <img> sem atributo alt. Leitores de tela não conseguem descrever a imagem.',
          codeSnippet: img,
          suggestion: `Adicione alt descritivo: ${img.replace('>', ' alt="Descrição da imagem">')}`,
        });
      } else if (GENERIC_ALT.includes(altMatch[1].trim().toLowerCase())) {
        localErrors.push({
          id: `local-img-generic-${index}`,
          rule: 'WCAG 1.1.1 - Texto alternativo genérico ou vazio',
          severity: 'critical',
          message: `O atributo alt="${altMatch[1]}" não descreve o conteúdo da imagem.`,
          codeSnippet: img,
          suggestion: 'Substitua por uma descrição real (ex: alt="Gráfico de vendas do 3º trimestre").',
        });
      }
    });
  }

  // 2. Links vagos
  const VAGUE_TERMS = ['clique aqui', 'saiba mais', 'acesse', 'ok', 'clique', 'aqui', 'veja mais', 'leia mais', 'mais'];
  if (normalizedCode.includes('<a')) {
    const linkMatches = code.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) || [];
    linkMatches.forEach((link, index) => {
      const linkText = link.replace(/<[^>]*>/g, '').trim().toLowerCase();
      if (VAGUE_TERMS.includes(linkText)) {
        localErrors.push({
          id: `local-vague-link-${index}`,
          rule: 'WCAG 2.4.4 - Texto de link pouco descritivo',
          severity: 'warning',
          message: `Link com texto "${linkText}" não informa o destino fora de contexto.`,
          codeSnippet: link,
          suggestion: 'Use texto descritivo do destino, ex: "Ver detalhes do produto X".',
        });
      }
    });
  }

  // 3. <div>/<span> fingindo botão
  const fakeBtnMatches = code.match(/<(div|span)[^>]*onclick[^>]*>[\s\S]*?<\/(div|span)>/gi) || [];
  fakeBtnMatches.forEach((el, index) => {
    localErrors.push({
      id: `local-fake-btn-${index}`,
      rule: 'WCAG 4.1.2 - Elemento não semântico simulando botão',
      severity: 'critical',
      message: '<div> ou <span> com onclick não são acessíveis por teclado.',
      codeSnippet: el.length > 120 ? el.slice(0, 120) + '…' : el,
      suggestion: 'Substitua por <button type="button"> com suporte nativo a teclado e leitores de tela.',
    });
  });

  // 4. Inputs sem label
  const inputMatches = code.match(/<(input|textarea|select)[^>]*>/gi) || [];
  inputMatches.forEach((input, index) => {
    const inputType = (input.match(/type=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset'].includes(inputType)) return;
    const idMatch = input.match(/id=["']([^"']+)["']/i);
    const hasAriaLabel = /aria-label=/i.test(input);
    const hasAriaLabelledBy = /aria-labelledby=/i.test(input);
    if (!hasAriaLabel && !hasAriaLabelledBy) {
      if (!idMatch) {
        localErrors.push({
          id: `local-input-noid-${index}`,
          rule: 'WCAG 1.3.1 - Campo de formulário sem label',
          severity: 'critical',
          message: 'Input sem id e sem aria-label. Leitores de tela não anunciam o propósito do campo.',
          codeSnippet: input,
          suggestion: 'Adicione id ao input e <label for="id"> correspondente, ou use aria-label="Descrição".',
        });
      } else {
        const labelPattern = new RegExp(`for=["']${idMatch[1]}["']`, 'i');
        if (!labelPattern.test(code)) {
          localErrors.push({
            id: `local-input-nolabel-${index}`,
            rule: 'WCAG 1.3.1 - Campo de formulário sem label associado',
            severity: 'critical',
            message: `Input com id="${idMatch[1]}" mas sem <label for="${idMatch[1]}"> correspondente.`,
            codeSnippet: input,
            suggestion: `Adicione: <label for="${idMatch[1]}">Descrição do campo</label>`,
          });
        }
      }
    }
  });

  // 5. Múltiplos <h1>
  const h1Matches = code.match(/<h1[^>]*>/gi) || [];
  if (h1Matches.length > 1) {
    localErrors.push({
      id: 'local-multiple-h1',
      rule: 'WCAG 1.3.1 - Múltiplos elementos <h1>',
      severity: 'critical',
      message: `Encontrados ${h1Matches.length} elementos <h1>. Cada página deve ter apenas um.`,
      codeSnippet: h1Matches.join(' '),
      suggestion: 'Mantenha apenas um <h1> e use <h2>, <h3>... para os demais títulos.',
    });
  }

  // 6. Saltos na hierarquia de headings
  const headingMatches = code.match(/<h[1-6][^>]*>/gi) || [];
  const levels = headingMatches.map(h => parseInt(h.match(/<h([1-6])/i)?.[1] || '0'));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      localErrors.push({
        id: `local-heading-skip-${i}`,
        rule: 'WCAG 1.3.1 - Salto na hierarquia de títulos',
        severity: 'warning',
        message: `Salto de H${levels[i - 1]} direto para H${levels[i]}. A hierarquia deve ser sequencial.`,
        codeSnippet: headingMatches[i],
        suggestion: `Substitua H${levels[i]} por H${levels[i - 1] + 1}.`,
      });
    }
  }

  // 7. Landmarks ausentes (só verifica se parece página completa)
  const looksLikePage = normalizedCode.includes('<body') ||
    (normalizedCode.includes('<div') && headingMatches.length > 0);
  if (looksLikePage) {
    const LANDMARKS = [
      { tag: 'main',   desc: 'Conteúdo principal' },
      { tag: 'nav',    desc: 'Navegação do site' },
      { tag: 'header', desc: 'Cabeçalho da página' },
      { tag: 'footer', desc: 'Rodapé da página' },
    ];
    LANDMARKS.forEach(({ tag, desc }) => {
      if (!normalizedCode.includes(`<${tag}`)) {
        localErrors.push({
          id: `local-landmark-${tag}`,
          rule: `WCAG 1.3.6 - Tag semântica <${tag}> ausente`,
          severity: 'warning',
          message: `Ausência de <${tag}> (${desc}). Leitores de tela usam landmarks para navegação rápida.`,
          codeSnippet: '(não encontrado no código)',
          suggestion: `Envolva o conteúdo correspondente com <${tag}>...</${tag}>.`,
        });
      }
    });
  }

  // 8. alt longo mas genérico (ex: "imagem ou foto promocional")
  const GENERIC_ALT_PATTERNS = [
    /^(imagem|image|foto|photo|picture|figura|banner|icon|icone|ícone|logo|logotipo|thumbnail|thumb|avatar|perfil|profile|ilustracao|ilustração)(\s+(ou|and|e|de|do|da|dos|das|um|uma)?\s*(imagem|image|foto|photo|banner|picture|figura|promocional|promotional|decorativa|decorative|generica|genérica))*$/i,
  ];
  if (normalizedCode.includes('<img')) {
    const imgMatches2 = code.match(/<img[^>]*>/gi) || [];
    imgMatches2.forEach((img, index) => {
      const altMatch = img.match(/alt=["']([^"']+)["']/i);
      if (altMatch) {
        const altText = altMatch[1].trim();
        const isGeneric = GENERIC_ALT_PATTERNS.some(p => p.test(altText));
        // também pega alts muito curtos e genéricos não cobertos antes
        const alreadyCaught = ['imagem', 'image', 'foto', 'photo', 'img', 'picture', 'figura', 'banner', ''];
        if (isGeneric && !alreadyCaught.includes(altText.toLowerCase())) {
          localErrors.push({
            id: `local-img-generic-long-${index}`,
            rule: 'WCAG 1.1.1 - Texto alternativo genérico ou descritivo demais',
            severity: 'critical',
            message: `O atributo alt="${altText}" é genérico e não descreve o conteúdo real da imagem.`,
            codeSnippet: img,
            suggestion: 'Substitua por uma descrição objetiva do que a imagem mostra (ex: alt="Banner de promoção de 50% em eletrônicos").',
          });
        }
      }
    });
  }

  // 9. <button> vazio ou com apenas emoji/ícone sem texto acessível
  const buttonMatches = code.match(/<button[^>]*>([\s\S]*?)<\/button>/gi) || [];
  buttonMatches.forEach((btn, index) => {
    const hasAriaLabel = /aria-label=/i.test(btn);
    const hasAriaLabelledBy = /aria-labelledby=/i.test(btn);
    const innerContent = btn.replace(/<[^>]*>/g, '').trim();
    // Remove emojis e símbolos — se sobrar vazio, é botão sem texto acessível
    const textOnly = innerContent.replace(/[\p{Emoji}\p{Symbol}\u{1F000}-\u{1FFFF}❌✅⚠️🔍📥♿]/gu, '').trim();
    if (!hasAriaLabel && !hasAriaLabelledBy && textOnly.length === 0) {
      localErrors.push({
        id: `local-empty-btn-${index}`,
        rule: 'WCAG 4.1.2 - Botão sem texto acessível',
        severity: 'critical',
        message: `Botão contém apenas emoji ou símbolo ("${innerContent}") sem texto ou aria-label. Leitores de tela não conseguem descrever a ação.`,
        codeSnippet: btn.length > 120 ? btn.slice(0, 120) + '…' : btn,
        suggestion: `Adicione aria-label descritivo: ${btn.replace('<button', '<button aria-label="Descrição da ação"')}`,
      });
    }
  });

  // 10. <table> sem <th>
  const tableMatches = code.match(/<table[\s\S]*?<\/table>/gi) || [];
  tableMatches.forEach((table, index) => {
    const hasTh = /<th[\s>]/i.test(table);
    if (!hasTh) {
      localErrors.push({
        id: `local-table-no-th-${index}`,
        rule: 'WCAG 1.3.1 - Tabela sem cabeçalhos <th>',
        severity: 'critical',
        message: 'A tabela usa apenas <td> sem definir cabeçalhos com <th>. Leitores de tela não conseguem associar dados às colunas/linhas.',
        codeSnippet: table.length > 150 ? table.slice(0, 150) + '…' : table,
        suggestion: 'Substitua os <td> da primeira linha por <th scope="col">Nome da Coluna</th>.',
      });
    }
  });

  return localErrors;
};

// ==========================================
// COMPONENTE PRINCIPAL
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
    const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''

    // CORRIGIDO: lê o prompt do .env.local e usa como fallback o prompt padrão
    const SYSTEM_PROMPT = import.meta.env.VITE_A11Y_PROMPT ||
      `Você é um auditor sênior de acessibilidade digital especialista em WCAG 2.1 (Níveis A e AA).
Analise o código HTML fornecido e identifique todos os problemas de acessibilidade.
Para cada erro retorne: rule (nome da regra WCAG), severity (critical ou warning),
message (explicação didática), codeSnippet (trecho exato), suggestion (código corrigido pronto).`

    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
      const prompt = `Analise o seguinte código HTML/React e retorne um relatório de acessibilidade em JSON:\n\n${codeInput}`

      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          // CORRIGIDO: schema unificado — evita conflito entre prompt e responseSchema
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
                    id:          { type: Type.STRING },
                    rule:        { type: Type.STRING },
                    severity:    { type: Type.STRING, enum: ['critical', 'warning', 'info'] },
                    message:     { type: Type.STRING },
                    codeSnippet: { type: Type.STRING },
                    suggestion:  { type: Type.STRING },
                    location:    { type: Type.STRING },
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

        // CORRIGIDO: merge sempre, deduplica por rule para evitar repetição
        const aiRules = new Set(aiResult.errors.map(e => e.rule.toLowerCase()))
        const uniqueLocalIssues = localIssues.filter(e => !aiRules.has(e.rule.toLowerCase()))
        const mergedErrors = [...aiResult.errors, ...uniqueLocalIssues]

        const penalty = mergedErrors.reduce((acc, e) =>
          acc + (e.severity === 'critical' ? 15 : 8), 0)

        const finalResult: AnalysisResult = {
          ...aiResult,
          errors: mergedErrors,
          failed: mergedErrors.length,
          passed: Math.max(0, aiResult.passed),
          score: Math.max(0, Math.min(100, 100 - penalty)),
        }

        updateAppStats(finalResult, codeInput)
      }
    } catch (error) {
      console.error('Motor Local ativado (fallback):', error)
      const penalty = localIssues.reduce((acc, e) =>
        acc + (e.severity === 'critical' ? 15 : 8), 0)
      const fallbackResult: AnalysisResult = {
        score: Math.max(0, 100 - penalty),
        passed: Math.max(0, 5 - localIssues.length),
        failed: localIssues.length || 1,
        fixedCode: codeInput,
        errors: localIssues.length ? localIssues : [{
          id: 'err-api-fallback',
          rule: 'Conexão instável (Motor Local Ativado)',
          severity: 'warning',
          message: 'O Gemini não respondeu. Verifique sua chave VITE_GEMINI_API_KEY no .env.local.',
          codeSnippet: 'VITE_GEMINI_API_KEY=sua_chave_aqui',
          suggestion: 'Configure o .env.local e reinicie com npm run dev.',
        }],
      }
      updateAppStats(fallbackResult, codeInput)
    } finally {
      setLoading(false)
    }
  }

  const updateAppStats = (result: AnalysisResult, code: string) => {
    setCurrentResult(result)
    setHistory(prev => [{
      id: crypto.randomUUID(),
      code,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      result,
    }, ...prev])
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
      if (err.location) txt += `   Localização: ${err.location}\n`
      txt += `   Trecho: ${err.codeSnippet}\n`
      txt += `   Sugestão: ${err.suggestion}\n\n`
    })
    if (currentResult.fixedCode && currentResult.fixedCode.trim() !== codeInput.trim()) {
      txt += `\n==================================================\n   CÓDIGO CORRIGIDO PELA IA\n==================================================\n\n`
      txt += currentResult.fixedCode
    }
    const el = document.createElement('a')
    el.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }))
    el.download = `relatorio-a11y-${dateStr.replace(/\//g, '-')}.txt`
    document.body.appendChild(el)
    el.click()
    document.body.removeChild(el)
  }

  const getScoreColor = (score: number) =>
    score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-rose-400'

  const getSeverityStyle = (severity: string) =>
    severity === 'critical'
      ? 'text-rose-400 border-rose-400/30 bg-rose-500/5'
      : severity === 'warning'
      ? 'text-yellow-400 border-yellow-400/30 bg-yellow-500/5'
      : 'text-blue-400 border-blue-400/30 bg-blue-500/5'

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-4 flex-col justify-between hidden md:flex">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
            Histórico de Análises
          </h2>
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
                  <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 shrink-0 ml-1">
                    {item.timestamp}
                  </span>
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
              <p className="text-[11px] text-slate-400 mt-0.5">
                Validador de acessibilidade em tempo real · WCAG 2.1
              </p>
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

              {/* Score */}
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
                🎨 <strong>Dica:</strong> Validadores estáticos não leem cores renderizadas. Use o DevTools do Chrome para garantir contraste mínimo de <strong>4.5:1</strong>.
              </div>

              {/* Lista de erros */}
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
                      {err.location && (
                        <p className="text-slate-500 mb-2 text-[10px]">📍 {err.location}</p>
                      )}
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

              {/* Código corrigido */}
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
              <p><strong>2. Executar:</strong> Clique em "Analisar". O Gemini faz a análise semântica e o motor local valida regras críticas.</p>
              <p><strong>3. Resultados:</strong> Cada erro mostra a regra WCAG, o trecho problemático e o código corrigido.</p>
              <p><strong>4. Exportar:</strong> Baixe o relatório em <strong>.txt</strong> para compartilhar com sua equipe.</p>
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
