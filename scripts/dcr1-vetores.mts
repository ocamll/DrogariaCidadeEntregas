// GOLDEN VECTORS DO DCR1 — o canônico do Romaneio de Saída.
//
// Nasceram em 2026-09-14, com a linha `r` (a receita que tem que voltar).
// Até aqui a saída tinha duas referências: `canonico.spec.mts`, que testa
// propriedades, e `conferir-canonico-no-console.js`, que compara TS com SQL
// em dado real. Na primeira mudança de bytes do DCR1 desde que ele existe,
// ganha a terceira — texto escrito à mão a partir da especificação, que as
// implementações têm que reproduzir, e não o contrário.
//
// O QUE ELES TRAVAM
//
//   S001  a saída SEM receita. O texto é o que a implementação ANTERIOR à
//         linha `r` produz, conferido contra `git show 19402cd:src/lib/canonico.ts`
//         pelo spec. É a prova de que nenhuma saída sem receita muda um byte.
//   S002  o MESMO vale com receita: a única diferença é a linha `r` no fim.
//   S003  três vales fora de ordem, dois com receita: o bloco `r` vem depois
//         de TODOS os `p`, só para quem tem receita, ordenado por entrega_id.
//
// O LADO SQL (`romaneio_canonico`) lê de `entregas` e `pagamentos`, então
// não roda contra estes vetores sem fixture no banco. A conferência dele é
// a de sempre, em dado real: `conferir-canonico-no-console.js`, byte a byte
// contra o TypeScript, com um vale marcado "Precisa de receita".
//
// O FORMATO (migration 20260816140000, mais a linha `r` de 20260914120000):
//
//   DCR1
//   tenant   <uuid>
//   loja     <uuid>
//   agencia  <uuid|->
//   motoboy  <uuid>
//   caixa    <uuid>
//   vales    <n>
//   v  <entrega_id> <numero_vale> <tipo> <cliente_nome> <cliente_endereco>
//      <qtd_vales> <valor_compra_cents> <valor_entrega_cents>
//      <entrega_paga_cliente_cents> <loja_origem_id|-> <convenio_id|->
//   p  <entrega_id> <pagamento_id> <forma> <valor_cents> <troco_cents>
//   r  <entrega_id>
//
// Só a PRESENÇA da receita entra — nada de medicamento, receituário ou
// tipo de receita (regra 9).
//
// Tipos escritos AQUI, e não importados de `canonico.ts`: o vetor é a
// especificação, e importar da implementação faria a checagem concordar
// consigo mesma. Mesma razão do `dcrr1-vetores.mts`.

export type PagamentoPrevistoDaSaida = {
  pagamentoId: string
  forma: string
  valorCents: number
  trocoCents: number
}

export type ValeDaSaida = {
  entregaId: string
  numeroVale: string
  tipo: 'cliente' | 'transferencia'
  clienteNome: string
  clienteEndereco: string
  quantidadeVales: number
  valorCompraCents: number
  valorEntregaCents: number
  entregaPagaClienteCents: number
  lojaOrigemId: string | null
  convenioId: string | null
  temReceita: boolean
  pagamentosPrevistos: PagamentoPrevistoDaSaida[]
}

export type EntradaDaSaida = {
  tenantId: string
  lojaId: string
  agenciaId: string | null
  motoboyId: string
  caixaId: string
  vales: ValeDaSaida[]
}

export type VetorDaSaida = {
  nome: string
  /** O que este vetor existe pra travar. Se cair, é isto que quebrou. */
  porque: string
  entrada: EntradaDaSaida
  /** Escrito à mão a partir da especificação. É ISTO que está sob revisão. */
  canonico: string
  /** Bytes UTF-8 do texto — o "José da Conceição" do S003 separa isto do `length`. */
  bytes: number
  /** SHA-256 dos bytes UTF-8 do texto acima, por biblioteca padrão. */
  sha256: string
}

// UUIDs legíveis: o sufixo diz o que é, e a ordem entre eles é óbvia.
const TENANT = '019fe83f-1d58-70e9-8dd8-000000000010'
const LOJA = '019fe83f-1d58-70e9-8dd8-000000000020'
const AGENCIA = '019fe83f-1d58-70e9-8dd8-000000000030'
const MOTOBOY = '019fe83f-1d58-70e9-8dd8-000000000040'
const CAIXA = '019fe83f-1d58-70e9-8dd8-000000000050'
const E1 = '019fe83f-1d58-70e9-8dd8-0000000000e1'
const E2 = '019fe83f-1d58-70e9-8dd8-0000000000e2'
const E3 = '019fe83f-1d58-70e9-8dd8-0000000000e3'
const P1 = '019fe83f-1d58-70e9-8dd8-0000000000f1'
const P2 = '019fe83f-1d58-70e9-8dd8-0000000000f2'
const P3 = '019fe83f-1d58-70e9-8dd8-0000000000f3'

const cabecalho = (vales: number) => [
  'DCR1',
  `tenant\t${TENANT}`,
  `loja\t${LOJA}`,
  `agencia\t${AGENCIA}`,
  `motoboy\t${MOTOBOY}`,
  `caixa\t${CAIXA}`,
  `vales\t${vales}`,
]

