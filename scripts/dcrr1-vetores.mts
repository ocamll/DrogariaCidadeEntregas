// GOLDEN VECTORS DO DCRR1 — o canônico do Romaneio de Retorno.
//
// ESTES VETORES FORAM ESCRITOS À MÃO A PARTIR DA ESPECIFICAÇÃO, antes de
// existir qualquer implementação. É o ponto inteiro deles.
//
// POR QUE ELES EXISTEM
//
// O canônico tem duas implementações gêmeas (TypeScript e SQL) que
// precisam produzir os mesmos bytes. Comparar uma com a outra prova que
// CONCORDAM, não que estão CERTAS: o TS pode ter um defeito, o SQL copiar
// o mesmo entendimento, os dois concordarem e o teste passar.
//
// Com os vetores passam a existir três referências — especificação,
// vetores, implementações — em vez de duas. É por isso que eles vêm
// ANTES do TypeScript e do SQL, e não depois.
//
// COMO REVISAR À MÃO (e vale revisar pelo menos um)
//
// O canônico está escrito linha a linha, com `\t` EXPLÍCITO. Isso é
// deliberado: um TAB literal no fonte é invisível, e vetor que ninguém
// consegue enxergar é pior que vetor nenhum.
//
// Confira contra a seção "DCRR1" do CLAUDE.md:
//
//   DCRR1
//   saida        <uuid>
//   saida_hash   <document_hash da saída>
//   motoboy      <uuid>
//   responsavel  <uuid>
//   v   <entrega_id>  <desfecho>  <motivo>  <detalhe>
//   pr  <entrega_id>  <pagamento_id>  <forma>  <valor_cents>  <troco_cents>
//
// O `sha256` de cada vetor é calculado a partir do texto canônico por
// biblioteca padrão — ele não é o que está sob revisão, o TEXTO é. Para
// conferir por um caminho independente, cole o texto no SQL Editor:
//
//   select encode(digest('<texto>', 'sha256'), 'hex');
//
// AS REGRAS QUE OS VETORES CONGELAM
//
//   * `-` para nulo; string vazia continua vazia (V007 separa os dois)
//   * TAB, CR e LF viram espaço — `translate(texto, E'\t\n\r', '   ')`,
//     a MESMA regra da saída, reusada verbatim (V005)
//   * normalização é do canônico, não da validação: `entregue` força
//     motivo e detalhe a `-` mesmo que a entrada traga outra coisa (V004)
//   * vales ordenados por `entrega_id`; pagamentos em bloco próprio
//     DEPOIS de todos os vales, ordenados por (entrega_id, pagamento_id)
//     — ordenação por code unit, nunca por locale (V006)
//   * sem `\n` final
//
// UM CUIDADO SOBRE UNICODE E ORDENAÇÃO: os vetores põem acento e
// caracteres fora do BMP só em campos de TEXTO, nunca em chave de
// ordenação. Ordem por code unit (UTF-16, no TS) e por byte
// (`collate "C"`, no SQL) coincidem para hex de UUID, mas NÃO coincidem
// acima do BMP. Como só UUID é ordenado, isso nunca morde — e é por isso
// que nenhum vetor tenta ordenar texto.

// O DOMÍNIO É O CHECK DE `pagamentos.forma`, e essa lista foi corrigida
// em 2026-08-20 — ver o vetor I010, que já dizia isso quando o contrato
// foi congelado.
//
// A lista original daqui era a do SCHEMA INICIAL (2026-08-06), que a
// migration `20260807123331` substituiu doze dias antes de o DCRR1 ser
// congelado: `vale` saiu ("não é usado, confundia com número do vale da
// entrega") e entraram `convcard` e `crediario`. Os três lugares —
// vetores, `canonicoRetorno.ts` e o gêmeo SQL — copiaram o mesmo engano,
// que é exatamente o que os golden vectors existiam pra impedir e não
// impediram, porque o erro estava neles também.
//
// O que isso teria custado na 2B: um cliente que paga com cartão de
// convênio faz o canônico responder `forma_invalida` e o retorno NÃO
// sela — depois de colhidas as duas assinaturas. E `vale` passaria pelo
// canônico pra morrer no INSERT, dentro da mesma transação.
//
// Corrigir custou nada porque nenhum retorno real foi selado ainda. Ver
// V009 e V010 pros dois casos novos, e I013 pro `vale`.
export type PagamentoRealizadoCanonico = {
  pagamentoId: string
  forma:
    | 'dinheiro'
    | 'credito'
    | 'debito'
    | 'pix'
    | 'convenio'
    | 'convcard'
    | 'crediario'
  valorCents: number
  trocoCents: number
}

