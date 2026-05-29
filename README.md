# ♿ A11yCopilot — Validador de Acessibilidade Web com IA

O **A11yCopilot** é uma ferramenta interativa desenvolvida para ajudar desenvolvedores a identificar e corrigir problemas de acessibilidade (WCAG 2.2) em trechos de código HTML ou componentes React. 

Utilizando um motor híbrido de validação, o aplicativo combina um scanner local ultra-rápido por expressões regulares com o poder de análise profunda da inteligência artificial do **Google Gemini**.

---

## ✨ Funcionalidades Principais

* **Análise Híbrida (IA + Local):** Realiza checagens instantâneas localmente para erros críticos e usa o modelo `gemini-1.5-flash` para diagnósticos contextuais complexos.
* **Correção Automática de Código:** Além de listar os erros, a IA reescreve o código fornecido, aplicando as melhores práticas de acessibilidade (como atributos `alt`, `aria-label` e correções de hierarquia).
* **Histórico e Barra Lateral:** Salva o histórico das suas análises na barra lateral esquerda para consulta rápida e alternância instantânea de resultados.
* **Exportação de Relatórios:** Permite baixar um relatório técnico detalhado em formato `.txt` contendo o score, erros e sugestões de correção para enviar para a equipe de QA ou desenvolvimento.
* **Resiliência Offline:** Se a API do Google estiver indisponível ou sem chave configurada, o motor local assume o controle para que você nunca fique sem diagnóstico.

---

## 🛠️ Tecnologias Utilizadas

* **React** (com TypeScript)
* **Vite** (Ambiente de desenvolvimento rápido)
* **Tailwind CSS** (Estilização moderna e interface escura/dark mode)
* **@google/genai** (SDK oficial do Google para integração com o Gemini)

---

## 🚀 Como Executar o Projeto Localmente

### 1. Pré-requisitos
Certifique-se de ter o [Node.js](https://nodejs.org/) instalado na sua máquina.

### 2. Clonar e Instalar as Dependências
No seu terminal, navegue até a pasta do projeto e instale os pacotes necessários:

```bash
# Instalar dependências do projeto
npm install

# Garantir a instalação do SDK do Gemini
npm install @google/genai