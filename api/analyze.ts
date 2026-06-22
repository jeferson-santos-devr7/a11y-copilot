import type { VercelRequest, VercelResponse } from '@vercel/node'

const SYSTEM_PROMPT = `Você é um auditor sênior de acessibilidade WCAG 2.1.
Analise o código fornecido e retorne APENAS um JSON válido, sem texto adicional, sem markdown, sem backticks.

O JSON deve ter exatamente esta estrutura:
{
  "score": número de 0 a 100,
  "passed": quantidade de regras que passaram,
  "failed": quantidade de erros encontrados,
  "fixedCode": "o HTML completo corrigido como string",
  "errors": [
    {
      "id": "err-1",
      "rule": "WCAG 1.1.1 - Conteúdo Não Textual",
      "severity": "critical",
      "message": "explicação didática do problema",
      "codeSnippet": "trecho exato com o erro",
      "fixedSnippet": "trecho corrigido pronto para substituição",
      "suggestion": "instrução clara de como corrigir",
      "location": "linha ou elemento aproximado",
      "source": "ai"
    }
  ]
}

Severity só pode ser: "critical", "warning" ou "info".
Retorne SOMENTE o JSON, nada mais.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { codeInput } = req.body as { codeInput?: string }

  if (!codeInput || !codeInput.trim()) {
    return res.status(400).json({ error: 'codeInput é obrigatório' })
  }

  if (codeInput.length > 20000) {
    return res.status(400).json({ error: 'Código muito grande (máximo 20.000 caracteres)' })
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY || ''

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY não configurada no servidor' })
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Analise o código abaixo e retorne o JSON de acessibilidade:\n\n${codeInput}`,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      console.error('Erro Groq:', errBody)
      return res.status(502).json({ error: 'Falha ao consultar a IA' })
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[]
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      return res.status(502).json({ error: 'IA não retornou resposta' })
    }

    const parsed = JSON.parse(content)
    return res.status(200).json(parsed)
  } catch (err) {
    console.error('Erro ao chamar Groq:', err)
    return res.status(502).json({ error: 'Falha ao consultar a IA' })
  }
}