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

export type PagamentoRealizadoCanonico = {
  pagamentoId: string
  forma: 'dinheiro' | 'credito' | 'debito' | 'pix' | 'convenio' | 'vale' | 'outro'
  valorCents: number
  trocoCents: number
}

export type ValeRetornoCanonico = {
  entregaId: string
  desfecho: 'entregue' | 'insucesso'
  motivo: 'ausente' | 'endereco_errado' | 'recusou' | 'outro' | null
  detalhe: string | null
  pagamentosRealizados: PagamentoRealizadoCanonico[]
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
  /** Derivado do texto acima por biblioteca padrão. */
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
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tpix\t12345\t0`,
    ].join('\n'),
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
        },
      ],
    },
    canonico: [...CABECALHO, `v\t${E1}\tinsucesso\tausente\t-`].join('\n'),
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
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tinsucesso\toutro\tEndereço da Conceição não existe — José confirmou 🛵`,
    ].join('\n'),
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
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tdinheiro\t5000\t0`,
    ].join('\n'),
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
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      // \r\n vira DOIS espaços (cada um é substituído), \t vira um, \n vira um
      `v\t${E1}\tinsucesso\toutro\tCliente disse:  "volto amanhã" não insisti`,
    ].join('\n'),
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
        },
        {
          entregaId: E1,
          desfecho: 'insucesso',
          motivo: 'recusou',
          detalhe: null,
          pagamentosRealizados: [],
        },
        {
          entregaId: E2,
          desfecho: 'entregue',
          motivo: null,
          detalhe: null,
          pagamentosRealizados: [
            { pagamentoId: P3, forma: 'pix', valorCents: 100, trocoCents: 0 },
          ],
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
    sha256: '2b53ae38d3aa9f0ab436b4a34845fe509febef03ac9fee447f1c5a9a29ac94fe',
  },

  {
    nome: 'V007 — string vazia NÃO é nulo',
    porque:
      '`coalesce(texto, \'-\')` só troca NULO. String vazia continua vazia, ' +
      'e no canônico isso aparece como dois TABs seguidos. Os dois lados ' +
      'precisam concordar nisso, senão um manda `-` e o outro manda nada.',
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
          detalhe: '',
          pagamentosRealizados: [],
        },
        {
          entregaId: E2,
          desfecho: 'insucesso',
          motivo: 'outro',
          detalhe: null,
          pagamentosRealizados: [],
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      // detalhe vazio: a linha termina em TAB, sem nada depois
      `v\t${E1}\tinsucesso\toutro\t`,
      // detalhe nulo: vira '-'
      `v\t${E2}\tinsucesso\toutro\t-`,
    ].join('\n'),
    sha256: '78368b69ba0526e0950ba27f9fd268a6f6404d202cef1b5b52a9f442532086aa',
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
        },
      ],
    },
    canonico: [
      ...CABECALHO,
      `v\t${E1}\tentregue\t-\t-`,
      `pr\t${E1}\t${P1}\tpix\t5000\t0`,
      `pr\t${E1}\t${P2}\tdinheiro\t7000\t1500`,
    ].join('\n'),
    sha256: 'b6621d141b61a874e34aa47e7ca347661d1211982552bb71e2f53ea6edd28727',
  },
]
