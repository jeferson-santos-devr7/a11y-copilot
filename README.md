# ♿ A11yCopilot — Validador de Acessibilidade Web com IA

O **A11yCopilot** é uma ferramenta interativa desenvolvida para ajudar desenvolvedores a identificar e corrigir problemas de acessibilidade (WCAG 2.1) em trechos de código HTML ou componentes React.

Utilizando um motor híbrido de validação, o aplicativo combina um scanner local ultra-rápido por expressões regulares com o poder de análise profunda da inteligência artificial do **Groq (LLaMA 3.1)** — executada com segurança no servidor via Vercel Serverless Functions, sem expor a chave de API no navegador.

---

## ✨ Funcionalidades Principais

- **Análise Híbrida (IA + Local):** Checagens instantâneas locais para erros críticos combinadas com diagnósticos contextuais via `llama-3.1-8b-instant` (Groq).
- **Correção Automática de Código:** A IA reescreve o código fornecido aplicando as melhores práticas de acessibilidade (`alt`, `aria-label`, hierarquia de headings, etc).
- **Histórico e Barra Lateral:** Salva o histórico das análises na barra lateral para consulta rápida e alternância instantânea de resultados.
- **Exportação de Relatórios:** Baixe um relatório técnico detalhado em `.txt` com score, erros e sugestões de correção.
- **Resiliência:** Se a IA estiver indisponível, o motor local assume o controle automaticamente — você nunca fica sem diagnóstico.
- **API Segura:** A chave do Groq nunca chega ao navegador — todas as chamadas à IA passam por uma Vercel Serverless Function no servidor.

---

## 🛠️ Tecnologias Utilizadas

- **React** com TypeScript
- **Vite** — ambiente de desenvolvimento rápido
- **Tailwind CSS** — estilização com dark mode
- **Groq API** (`llama-3.1-8b-instant`) — motor de IA via REST, sem SDK no front-end
- **Vercel Serverless Functions** — proxy seguro para chamadas de IA

---

## 🚀 Como Executar Localmente

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/) instalado

### 2. Clonar e instalar dependências

```bash
git clone https://github.com/jeferson-santos-devr7/a11y-copilot.git
cd a11y-copilot
npm install
```

### 3. Configurar variável de ambiente

Crie um arquivo `.env.local` na raiz do projeto:

```bash
GROQ_API_KEY=sua_chave_aqui
```

Obtenha sua chave gratuita em [console.groq.com](https://console.groq.com).

### 4. Iniciar o servidor de desenvolvimento

```bash
npm run dev
```

Acesse [http://localhost:5173](http://localhost:5173).

> **Nota:** Para testar a integração com a IA localmente, é necessário rodar via `vercel dev` (requer [Vercel CLI](https://vercel.com/docs/cli)) pois a Serverless Function não é executada pelo Vite.

---

## 🔒 Arquitetura de Segurança

```
Navegador (React)
      │
      │  POST /api/analyze  { codeInput }
      ▼
Vercel Serverless Function  (/api/analyze.ts)
      │
      │  GROQ_API_KEY (variável de ambiente, nunca exposta)
      │
      ▼
Groq API → llama-3.1-8b-instant
      │
      ▼
JSON com erros, score e código corrigido
      │
      ▼
Navegador (exibe resultado)
```

---

## 📁 Estrutura do Projeto

```
a11y-copilot/
├── api/
│   └── analyze.ts        # Serverless Function — proxy seguro pro Groq
├── src/
│   ├── App.tsx            # Componente principal (UI + lógica)
│   ├── types/             # Interfaces TypeScript
│   └── utils/
│       └── localEngine.ts # Motor local de validação por regex
├── public/
└── index.html
```

---

## 🌐 Deploy

O projeto está publicado em: [a11y-copilot.vercel.app](https://a11y-copilot.vercel.app)

Para deploy próprio:
1. Fork o repositório
2. Importe no [Vercel](https://vercel.com)
3. Adicione a variável de ambiente `GROQ_API_KEY` em **Settings → Environment Variables**
4. Deploy automático a cada `git push`
