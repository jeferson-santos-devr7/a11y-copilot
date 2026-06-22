import type { VercelRequest, VercelResponse } from '@vercel/node'
import { GoogleGenAI, Type } from '@google/genai'

// Esta função roda no SERVIDOR da Vercel, nunca no navegador.
// A chave GEMINI_API_KEY fica só aqui — o front-end nunca tem acesso a ela.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { codeInput } = req.body as { codeInput?: string }

  if (!codeInput || !codeInput.trim()) {
    return res.status(400).json({ error: 'codeInput é obrigatório' })
  }

  // Limite básico contra abuso (evita custo alto/ataque de payload gigante)
  if (codeInput.length > 20000) {
    return res.status(400).json({ error: 'Código muito grande (máximo 20.000 caracteres)' })
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor' })
  }

  const SYSTEM_PROMPT =
    process.env.A11Y_PROMPT ||
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
                  fixedSnippet: { type: Type.STRING },
                  suggestion: { type: Type.STRING },
                  location: { type: Type.STRING },
                },
                required: ['id', 'rule', 'severity', 'message', 'codeSnippet', 'suggestion'],
              },
            },
          },
          required: ['score', 'passed', 'failed', 'errors', 'fixedCode'],
        },
      },
    })

    if (!response.text) {
      return res.status(502).json({ error: 'Gemini não retornou resposta' })
    }

    // Repassa o JSON já pronto pro front-end consumir
    return res.status(200).json(JSON.parse(response.text))
  } catch (err) {
    console.error('Erro ao chamar Gemini:', err)
    return res.status(502).json({ error: 'Falha ao consultar o Gemini' })
  }
}