// CUSTÓDIA FÍSICA DE DOCUMENTO, e SÓ isso.
//
// Acrescentado em 2026-08-20, com o processo real da farmácia. Dois tipos
// de venda geram um papel que sai com o motoboy e tem que voltar pra
// filial: o CONVÊNIO e o CREDIÁRIO. O do crediário é a nota que o cliente
// assina formalizando o aceite da dívida.
//
// `convcard` NÃO ENTRA AQUI, e a distinção é o ponto: nele o cliente
// manda os dados do cartão e a farmácia processa a compra — não há papel
// saindo com ninguém. Três conceitos distintos, e confundir convênio com
// convcard seria inventar custódia onde não existe.
//
// O DOMÍNIO DA SITUAÇÃO É DELIBERADAMENTE POBRE. No instante do retorno,
// caixa e motoboy só conseguem afirmar duas coisas:
//
//     recebido   o papel voltou pra custódia da filial
//     faltante   o papel que deveria voltar não veio
//
// `recebido` é PRESENÇA FÍSICA, nada além. Nada de `retornado_assinado`,
// `assinatura_valida`, `irregular` ou `conferido`: tudo isso depende da
// conferência do gestor, que acontece DEPOIS e é outro fluxo. Um
// documento que voltou sem assinatura é `recebido` — porque fisicamente
// foi —, e a irregularidade vira evento posterior. Pôr o julgamento aqui
// faria o documento assinado afirmar o que quem assinou não tinha como
// saber.
//
// Por isso este par é válido e não é contraditório:
//
//     v   E1  insucesso  ausente  -
//     d   E1  crediario  recebido
//
// A entrega falhou e o papel voltou em branco. O retorno físico
// aconteceu.
//
// E a RECEITA, desde 2026-09-14 (V017, V018): o usuário decidiu conferi-la
// no retorno, dentro do documento assinado. Ela não sai com a entrega — vem
// do cliente —, e por isso a expectativa não é derivada de forma de
// pagamento: é a linha `r` da saída que a afirma. Recebê-la não quita o
// convênio; são documentos distintos.
export type DocumentoFisicoCanonico = {
  tipo: 'convenio' | 'crediario' | 'receita'
  situacao: 'recebido' | 'faltante'
}

export type ValeRetornoCanonico = {
  entregaId: string
  desfecho: 'entregue' | 'insucesso'
  motivo: 'ausente' | 'endereco_errado' | 'recusou' | 'outro' | null
  detalhe: string | null
  pagamentosRealizados: PagamentoRealizadoCanonico[]
  // ANINHADO no vale, como os pagamentos, e pelo mesmo motivo: com o
  // `entrega_id` vindo do pai, "documento apontando pra vale que não está
  // no documento" fica INDESCRITÍVEL por construção. Tornar um erro
  // impossível de representar vale mais que rejeitá-lo — e obriga o lado
  // SQL a espelhar o aninhamento.
  //
  // A identidade da linha é (entrega_id, tipo), não só entrega_id: um
  // vale pode ter convênio e crediário ao mesmo tempo.
  documentos: DocumentoFisicoCanonico[]
}

export type EntradaRetorno = {
  saidaRomaneioId: string
  saidaDocumentHash: string
  motoboyId: string
  responsavelId: string
  vales: ValeRetornoCanonico[]
}

export type Vetor = {
  nome: string
  /** O que este vetor existe pra travar. Se cair, é isto que quebrou. */
  porque: string
  entrada: EntradaRetorno
  /** Escrito à mão a partir da especificação. É ISTO que está sob revisão. */
  canonico: string
  /** Bytes UTF-8 do texto. Critério separado de propósito: quando algo
   *  diverge, contagem de bytes dá diagnóstico muito melhor que um hash
   *  diferente — e o V003, fora do BMP, é o que revela confusão entre
   *  `length` do JavaScript (UTF-16) e bytes reais do documento. */
  bytes: number
  /** SHA-256 dos bytes UTF-8 do texto acima, por biblioteca padrão. */
  sha256: string
}

// UUIDs legíveis de propósito: o sufixo diz o que é, e a ordem entre eles
// é óbvia a olho nu — o que importa em V006.
const SAIDA = '019fe83f-1d58-70e9-8dd8-0000000000a1'
const SAIDA_HASH = 'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f'
const MOTOBOY = '019fe83f-1d58-70e9-8dd8-0000000000b1'
const RESPONSAVEL = '019fe83f-1d58-70e9-8dd8-0000000000c1'
const E1 = '019fe83f-1d58-70e9-8dd8-0000000000e1'
const E2 = '019fe83f-1d58-70e9-8dd8-0000000000e2'
const E3 = '019fe83f-1d58-70e9-8dd8-0000000000e3'
const P1 = '019fe83f-1d58-70e9-8dd8-0000000000f1'
const P2 = '019fe83f-1d58-70e9-8dd8-0000000000f2'
const P3 = '019fe83f-1d58-70e9-8dd8-0000000000f3'

const CABECALHO = [
  'DCRR1',
  `saida\t${SAIDA}`,
  `saida_hash\t${SAIDA_HASH}`,
  `motoboy\t${MOTOBOY}`,
  `responsavel\t${RESPONSAVEL}`,
]

