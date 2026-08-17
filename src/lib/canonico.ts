// Forma canônica do Romaneio de Saída — os bytes que viram o
// `document_hash`.
//
// ATENÇÃO: este arquivo é a implementação GÊMEA de
// `public.romaneio_canonico` (migration 20260816140000). As duas precisam
// produzir os MESMOS BYTES, sempre. Se divergirem, o sintoma não é um
// erro claro — é "a saída offline nunca sincroniza", meses depois, porque
// o servidor recalcula o hash a partir do banco e ele não bate.
//
// Mora em `lib/` e não em `data/` de propósito: é função pura, sem
// nenhuma dependência (nem do cliente Supabase). É isso que permite
// testá-la isolada, que é a única defesa real contra a divergência.
//
// O formato é chato de propósito: linha, TAB, ordem fixa, sem escape e
// sem objeto. JSON canônico seria onde a fragilidade mora — ordem de
// chave, escape de Unicode, notação de número. Chato é o que dá pra
// reproduzir em duas linguagens.

const TAB = '\t'

// Espelha `texto_para_canonico`: translate(texto, E'\t\n\r', '   ') com
// coalesce pra '-'. Não faz mais nada — nada de trim, nada de normalizar
// Unicode. Normalização é justamente o tipo de "melhoria" que faria os
// dois lados divergirem em silêncio.
function textoCanonico(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return '-'
  return valor.replace(/[\t\n\r]/g, ' ')
}

// `uuid::text` do Postgres sai sempre em minúscula.
function idCanonico(valor: string | null | undefined): string {
  return valor ? valor.toLowerCase() : '-'
}

// Ordenação por code unit, igual ao `collate "C"` do lado SQL.
// NUNCA trocar por localeCompare: ele depende do locale do navegador, que
// é exatamente a variável que o collate "C" foi posto lá pra eliminar.
function ordemBinaria(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export type PagamentoPrevistoCanonico = {
  pagamentoId: string
  forma: string
  valorCents: number
  trocoCents: number
}

export type ValeCanonico = {
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
  pagamentosPrevistos: PagamentoPrevistoCanonico[]
}

export type EntradaCanonica = {
  tenantId: string
  lojaId: string
  agenciaId: string | null
  motoboyId: string
  caixaId: string
  vales: ValeCanonico[]
}

export function montarCanonico(entrada: EntradaCanonica): string {
  const linhas: string[] = [
    'DCR1',
    `tenant${TAB}${idCanonico(entrada.tenantId)}`,
    `loja${TAB}${idCanonico(entrada.lojaId)}`,
    `agencia${TAB}${idCanonico(entrada.agenciaId)}`,
    `motoboy${TAB}${idCanonico(entrada.motoboyId)}`,
    `caixa${TAB}${idCanonico(entrada.caixaId)}`,
    `vales${TAB}${entrada.vales.length}`,
  ]

  const vales = [...entrada.vales].sort((a, b) =>
    ordemBinaria(idCanonico(a.entregaId), idCanonico(b.entregaId))
  )

  for (const vale of vales) {
    linhas.push(
      [
        'v',
        idCanonico(vale.entregaId),
        textoCanonico(vale.numeroVale),
        vale.tipo,
        textoCanonico(vale.clienteNome),
        textoCanonico(vale.clienteEndereco),
        String(vale.quantidadeVales),
        String(vale.valorCompraCents),
        String(vale.valorEntregaCents),
        String(vale.entregaPagaClienteCents),
        idCanonico(vale.lojaOrigemId),
        idCanonico(vale.convenioId),
      ].join(TAB)
    )
  }

  // Todos os pagamentos DEPOIS de todos os vales, em bloco próprio — o
  // lado SQL faz dois laços separados, então intercalar aqui já mudaria
  // os bytes.
  const pagamentos = vales.flatMap((vale) =>
    vale.pagamentosPrevistos.map((pagamento) => ({ entregaId: vale.entregaId, ...pagamento }))
  )
  pagamentos.sort(
    (a, b) =>
      ordemBinaria(idCanonico(a.entregaId), idCanonico(b.entregaId)) ||
      ordemBinaria(idCanonico(a.pagamentoId), idCanonico(b.pagamentoId))
  )

  for (const pagamento of pagamentos) {
    linhas.push(
      [
        'p',
        idCanonico(pagamento.entregaId),
        idCanonico(pagamento.pagamentoId),
        pagamento.forma,
        String(pagamento.valorCents),
        String(pagamento.trocoCents),
      ].join(TAB)
    )
  }

  // Sem \n no fim — o array_to_string do lado SQL também não põe.
  return linhas.join('\n')
}
