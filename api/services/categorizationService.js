/**
 * Ticket Auto-Categorization — keyword-based AI categorization.
 * Analyzes ticket reason/description and assigns a category.
 * No external API dependency — uses weighted keyword matching.
 */

const CATEGORY_RULES = [
  {
    category: 'denuncia',
    label: 'Denúncia',
    keywords: [
      'denunci', 'denúncia', 'reportar', 'report', 'abuso', 'irregularidade',
      'corrupc', 'corrupção', 'conduta', 'infração', 'infrac', 'ilegal',
      'criminoso', 'crime', 'furto', 'roubo', 'assédio', 'assedio',
      'ameac', 'ameaça', 'violênci', 'violencia', 'agressão', 'agressao'
    ],
    weight: 3
  },
  {
    category: 'corregedoria',
    label: 'Corregedoria',
    keywords: [
      'corregedoria', 'assuntos internos', 'interno', 'investigac',
      'investigação', 'disciplinar', 'punição', 'punicao', 'suspensão',
      'suspensao', 'exonerac', 'exoneração', 'desvio', 'má conduta'
    ],
    weight: 3
  },
  {
    category: 'reclamacao',
    label: 'Reclamação',
    keywords: [
      'reclam', 'reclamação', 'reclamacao', 'insatisf', 'insatisfação',
      'problema', 'péssim', 'pessim', 'horrível', 'horrivel', 'indignado',
      'descaso', 'negligência', 'negligencia', 'incompetên', 'incompeten'
    ],
    weight: 2
  },
  {
    category: 'elogio',
    label: 'Elogio',
    keywords: [
      'elogio', 'elogiar', 'parabéns', 'parabens', 'excelente', 'ótimo',
      'otimo', 'incrível', 'incrivel', 'agradec', 'agradecer', 'obrigad',
      'fantástico', 'fantastico', 'profissional', 'competente', 'dedicado'
    ],
    weight: 2
  },
  {
    category: 'duvida',
    label: 'Dúvida',
    keywords: [
      'dúvida', 'duvida', 'pergunt', 'como faz', 'como func', 'informação',
      'informacao', 'explicar', 'entender', 'saber', 'orientação', 'orientacao',
      'ajuda', 'help', 'questão', 'questao', 'poderia', 'gostaria'
    ],
    weight: 1
  },
  {
    category: 'solicitacao',
    label: 'Solicitação',
    keywords: [
      'solicita', 'solicito', 'requerer', 'requer', 'pedir', 'pedido',
      'preciso', 'necessito', 'gostaria', 'favor', 'cadastr', 'registr',
      'atualiz', 'alterar', 'mudar', 'transferência', 'transferencia',
      'porte', 'passaporte', 'visto', 'documento'
    ],
    weight: 1
  },
  {
    category: 'bug',
    label: 'Bug / Erro',
    keywords: [
      'bug', 'erro', 'error', 'falha', 'quebrado', 'crash', 'trav',
      'não funciona', 'nao funciona', 'bugado', 'defeito', 'glitch',
      'problema técnico', 'problema tecnico'
    ],
    weight: 2
  },
  {
    category: 'suporte',
    label: 'Suporte Geral',
    keywords: [
      'suporte', 'atendimento', 'assistência', 'assistencia', 'ajuda',
      'auxilio', 'auxílio', 'apoio', 'contato', 'falar com'
    ],
    weight: 1
  }
];

/**
 * Categorize a ticket based on reason + description text.
 * Returns the best matching category or 'geral' if no match.
 */
function categorize(reason = '', description = '') {
  const text = `${reason} ${description}`.toLowerCase().normalize('NFD');

  const scores = {};

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const keyword of rule.keywords) {
      const normalizedKw = keyword.toLowerCase().normalize('NFD');
      if (text.includes(normalizedKw)) {
        score += rule.weight;
      }
    }
    if (score > 0) {
      scores[rule.category] = score;
    }
  }

  // Return the highest scoring category
  const entries = Object.entries(scores);
  if (entries.length === 0) return 'geral';

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/**
 * Get category label for display.
 */
function getCategoryLabel(category) {
  const labels = {
    denuncia: 'Denúncia',
    corregedoria: 'Corregedoria',
    reclamacao: 'Reclamação',
    elogio: 'Elogio',
    duvida: 'Dúvida',
    solicitacao: 'Solicitação',
    bug: 'Bug / Erro',
    suporte: 'Suporte Geral',
    geral: 'Geral'
  };
  return labels[category] || 'Geral';
}

/**
 * Get all category labels.
 */
function getAllCategories() {
  return CATEGORY_RULES.map(r => ({ value: r.category, label: r.label }));
}

module.exports = {
  categorize,
  getCategoryLabel,
  getAllCategories,
  CATEGORY_RULES
};