export const VETORES: Vetor[] = [
  {
    nome: 'V001 — o mínimo: um vale entregue, um pagamento',
    porque:
      'A forma base. Se este cair, é o cabeçalho ou a estrutura da linha, ' +
      'não uma regra fina.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'pix', valorCents: 12345, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tpix\t12345\t0`,
    ].join('\n'),
    bytes: 359,
    sha256: 'c6d4a10382ca1b388e0549fc90b09f78594f216c58265fd427168b22ff323089',
  },

  {
    nome: 'V002 — insucesso com motivo, sem pagamento nenhum',
    porque:
      'Vale que não foi entregue não gera pagamento realizado. Prova que o ' +
      'bloco `pr` pode ficar vazio e que o canônico não termina em \\n.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'ausente',
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [],
        },
      ],
    },
    canonico: [...CABECALHO, `v\t${E1}\tinsucesso\tausente\t-`].join('\n'),
    bytes: 277,
    sha256: '6dc64502e82b02623ae7534ac1f4ec344fa30775c39e3b996ce4317b1df7978d',
  },

  {
    nome: 'V003 — motivo "outro" com detalhe acentuado e fora do BMP',
    porque:
      'Com motivo `outro`, o detalhe É o motivo. Acento é certeza em ' +
      'produção ("José", "Conceição"), e o emoji exercita par substituto ' +
      'UTF-16 — os dois lados têm que preservar byte a byte, sem normalizar.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'outro',
          detalhe: 'Endereço da Conceição não existe — José confirmou 🛵',
          pagamentosRealizados: [],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tinsucesso\toutro\tEndereço da Conceição não existe — José confirmou 🛵`,
    ].join('\n'),
    bytes: 335,
    sha256: '3abeba9dc7449da112d166b5db0aca891ef5d6d766c56d7e5efd3ab2bf90ed79',
  },

  {
    nome: 'V004 — NORMALIZAÇÃO: entregue com motivo e detalhe sujos na entrada',
    porque:
      'A regra mais importante do conjunto. `entregue` FORÇA motivo e ' +
      'detalhe a `-`, dentro do construtor do canônico. Se isso ficasse só ' +
      'na validação, um input malformado passaria por um lado e não pelo ' +
      'outro, e os bytes divergiriam — o modo de falha que não dá erro claro.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          // lixo de propósito: a tela nunca mandaria isso, mas a fila
          // offline pode carregar um payload antigo, e o canônico não pode
          // depender de quem chamou ter se comportado
          motivo: 'ausente',
          detalhe: 'isto não pode aparecer no canônico',
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'dinheiro', valorCents: 5000, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tdinheiro\t5000\t0`,
    ].join('\n'),
    bytes: 363,
    sha256: 'ed851c65b151514e9b4714becfc8239bd9eb26cf001a610905d588b639c66c18',
  },

  {
    nome: 'V005 — TAB, CR e LF no detalhe viram espaço',
    porque:
      'TAB é o separador de campo e LF o de linha: sem sanear, um detalhe ' +
      'colado quebraria a estrutura do documento. A regra é a MESMA da ' +
      'saída, `translate(texto, E\'\\t\\n\\r\', \'   \')`, reusada verbatim. ' +
      'Repare que ela NÃO É INJETIVA: o resultado abaixo é indistinguível ' +
      'de um detalhe digitado já com espaços.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'outro',
          detalhe: 'Cliente disse:\r\n"volto\tamanhã"\nnão insisti',
          pagamentosRealizados: [],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      // \r\n vira DOIS espaços (cada um é substituído), \t vira um, \n vira um
      `v\t${E1}\tinsucesso\toutro\tCliente disse:  "volto amanhã" não insisti`,
    ].join('\n'),
    bytes: 318,
    sha256: '3de68637d98c1dba6a20ed43aacc48ce57bfba10a303d476d01387e7dbbaef0c',
  },

  {
    nome: 'V006 — ORDENAÇÃO: vales e pagamentos fora de ordem na entrada',
    porque:
      'O canônico não pode depender da ordem em que a tela montou a lista. ' +
      'Vales por `entrega_id`; pagamentos em bloco próprio DEPOIS de todos ' +
      'os vales, por (entrega_id, pagamento_id). Ordem por code unit, nunca ' +
      'por locale — `localeCompare` no TS ou collation padrão no SQL é ' +
      'exatamente o que o `collate "C"` existe pra eliminar.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E3,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P2, forma: 'debito', valorCents: 300, trocoCents: 0 },
            { pagamentoId: P1, forma: 'credito', valorCents: 200, trocoCents: 0 },
          ],
          documentos: [],
        },
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'recusou',
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [],
        },
        {
          entregaId: E2,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P3, forma: 'pix', valorCents: 100, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tinsucesso\trecusou\t-`,
      `v\t${E2}\tentregue\t-\t-`,
      `v\t${E3}\tentregue\t-\t-`,
      `pr\t${E2}\t${P3}\tpix\t100\t0`,
      `pr\t${E3}\t${P1}\tcredito\t200\t0`,
      `pr\t${E3}\t${P2}\tdebito\t300\t0`,
    ].join('\n'),
    bytes: 649,
    sha256: '2b53ae38d3aa9f0ab436b4a34845fe509febef03ac9fee447f1c5a9a29ac94fe',
  },

  {
    nome: 'V007 — string vazia NÃO é nulo',
    porque:
      '`coalesce(texto, \'-\')` só troca NULO. String vazia continua vazia, ' +
      'e no canônico isso aparece como a linha terminando em TAB. Os dois ' +
      'lados precisam concordar, senão um manda `-` e o outro manda nada. ' +
      'No TypeScript isto pega o clássico `valor || \'-\'`, que engole a ' +
      'string vazia junto com o nulo — o correto testa `=== null` e ' +
      '`=== undefined`.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      // Motivo `ausente`, não `outro`: a regra congelada exige detalhe
      // não-vazio quando o motivo é `outro`, então usar `outro` aqui faria
      // este vetor VÁLIDO codificar uma entrada que os vetores INVÁLIDOS
      // rejeitam. Detalhe é opcional nos demais motivos, que é onde a
      // distinção entre '' e nulo pode legitimamente aparecer.
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'ausente',
          detalhe: '',
          pagamentosRealizados: [],
          documentos: [],
        },
        {
          entregaId: E2,
          desfecho: 'insucesso',
          motivo: 'ausente',
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      // detalhe vazio: a linha termina em TAB, sem nada depois
      `v\t${E1}\tinsucesso\tausente\t`,
      // detalhe nulo: vira '-'
      `v\t${E2}\tinsucesso\tausente\t-`,
    ].join('\n'),
    bytes: 335,
    sha256: '7ace78057f9e0b17b797f4653b413e0aec6580b352ecb5185fef6c3b96061c4f',
  },

  {
    nome: 'V008 — várias formas no mesmo vale, com troco',
    porque:
      'O caso real de "metade pix, metade dinheiro" que a tabela ' +
      '`pagamentos` existe pra suportar (1:N de verdade, ver o CLAUDE.md). ' +
      'Troco diferente de zero entra no canônico: é dinheiro que trocou de ' +
      'mão e o motoboy está assinando por ele.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'pix', valorCents: 5000, trocoCents: 0 },
            { pagamentoId: P2, forma: 'dinheiro', valorCents: 7000, trocoCents: 1500 },
          ],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tpix\t5000\t0`,
      `pr\t${E1}\t${P2}\tdinheiro\t7000\t1500`,
    ].join('\n'),
    bytes: 454,
    sha256: 'b6621d141b61a874e34aa47e7ca347661d1211982552bb71e2f53ea6edd28727',
  },

  {
    nome: 'V009 — convcard, o cartão de convênio da própria farmácia',
    porque:
      'Acrescentado em 2026-08-20, junto da correção do domínio. O fluxo ' +
      'real: o cliente manda os dados do cartão e a farmácia passa a ' +
      'compra — o cartão não está na porta, mas a venda é processada, ' +
      'então é forma de pagamento de verdade e o documento assinado tem ' +
      'que poder dizer isso. Antes desta correção o canônico recusaria ' +
      '`forma_invalida` DEPOIS de colhidas as duas assinaturas.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'convcard', valorCents: 8500, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tconvcard\t8500\t0`,
    ].join('\n'),
    bytes: 363,
    sha256: 'cbe90fb86fe7c9315e89e530d3c86e49ad70f18c6bd8638bc1a08681e4604e48',
  },

  {
    nome: 'V010 — crediário: a forma financeira, e SÓ ela',
    porque:
      'O crediário tem duas naturezas ao mesmo tempo, e este vetor congela ' +
      'só uma. A linha `pr` afirma o PAGAMENTO — "o realizado desta ' +
      'entrega foi crediário, R$ 120,00". O papel que sai junto pra o ' +
      'cliente assinar é OUTRO FATO, e deliberadamente não está ' +
      'representado aqui: enfiá-lo na linha de pagamento faria o documento ' +
      'confundir "o dinheiro foi combinado" com "o papel voltou ' +
      'assinado". Decidido em 2026-08-20 — ver a nota sobre o bloco `d` no ' +
      'CLAUDE.md, que fica pra depois de levantar o fluxo do papel.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'crediario', valorCents: 12000, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tcrediario\t12000\t0`,
    ].join('\n'),
    bytes: 365,
    sha256: 'c88e6feea9bb23812523bdfc8a04705c9f3dcfc0bf9fd4195925117c0c0a25b7',
  },

  // ===================================================================
  // O BLOCO `d` — custódia física, acrescentado em 2026-08-20
  //
  // Os dez acima seguem valendo byte a byte: bloco `d` vazio não produz
  // linha nenhuma, então acrescentar o campo não moveu um hash. Foi a
  // primeira coisa medida.
  // ===================================================================

  {
    nome: 'V011 — crediário: o pagamento E o papel, um em cada bloco',
    porque:
      'O caso base da custódia, e o que separa as duas naturezas do ' +
      'crediário: a linha `pr` diz o que aconteceu com o DINHEIRO, a ' +
      'linha `d` diz o que aconteceu com o PAPEL. Uma não substitui a ' +
      'outra, e um documento que confundisse as duas afirmaria que "o ' +
      'valor foi combinado" quando quisesse dizer "a nota voltou".',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'crediario', valorCents: 12000, trocoCents: 0 },
          ],
          documentos: [{ tipo: 'crediario', situacao: 'recebido' }],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tcrediario\t12000\t0`,
      `d\t${E1}\tcrediario\trecebido`,
    ].join('\n'),
    bytes: 423,
    sha256: '13f83e93a3b4eedf290315cda7cec87a32015992cbbb4c895964e8d00dbd88b7',
  },

  {
    nome: 'V012 — crediário com o papel FALTANTE',
    porque:
      '`faltante` descreve o estado físico NO INSTANTE em que o retorno ' +
      'foi selado, e não um desfecho: o processo da farmácia é que o ' +
      'papel PRECISA vir, então isto é pendência aberta. A chegada ' +
      'posterior do documento não corrige nem reescreve este DCRR1 — ela ' +
      'é evento novo sobre o vale. Alguém vai querer "consertar" este ' +
      'faltante pra recebido daqui a seis meses; é a regra 7 dizendo que ' +
      'não.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'crediario', valorCents: 12000, trocoCents: 0 },
          ],
          documentos: [{ tipo: 'crediario', situacao: 'faltante' }],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tcrediario\t12000\t0`,
      `d\t${E1}\tcrediario\tfaltante`,
    ].join('\n'),
    bytes: 423,
    sha256: 'bb7fcb8668e3887322b7fd045652b18db60892bb5543aa65bc719371cdf492c5',
  },

  {
    nome: 'V013 — convênio, o outro tipo com papel',
    porque:
      'O convênio segue a mesma lógica de custódia do crediário: gera um ' +
      'documento físico que vai pro cliente assinar e tem que voltar. ' +
      'Este vetor existe pra travar que são DOIS tipos no domínio, e não ' +
      'um — e pra deixar registrado que `convcard` NÃO é este caso: nele ' +
      'o cliente manda os dados do cartão e a farmácia processa, sem ' +
      'papel saindo com ninguém.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'convenio', valorCents: 9000, trocoCents: 0 },
          ],
          documentos: [{ tipo: 'convenio', situacao: 'recebido' }],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tconvenio\t9000\t0`,
      `d\t${E1}\tconvenio\trecebido`,
    ].join('\n'),
    bytes: 420,
    sha256: 'f0d512e8e63a4f57ce049d44ea4228ecfd10ff2fc23ce484c893527f61a26d9d',
  },

  {
    nome: 'V014 — INSUCESSO com o papel recebido: válido, e não contraditório',
    porque:
      'Parece contradição e não é. O papel foi emitido na venda e saiu ' +
      'sob custódia do motoboy; a entrega falhou e ele voltou EM BRANCO. ' +
      '`recebido` significa PRESENÇA FÍSICA, nada mais — não afirma ' +
      'assinatura, validade nem preenchimento. É por isso que o domínio ' +
      'da situação tem só dois valores: qualquer coisa além disso ' +
      'dependeria da conferência do gestor, que é outro fluxo e acontece ' +
      'depois. Repare que não há linha `pr`: insucesso não gera pagamento ' +
      'realizado, mas gera obrigação de dizer onde o papel foi parar.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'ausente',
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [{ tipo: 'crediario', situacao: 'recebido' }],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tinsucesso\tausente\t-`,
      `d\t${E1}\tcrediario\trecebido`,
    ].join('\n'),
    bytes: 335,
    sha256: '633093cc57a9cb8c82a1a53f3ea9652343d182d5d987c3dd7bc298c6abe72fe5',
  },

  {
    nome: 'V015 — o mesmo vale com os DOIS tipos de documento',
    porque:
      'É o que torna a identidade da linha `d` o par (entrega_id, tipo) e ' +
      'não só entrega_id. Trava também a ordenação DENTRO do vale: ' +
      '"convenio" < "crediario" por code unit (o `o` de conv vem antes do ' +
      '`r` de cred), e é essa a ordem que sai, independente da ordem de ' +
      'entrada. E mostra que os dois documentos convivem com um único ' +
      '`pr`: quantos papéis saem não tem relação com quantos pagamentos ' +
      'houve.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'crediario', valorCents: 12000, trocoCents: 0 },
          ],
          // Na entrada, crediário primeiro. Na saída, convênio primeiro.
          documentos: [
            { tipo: 'crediario', situacao: 'recebido' },
            { tipo: 'convenio', situacao: 'recebido' },
          ],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tcrediario\t12000\t0`,
      `d\t${E1}\tconvenio\trecebido`,
      `d\t${E1}\tcrediario\trecebido`,
    ].join('\n'),
    bytes: 480,
    sha256: 'bfdcbf9486e1cc7bf9d3445ae79a0302d41c4e8c54dd39502a02199d49bf908a',
  },

  {
    nome: 'V016 — ORDENAÇÃO do bloco `d` nos dois eixos, com a entrada embaralhada',
    porque:
      'O irmão do V006, pro bloco novo. A entrada traz os vales em ordem ' +
      'inversa e os documentos de E2 fora da ordem de tipo; a saída sai ' +
      'ordenada por (entrega_id, tipo_documento). Sem ele, um gêmeo ' +
      'poderia ordenar só pelo primeiro eixo e concordar com o outro em ' +
      'todos os casos de um documento por vale — e divergir no primeiro ' +
      'vale real com dois. Também prova que o bloco `d` vem DEPOIS de ' +
      'todos os `v`, e não intercalado.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E2,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [
            { tipo: 'crediario', situacao: 'recebido' },
            { tipo: 'convenio', situacao: 'faltante' },
          ],
        },
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [{ tipo: 'crediario', situacao: 'faltante' }],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `v\t${E2}\tentregue\t-\t-`,
      `d\t${E1}\tcrediario\tfaltante`,
      `d\t${E2}\tconvenio\tfaltante`,
      `d\t${E2}\tcrediario\trecebido`,
    ].join('\n'),
    bytes: 495,
    sha256: '3767a590eae4cf270e1c0b6dc0a3cdef88787d0da15b787430cfaf8bf5e2df7f',
  },

  // ===================================================================
  // A RECEITA — acrescentada em 2026-09-14
  //
  // Os dezesseis acima seguem valendo byte a byte: `receita` é só um valor
  // a mais no domínio do bloco `d`, e nenhum deles o usa.
  // ===================================================================

  {
    nome: 'V017 — a receita junto do convênio, no mesmo vale',
    porque:
      'A receita é documento DISTINTO do convênio, e o mesmo vale pode exigir ' +
      'os dois — receber um não quita o outro. Trava também a ordem dentro ' +
      'do vale: "convenio" < "receita" por code unit, com a entrada ao ' +
      'contrário. A expectativa da receita sai da linha `r` da saída, não do ' +
      'pagamento em convênio.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'convenio', valorCents: 9000, trocoCents: 0 },
          ],
          // Na entrada, receita primeiro. Na saída, convênio primeiro.
          documentos: [
            { tipo: 'receita', situacao: 'recebido' },
            { tipo: 'convenio', situacao: 'recebido' },
          ],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tconvenio\t9000\t0`,
      `d\t${E1}\tconvenio\trecebido`,
      `d\t${E1}\treceita\trecebido`,
    ].join('\n'),
    bytes: 476,
    sha256: '4b4627e1f4071e9f2723d67917b1e3737e5d888aa743b24b90ec58b1fa92beb8',
  },

  {
    nome: 'V018 — insucesso com a receita FALTANTE',
    porque:
      'O cliente estava ausente: não houve entrega, não houve dinheiro, e a ' +
      'receita que tinha que voltar não veio. O `d` não é filtrado por ' +
      'desfecho (V014), e `faltante` é pendência aberta — a chegada posterior ' +
      'não reescreve este documento, vira registro novo sobre o vale.',
    entrada: {
      saidaRomaneioId: SAIDA,
      saidaDocumentHash: SAIDA_HASH,
      motoboyId: MOTOBOY,
      responsavelId: RESPONSAVEL,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'ausente',
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [{ tipo: 'receita', situacao: 'faltante' }],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tinsucesso\tausente\t-`,
      `d\t${E1}\treceita\tfaltante`,
    ].join('\n'),
    bytes: 333,
    sha256: '1ed0bd5d390a2c8e1e28eed3c71d6ed03d84fd3330fa27c13f1e799e77dd79ad',
  },
]

// =====================================================================
// VETORES INVÁLIDOS — o que NÃO pode ser serializado
//
// Os oito acima congelam COMO serializar. Estes congelam O QUE É
// PERMITIDO serializar, e fecham uma classe de divergência que os
// válidos não alcançam:
//
//     TS aceita  ·  SQL rejeita
//
// Os dois lados podem produzir bytes idênticos para toda entrada válida
// e ainda assim discordar sobre o que é válido — e o sintoma seria o de
// sempre: "o retorno offline não sincroniza", meses depois.
//
// Eles NÃO têm canônico nem hash. O resultado esperado é a recusa, e o
// `motivo` faz parte do contrato: os dois lados precisam recusar pelo
// MESMO motivo, senão a tela mostra uma coisa e o servidor outra.
//
// REJEIÇÃO NÃO É NORMALIZAÇÃO, e a diferença decide o desenho. O V004
// (entregue com motivo sujo) é NORMALIZADO: o construtor força `-`, e
// pode, porque `entregue` não tem motivo por definição. Já `insucesso`
// sem motivo é RECUSADO — não há valor que o construtor pudesse
// inventar sem afirmar o que não sabe.
//
// UM CASO DA LISTA QUE NÃO APARECE AQUI, e a ausência é a resposta:
// "pagamento apontando para entrega_id que não existe no bloco v". No
// TypeScript ele é INDESCRITÍVEL, porque `pagamentosRealizados` é
// aninhado dentro do vale e o `entrega_id` da linha `pr` vem do pai.
// Tornar um erro impossível de representar vale mais que rejeitá-lo.
//
// CONSEQUÊNCIA PARA O LADO SQL (etapa 2A item 5): ele tem que ESPELHAR o
// aninhamento — laço sobre vales e, dentro dele, laço sobre os pagamentos
// daquele vale. Um `select` plano de `pagamentos` reabriria exatamente o
// caso que o TypeScript fechou por construção.
// =====================================================================

// A FRONTEIRA, congelada em 2026-08-20 — e ela decide o que PODE ser um
// vetor inválido aqui.
//
//   O CANÔNICO É PURO. Sabe se o payload é estruturalmente válido, se os
//   domínios são válidos, se há duplicata, como normalizar, ordenar e
//   serializar. NÃO sabe o que saiu naquela corrida, quais documentos
//   eram esperados, nem se faltou ou sobrou em relação à saída.
//
//   `selar_romaneio_retorno` sabe qual é a saída selada, quais vales
//   pertencem a ela e quais formas aquela saída declarou — portanto é
//   ele, e só ele, que pode exigir
//   `documentos_esperados = documentos_declarados`.
//
// Por isso "esperava crediário e não veio linha `d`" NÃO é vetor
// inválido: seria pedir a uma função pura que provasse algo que ela não
// tem como saber, e o preço seria a pureza — que é justamente o que
// permitiu, na 2A, montar um documento multi-vale quando nenhum romaneio
// selado tinha mais de um.
//
// Isso não perde cobertura, move a regra pra camada que tem a
// informação. As recusas contextuais são provadas no placar da 2B
// (`scripts/conferir-2b-no-sql-editor.sql`), contra dado real, e são
// contadas como conjunto PRÓPRIO — chamá-las de "invalid vectors"
// misturaria duas camadas e, daqui a seis meses, ninguém saberia qual
// delas um número está medindo.
export type MotivoRejeicao =
  | 'sem_vales'
  | 'saida_hash_invalido'
  | 'desfecho_invalido'
  | 'motivo_invalido'
  | 'insucesso_sem_motivo'
  | 'motivo_sem_detalhe'
  | 'entrega_duplicada'
  | 'pagamento_duplicado'
  | 'pagamento_em_insucesso'
  | 'forma_invalida'
  | 'valor_negativo'
  | 'valor_nao_inteiro'
  | 'tipo_documento_invalido'
  | 'situacao_documento_invalida'
  | 'documento_duplicado'

export type VetorInvalido = {
  nome: string
  porque: string
  motivo: MotivoRejeicao
  /** Solto de propósito: estas entradas violam o tipo, que é o ponto. */
  entrada: unknown
}

const VALE_OK = {
  entregaId: E1,
  desfecho: 'entregue',
  motivo: null,
  detalhe: null,
  pagamentosRealizados: [{ pagamentoId: P1, forma: 'pix', valorCents: 100, trocoCents: 0 }],
  documentos: [],
}
const BASE = {
  saidaRomaneioId: SAIDA,
  saidaDocumentHash: SAIDA_HASH,
  motoboyId: MOTOBOY,
  responsavelId: RESPONSAVEL,
}

export const VETORES_INVALIDOS: VetorInvalido[] = [
  {
    nome: 'I001 — retorno sem vale nenhum',
    porque:
      'Um retorno fecha uma saída, e saída sem vale não existe — ' +
      'selar_romaneio_interno já recusa "Romaneio sem vale nenhum". ' +
      'Documento vazio seria assinatura em papel em branco.',
    motivo: 'sem_vales',
    entrada: { ...BASE, vales: [] },
  },
  {
    nome: 'I002 — saida_hash que não é sha256',
    porque:
      'O saida_hash é o que amarra o retorno ao conteúdo da saída. ' +
      'Deformado, o documento afirma fechar algo que nenhuma saída pode ' +
      'ser, e o erro só apareceria na selagem.',
    motivo: 'saida_hash_invalido',
    entrada: { ...BASE, saidaDocumentHash: 'nao-e-um-hash', vales: [VALE_OK] },
  },
  {
    nome: 'I003 — desfecho fora do domínio',
    porque:
      'Só existem entregue e insucesso. Um terceiro valor viraria uma ' +
      'linha v sintaticamente válida que nenhum leitor sabe interpretar.',
    motivo: 'desfecho_invalido',
    entrada: { ...BASE, vales: [{ ...VALE_OK, desfecho: 'parcial' }] },
  },
  {
    nome: 'I004 — motivo fora do domínio',
    porque:
      'O domínio é o CHECK de entregas.insucesso_motivo, e o canônico não ' +
      'pode carregar valor que o banco recusaria depois — dentro da ' +
      'transação do selo, com as assinaturas já colhidas.',
    motivo: 'motivo_invalido',
    entrada: {
      ...BASE,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'sumiu',
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I005 — insucesso sem motivo',
    porque:
      'AQUI ESTÁ A FRONTEIRA ENTRE RECUSAR E NORMALIZAR. No V004 o ' +
      'construtor força "-" porque entregue não tem motivo por definição. ' +
      'Aqui não há valor que ele pudesse inventar: insucesso sem motivo é ' +
      'um documento que não explica o que aconteceu.',
    motivo: 'insucesso_sem_motivo',
    entrada: {
      ...BASE,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I006 — motivo "outro" com detalhe só de espaços',
    porque:
      'Com outro, o detalhe É o motivo — assinar "outro" sozinho é assinar ' +
      'nada. Só espaços conta como vazio, senão a regra se contorna com a ' +
      'barra de espaço. É por isto que o V007 usa ausente para exercitar ' +
      'string vazia: com outro ele codificaria uma entrada inválida.',
    motivo: 'motivo_sem_detalhe',
    entrada: {
      ...BASE,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'outro',
          detalhe: '   ',
          pagamentosRealizados: [],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I007 — o mesmo vale duas vezes',
    porque:
      'Duas linhas v com o mesmo entrega_id fariam o documento afirmar ' +
      'dois desfechos para o mesmo vale. E como entrega_id é a chave de ' +
      'ordenação, a ordem entre as duas dependeria do algoritmo de sort — ' +
      'que não é estável em geral, então os dois gêmeos poderiam ordenar ' +
      'diferente e produzir bytes diferentes para a MESMA entrada.',
    motivo: 'entrega_duplicada',
    entrada: { ...BASE, vales: [VALE_OK, { ...VALE_OK, pagamentosRealizados: [],
    documentos: [], }] },
  },
  {
    nome: 'I008 — o mesmo pagamento_id em vales diferentes',
    porque:
      'O pagamento_id é uuidv7 do cliente (regra 5) e identifica a linha ' +
      'de pagamentos. Repetido, o upsert da fila offline gravaria um só e ' +
      'o dinheiro do outro sumiria — em silêncio, que é como este projeto ' +
      'perde dado.',
    motivo: 'pagamento_duplicado',
    entrada: {
      ...BASE,
      vales: [
        VALE_OK,
        {
          entregaId: E2,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'dinheiro', valorCents: 200, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I009 — pagamento em vale com insucesso',
    porque:
      'Vale que não foi entregue não gera dinheiro. Poderia ser ' +
      'NORMALIZADO — descartar o pagamento — e é justamente o que não se ' +
      'deve fazer: sumir em silêncio com dinheiro que alguém digitou é ' +
      'perda sem aviso. Recusa, para a tela poder perguntar.',
    motivo: 'pagamento_em_insucesso',
    entrada: {
      ...BASE,
      vales: [
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'ausente',
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'pix', valorCents: 100, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I010 — forma de pagamento fora do domínio',
    porque:
      'O domínio é o CHECK de pagamentos.forma. Valor fora dele passaria ' +
      'pelo canônico e morreria no INSERT, dentro da transação do selo — ' +
      'depois de colhidas as duas assinaturas.',
    motivo: 'forma_invalida',
    entrada: {
      ...BASE,
      vales: [
        {
          ...VALE_OK,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'boleto', valorCents: 100, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I011 — valor negativo',
    porque:
      'valor_cents e troco_cents têm CHECK >= 0. Estorno não é pagamento ' +
      'negativo: é outro fato, e não existe neste fluxo.',
    motivo: 'valor_negativo',
    entrada: {
      ...BASE,
      vales: [
        {
          ...VALE_OK,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'pix', valorCents: -100, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I012 — valor com casa decimal',
    porque:
      'REGRA 1, e o canônico é onde ela morde de um jeito novo: ' +
      'String(12.5) produz "12.5", e o documento assinado passa a carregar ' +
      'um separador decimal que o lado SQL, com integer, nunca produziria. ' +
      'Divergência de gêmeos nascida de dinheiro em float.',
    motivo: 'valor_nao_inteiro',
    entrada: {
      ...BASE,
      vales: [
        {
          ...VALE_OK,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'pix', valorCents: 12.5, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
  },
  {
    nome: 'I013 — `vale` não é mais forma de pagamento',
    porque:
      'Existe pelo mesmo motivo dos casos `v2 não é mais lido` do parser ' +
      'do cartão: sem ele, "tirei do domínio" e "esqueci de tirar" ficam ' +
      'indistinguíveis. `vale` era forma no schema inicial e saiu em ' +
      '2026-08-07 ("não é usado, confundia com número do vale da ' +
      'entrega") — mas ficou na lista do DCRR1 até 2026-08-20, aceito ' +
      'pelo canônico pra morrer no INSERT em `pagamentos`, dentro da ' +
      'transação do selo e depois das duas assinaturas.',
    motivo: 'forma_invalida',
    entrada: {
      ...BASE,
      vales: [
        {
          ...VALE_OK,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'vale', valorCents: 100, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
  },

  // ---- o bloco `d`, e o que ele NÃO aceita ---------------------------
  {
    nome: 'I014 — tipo_documento fora do domínio',
    porque:
      'Só convênio, crediário e receita têm custódia no retorno. A NOTA ' +
      'FISCAL é o exemplo mais plausível de engano: ela sai com a entrega, ' +
      'mas fica com o cliente — o documento assinado afirmaria custódia de ' +
      'um papel que não volta, e nada na saída diria que ele era esperado. ' +
      'Até 2026-09-14 o exemplo daqui era `receita`, que entrou no domínio ' +
      'por decisão do usuário (V017, V018).',
    motivo: 'tipo_documento_invalido',
    entrada: {
      ...BASE,
      vales: [{ ...VALE_OK, documentos: [{ tipo: 'nota_fiscal', situacao: 'recebido' }] }],
    },
  },
  {
    nome: 'I015 — CONVCARD tentando entrar como documento físico',
    porque:
      'O caso que o usuário mandou travar explicitamente, e o mais fácil ' +
      'de errar: convcard PARECE convênio e não é. Nele o cliente manda ' +
      'os dados do cartão e a farmácia processa a compra — não há papel ' +
      'saindo com o motoboy, logo não há custódia física. Aceitá-lo aqui ' +
      'faria o documento assinado afirmar que existe um papel que nunca ' +
      'existiu, e a transação exigiria de volta algo que ninguém emitiu. ' +
      'É forma de pagamento VÁLIDA no bloco `pr` e tipo de documento ' +
      'INVÁLIDO no bloco `d`, e essa assimetria é o ponto.',
    motivo: 'tipo_documento_invalido',
    entrada: {
      ...BASE,
      vales: [{ ...VALE_OK, documentos: [{ tipo: 'convcard', situacao: 'recebido' }] }],
    },
  },
  {
    nome: 'I016 — situação fora do domínio',
    porque:
      'O domínio tem DOIS valores de propósito — `recebido` e ' +
      '`faltante` —, que é tudo que caixa e motoboy conseguem afirmar no ' +
      'balcão. `retornado_assinado`, `irregular` e `conferido` dependem ' +
      'da conferência do gestor, que acontece depois e é outro fluxo. ' +
      'Deixá-los entrar faria o documento assinado afirmar o que quem ' +
      'assinou não tinha como saber.',
    motivo: 'situacao_documento_invalida',
    entrada: {
      ...BASE,
      vales: [
        { ...VALE_OK, documentos: [{ tipo: 'crediario', situacao: 'retornado_assinado' }] },
      ],
    },
  },
  {
    nome: 'I017 — o mesmo (entrega_id, tipo_documento) duas vezes',
    porque:
      'A identidade da linha `d` é o PAR, então repeti-lo faria o ' +
      'documento afirmar duas situações para o mesmo papel. E como o par ' +
      'é a chave de ordenação, a ordem entre as duas dependeria do ' +
      'algoritmo de sort — que não é estável em geral, então os dois ' +
      'gêmeos poderiam produzir bytes diferentes para a MESMA entrada. ' +
      'Mesmo raciocínio do I007 e do I008.',
    motivo: 'documento_duplicado',
    entrada: {
      ...BASE,
      vales: [
        {
          ...VALE_OK,
          documentos: [
            { tipo: 'crediario', situacao: 'recebido' },
            { tipo: 'crediario', situacao: 'faltante' },
          ],
        },
      ],
    },
  },
  {
    nome: 'I018 — `outro` não é mais forma de pagamento',
    porque:
      'Mesmo motivo do I013: sem ele, "tirei do domínio" e "esqueci de ' +
      'tirar" ficam indistinguíveis. `outro` saiu das formas em ' +
      '2026-09-10 (decisão de 2026-09-08). Ele CONTINUA sendo motivo de ' +
      'insucesso, que é outro campo com o mesmo nome — o V003 prova esse ' +
      'lado seguir aceito.',
    motivo: 'forma_invalida',
    entrada: {
      ...BASE,
      vales: [
        {
          ...VALE_OK,
          pagamentosRealizados: [
            { pagamentoId: P1, forma: 'outro', valorCents: 100, trocoCents: 0 },
          ],
          documentos: [],
        },
      ],
    },
  },
]
