// Os números do topo do relatório — UMA lista, lida pela tela, pela
// planilha e pelo PDF. Com três cópias da mesma lista, a ordem, o rótulo ou
// a regra de destaque acabariam divergindo entre o que se vê e o que se
// exporta.
//
// Só `import type`: é o que deixa o spec rodar sem Supabase.
import type { Relatorio } from '@/data/relatorios'

export type TomDoIndicador = 'normal' | 'sucesso' | 'aviso' | 'alerta'

export type Indicador = {
  rotulo: string
  /** Contagem, ou centavos inteiros quando `dinheiro` (regra 1). */
  valor: number
  dinheiro: boolean
  tom: TomDoIndicador
}

export function indicadoresDoRelatorio(relatorio: Relatorio): Indicador[] {
  const contagem = (rotulo: string, valor: number, tom: TomDoIndicador = 'normal'): Indicador => ({
    rotulo,
    valor,
    dinheiro: false,
    tom,
  })
  const dinheiro = (rotulo: string, valor: number): Indicador => ({
    rotulo,
    valor,
    dinheiro: true,
    tom: 'normal',
  })
  return [
    contagem('Vales no período', relatorio.totalVales),
    contagem('Vales de entrega', relatorio.totalClientes),
    contagem('Vales de transferência', relatorio.totalTransferencias),
    // Realizados, pendentes e cancelados lado a lado: juntos eles fecham o
    // total do período. Cor só quando o número é maior que zero.
    contagem('Vales realizados', relatorio.totalRealizados, relatorio.totalRealizados > 0 ? 'sucesso' : 'normal'),
    contagem('Vales pendentes', relatorio.totalPendentes, relatorio.totalPendentes > 0 ? 'aviso' : 'normal'),
    contagem('Vales cancelados', relatorio.totalCancelados, relatorio.totalCancelados > 0 ? 'alerta' : 'normal'),
    dinheiro('Valor em compras', relatorio.valorCompraCents),
    dinheiro('Valor de entrega', relatorio.valorEntregaCents),
    dinheiro('A pagar à agência', relatorio.valorFarmaciaDeveCents),
  ]
}
