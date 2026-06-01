import type { DiagnosticError } from '../types';

const GENERIC_ALT = ['imagem', 'image', 'foto', 'photo', 'img', 'picture',
  'figura', 'banner', 'icon', 'icone', 'ícone', 'logo', 'logotipo',
  'thumbnail', 'thumb', 'avatar', 'perfil', 'profile', ''];

const GENERIC_ALT_PATTERNS = [
  /^(imagem|image|foto|photo|picture|figura|banner|icon|icone|ícone|logo)(\s+(ou|and|e|de|do|da)?\s*(imagem|foto|photo|banner|picture|figura|promocional|decorativa|generica|genérica))*$/i,
];

const VAGUE_TERMS = ['clique aqui', 'saiba mais', 'acesse', 'ok',
  'clique', 'aqui', 'veja mais', 'leia mais', 'mais'];

export const runLocalSecurityChecks = (code: string): DiagnosticError[] => {
  const errors: DiagnosticError[] = [];
  const norm = code.toLowerCase();

  // 1. Imagens sem alt
  if (norm.includes('<img')) {
    const imgs = code.match(/<img[^>]*>/gi) || [];
    imgs.forEach((img, i) => {
      const altMatch = img.match(/alt=["']([^"']*)["']/i);
      if (!altMatch) {
        const fixed = img.replace('>', ' alt="Descrição da imagem">');
        errors.push({
          id: `local-img-missing-${i}`,
          rule: 'WCAG 1.1.1 - Imagem sem texto alternativo (alt)',
          severity: 'critical',
          message: 'Tag <img> sem atributo alt. Leitores de tela não conseguem descrever a imagem.',
          codeSnippet: img,
          fixedSnippet: fixed,
          suggestion: `Adicione alt descritivo: ${fixed}`,
          source: 'local',
        });
      } else if (GENERIC_ALT.includes(altMatch[1].trim().toLowerCase())) {
        const fixed = img.replace(/alt=["'][^"']*["']/i, 'alt="Descrição real da imagem"');
        errors.push({
          id: `local-img-generic-${i}`,
          rule: 'WCAG 1.1.1 - Texto alternativo genérico ou vazio',
          severity: 'critical',
          message: `O atributo alt="${altMatch[1]}" não descreve o conteúdo da imagem.`,
          codeSnippet: img,
          fixedSnippet: fixed,
          suggestion: 'Substitua por uma descrição real (ex: alt="Gráfico de vendas do 3º trimestre").',
          source: 'local',
        });
      } else {
        const isGenericPattern = GENERIC_ALT_PATTERNS.some(p => p.test(altMatch[1].trim()));
        if (isGenericPattern) {
          const fixed = img.replace(/alt=["'][^"']*["']/i, 'alt="Descrição real da imagem"');
          errors.push({
            id: `local-img-generic-long-${i}`,
            rule: 'WCAG 1.1.1 - Texto alternativo genérico',
            severity: 'critical',
            message: `O atributo alt="${altMatch[1]}" é genérico e não descreve o conteúdo real.`,
            codeSnippet: img,
            fixedSnippet: fixed,
            suggestion: 'Substitua por uma descrição objetiva (ex: alt="Banner de promoção de 50% em eletrônicos").',
            source: 'local',
          });
        }
      }
    });
  }

  // 2. Links vagos
  if (norm.includes('<a')) {
    const links = code.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) || [];
    links.forEach((link, i) => {
      const text = link.replace(/<[^>]*>/g, '').trim().toLowerCase();
      if (VAGUE_TERMS.includes(text)) {
        const fixed = link.replace(/>([^<]*)<\/a>/i, '>Descrição do destino do link</a>');
        errors.push({
          id: `local-vague-link-${i}`,
          rule: 'WCAG 2.4.4 - Texto de link pouco descritivo',
          severity: 'warning',
          message: `Link com texto "${text}" não informa o destino fora de contexto.`,
          codeSnippet: link,
          fixedSnippet: fixed,
          suggestion: 'Use texto descritivo do destino, ex: "Ver detalhes do produto X".',
          source: 'local',
        });
      }
    });
  }

  // 3. div/span fingindo botão
  const fakeBtns = code.match(/<(div|span)[^>]*onclick[\s\S]*?<\/(div|span)>/gi) || [];
  fakeBtns.forEach((el, i) => {
    const tag = el.match(/^<(div|span)/i)?.[1] || 'div';
    const innerText = el.replace(/<[^>]*>/g, '').trim();
    const fixed = `<button type="button">${innerText}</button>`;
    errors.push({
      id: `local-fake-btn-${i}`,
      rule: 'WCAG 4.1.2 - Elemento não semântico simulando botão',
      severity: 'critical',
      message: `<${tag}> com onclick não é acessível por teclado. Usuários sem mouse ficam bloqueados.`,
      codeSnippet: el.length > 120 ? el.slice(0, 120) + '…' : el,
      fixedSnippet: fixed,
      suggestion: `Substitua por <button type="button">: ${fixed}`,
      source: 'local',
    });
  });

  // 4. Inputs sem label
  const inputs = code.match(/<(input|textarea|select)[^>]*>/gi) || [];
  inputs.forEach((input, i) => {
    const inputType = (input.match(/type=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset'].includes(inputType)) return;
    const idMatch = input.match(/id=["']([^"']+)["']/i);
    const hasAria = /aria-label=/i.test(input) || /aria-labelledby=/i.test(input);
    if (!hasAria) {
      if (!idMatch) {
        const fixed = input.replace('>', ' aria-label="Descrição do campo">');
        errors.push({
          id: `local-input-noid-${i}`,
          rule: 'WCAG 1.3.1 - Campo de formulário sem label',
          severity: 'critical',
          message: 'Input sem id e sem aria-label. Leitores de tela não anunciam o propósito do campo.',
          codeSnippet: input,
          fixedSnippet: fixed,
          suggestion: 'Adicione aria-label="Descrição" ou um <label for="id"> correspondente.',
          source: 'local',
        });
      } else {
        const labelPattern = new RegExp(`for=["']${idMatch[1]}["']`, 'i');
        if (!labelPattern.test(code)) {
          const fixed = `<label for="${idMatch[1]}">Descrição do campo</label>\n${input}`;
          errors.push({
            id: `local-input-nolabel-${i}`,
            rule: 'WCAG 1.3.1 - Campo de formulário sem label associado',
            severity: 'critical',
            message: `Input com id="${idMatch[1]}" mas sem <label for="${idMatch[1]}"> correspondente.`,
            codeSnippet: input,
            fixedSnippet: fixed,
            suggestion: `Adicione: <label for="${idMatch[1]}">Descrição</label>`,
            source: 'local',
          });
        }
      }
    }
  });

  // 5. Múltiplos h1
  const h1s = code.match(/<h1[^>]*>/gi) || [];
  if (h1s.length > 1) {
    errors.push({
      id: 'local-multiple-h1',
      rule: 'WCAG 1.3.1 - Múltiplos elementos <h1>',
      severity: 'critical',
      message: `Encontrados ${h1s.length} elementos <h1>. Cada página deve ter apenas um.`,
      codeSnippet: h1s.join(' '),
      fixedSnippet: '<!-- Mantenha apenas 1 <h1> e use <h2>, <h3>... para os demais -->',
      suggestion: 'Mantenha apenas um <h1> e use <h2>, <h3>... para os demais títulos.',
      source: 'local',
    });
  }

  // 6. Saltos de heading
  const headings = code.match(/<h[1-6][^>]*>/gi) || [];
  const levels = headings.map(h => parseInt(h.match(/<h([1-6])/i)?.[1] || '0'));
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      const fixed = headings[i].replace(/h[1-6]/i, `h${levels[i - 1] + 1}`);
      errors.push({
        id: `local-heading-skip-${i}`,
        rule: 'WCAG 1.3.1 - Salto na hierarquia de títulos',
        severity: 'warning',
        message: `Salto de H${levels[i - 1]} para H${levels[i]}. A hierarquia deve ser sequencial.`,
        codeSnippet: headings[i],
        fixedSnippet: fixed,
        suggestion: `Substitua H${levels[i]} por H${levels[i - 1] + 1}.`,
        source: 'local',
      });
    }
  }

  // 7. Landmarks ausentes
  const looksLikePage = norm.includes('<body') || (norm.includes('<div') && headings.length > 0);
  if (looksLikePage) {
    [
      { tag: 'main',   desc: 'Conteúdo principal' },
      { tag: 'nav',    desc: 'Navegação do site' },
      { tag: 'header', desc: 'Cabeçalho da página' },
      { tag: 'footer', desc: 'Rodapé da página' },
    ].forEach(({ tag, desc }) => {
      if (!norm.includes(`<${tag}`)) {
        errors.push({
          id: `local-landmark-${tag}`,
          rule: `WCAG 1.3.6 - Tag semântica <${tag}> ausente`,
          severity: 'warning',
          message: `Ausência de <${tag}> (${desc}). Leitores de tela usam landmarks para navegação rápida.`,
          codeSnippet: '(não encontrado no código)',
          fixedSnippet: `<${tag}>\n  <!-- conteúdo aqui -->\n</${tag}>`,
          suggestion: `Envolva o conteúdo com <${tag}>...</${tag}>.`,
          source: 'local',
        });
      }
    });
  }

  // 8. Button vazio/só emoji
  const buttons = code.match(/<button[^>]*>([\s\S]*?)<\/button>/gi) || [];
  buttons.forEach((btn, i) => {
    const hasAria = /aria-label=/i.test(btn);
    const inner = btn.replace(/<[^>]*>/g, '').trim();
    const textOnly = inner.replace(/[\u{1F000}-\u{1FFFF}\u2600-\u27BF❌✅⚠️🔍📥♿]/gu, '').trim();
    if (!hasAria && textOnly.length === 0 && inner.length > 0) {
      const fixed = btn.replace('<button', `<button aria-label="Descrição da ação"`);
      errors.push({
        id: `local-empty-btn-${i}`,
        rule: 'WCAG 4.1.2 - Botão sem texto acessível',
        severity: 'critical',
        message: `Botão com apenas emoji/símbolo ("${inner}") sem aria-label. Leitores de tela não descrevem a ação.`,
        codeSnippet: btn.length > 120 ? btn.slice(0, 120) + '…' : btn,
        fixedSnippet: fixed,
        suggestion: `Adicione aria-label: ${fixed}`,
        source: 'local',
      });
    }
  });

  // 9. Table sem th
  const tables = code.match(/<table[\s\S]*?<\/table>/gi) || [];
  tables.forEach((table, i) => {
    if (!/<th[\s>]/i.test(table)) {
      const fixed = table.replace(/<td>/gi, '<th scope="col">').replace(/<\/td>/i, '</th>');
      errors.push({
        id: `local-table-no-th-${i}`,
        rule: 'WCAG 1.3.1 - Tabela sem cabeçalhos <th>',
        severity: 'critical',
        message: 'A tabela usa apenas <td> sem <th>. Leitores de tela não associam dados às colunas.',
        codeSnippet: table.length > 150 ? table.slice(0, 150) + '…' : table,
        fixedSnippet: fixed.length > 150 ? fixed.slice(0, 150) + '…' : fixed,
        suggestion: 'Substitua os <td> da 1ª linha por <th scope="col">Nome</th>.',
        source: 'local',
      });
    }
  });

  return errors;
};
