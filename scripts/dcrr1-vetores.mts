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
        },
        {
          entregaId: E2,
          desfecho: 'insucesso',
          motivo: 'ausente',
          detalhe: null,
          pagamentosRealizados: [],
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
    entrada: { ...BASE, vales: [VALE_OK, { ...VALE_OK, pagamentosRealizados: [] }] },
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
        },
      ],
    },
  },
]