const BASE = { tenantId: TENANT, lojaId: LOJA, agenciaId: AGENCIA, motoboyId: MOTOBOY, caixaId: CAIXA }

const VALE_E1: ValeDaSaida = {
  entregaId: E1,
  numeroVale: 'V-000080',
  tipo: 'cliente',
  clienteNome: 'Maria Souza',
  clienteEndereco: 'Rua XV de Novembro, 100',
  quantidadeVales: 1,
  valorCompraCents: 12345,
  valorEntregaCents: 900,
  entregaPagaClienteCents: 0,
  lojaOrigemId: null,
  convenioId: null,
  temReceita: false,
  pagamentosPrevistos: [{ pagamentoId: P1, forma: 'pix', valorCents: 12345, trocoCents: 0 }],
}

const LINHA_V_E1 = `v\t${E1}\tV-000080\tcliente\tMaria Souza\tRua XV de Novembro, 100\t1\t12345\t900\t0\t-\t-`
const LINHA_P_E1 = `p\t${E1}\t${P1}\tpix\t12345\t0`

export const VETORES_DA_SAIDA: VetorDaSaida[] = [
  {
    nome: 'S001 — saída SEM receita: os bytes de antes da linha `r`',
    porque:
      'A prova de que a mudança de 2026-09-14 não move nenhuma saída sem ' +
      'receita. O spec gera este mesmo vale com a implementação ANTERIOR ' +
      '(19402cd) e exige o mesmo texto: bloco vazio é ausência de linha.',
    entrada: { ...BASE, vales: [VALE_E1] },
    canonico: [...cabecalho(1), LINHA_V_E1, LINHA_P_E1].join('\n'),
    bytes: 429,
    sha256: 'c40e3caa6a559c6bc896b7f044faa54b4874092e0eb8231db370886fb41835a9',
  },

  {
    nome: 'S002 — o mesmo vale COM receita: só a linha `r` a mais',
    porque:
      'A receita entra como linha própria, DEPOIS dos pagamentos, e não como ' +
      'um 13º campo na linha `v`. Campo novo na `v` mudaria os bytes de TODA ' +
      'saída; linha própria só muda as que têm receita.',
    entrada: { ...BASE, vales: [{ ...VALE_E1, temReceita: true }] },
    canonico: [...cabecalho(1), LINHA_V_E1, LINHA_P_E1, `r\t${E1}`].join('\n'),
    bytes: 468,
    sha256: '77f93626631570888ef47badd177250e3bc9e7e8e698fae5eb40360b385ae536',
  },

  {
    nome: 'S003 — três vales fora de ordem, dois com receita',
    porque:
      'O irmão do V006/V016 do DCRR1 para o bloco novo. A entrada traz E3, E1, ' +
      'E2; a saída ordena vales, depois pagamentos, depois receitas, cada ' +
      'bloco por entrega_id, e o `r` aparece SÓ para E2 e E3. Sem ele, um ' +
      'gêmeo que emitisse `r` intercalado com o `p` do mesmo vale concordaria ' +
      'com o outro em toda saída de um vale só.',
    entrada: {
      ...BASE,
      vales: [
        {
          entregaId: E3,
          numeroVale: 'V-000082',
          tipo: 'cliente',
          clienteNome: 'Ana Lúcia',
          clienteEndereco: 'Rua Coronel Sezefredo, 42',
          quantidadeVales: 1,
          valorCompraCents: 7890,
          valorEntregaCents: 900,
          entregaPagaClienteCents: 0,
          lojaOrigemId: null,
          convenioId: null,
          temReceita: true,
          pagamentosPrevistos: [{ pagamentoId: P3, forma: 'credito', valorCents: 7890, trocoCents: 0 }],
        },
        VALE_E1,
        {
          entregaId: E2,
          numeroVale: 'V-000081',
          tipo: 'cliente',
          clienteNome: 'José da Conceição',
          clienteEndereco: 'Av. Brasil, 1000',
          quantidadeVales: 1,
          valorCompraCents: 5000,
          valorEntregaCents: 900,
          entregaPagaClienteCents: 0,
          lojaOrigemId: null,
          convenioId: null,
          temReceita: true,
          pagamentosPrevistos: [{ pagamentoId: P2, forma: 'dinheiro', valorCents: 5000, trocoCents: 0 }],
        },
      ],
    },
    canonico: [
      ...cabecalho(3),
      LINHA_V_E1,
      `v\t${E2}\tV-000081\tcliente\tJosé da Conceição\tAv. Brasil, 1000\t1\t5000\t900\t0\t-\t-`,
      `v\t${E3}\tV-000082\tcliente\tAna Lúcia\tRua Coronel Sezefredo, 42\t1\t7890\t900\t0\t-\t-`,
      LINHA_P_E1,
      `p\t${E2}\t${P2}\tdinheiro\t5000\t0`,
      `p\t${E3}\t${P3}\tcredito\t7890\t0`,
      `r\t${E2}`,
      `r\t${E3}`,
    ].join('\n'),
    bytes: 911,
    sha256: 'a22db31c7df0cc5210d9a9e65a35d57d6964e21e230a2f3740a62180eee837e7',
  },
]
