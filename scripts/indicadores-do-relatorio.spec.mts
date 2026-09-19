// npx tsx scripts/indicadores-do-relatorio.spec.mts
//
// Os nove números do topo do relatório. Tela, planilha e PDF leem esta
// mesma lista; aqui se prova a ordem, o formato e quando cada um destaca.

import { indicadoresDoRelatorio } from '../src/lib/indicadoresDoRelatorio.ts'
import type { Relatorio } from '../src/data/relatorios.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const base: Relatorio = {
  totalVales: 12,
  totalClientes: 10,
  totalTransferencias: 2,
  totalCancelados: 1,
  totalPendentes: 3,
  totalRealizados: 8,
  valorCompraCents: 123456,
  valorEntregaCents: 9900,
  valorFarmaciaDeveCents: 7200,
  porStatus: {},
  porStatusFinanceiro: {},
  porAgencia: [],
}

const lista = indicadoresDoRelatorio(base)
checa('nove indicadores', lista.length === 9, String(lista.length))
checa(
  'na ordem pedida',
  JSON.stringify(lista.map((i) => i.rotulo)) ===
    JSON.stringify([
      'Vales no período',
      'Vales de entrega',
      'Vales de transferência',
      'Vales realizados',
      'Vales pendentes',
      'Vales cancelados',
      'Valor em compras',
      'Valor de entrega',
      'A pagar à agência',
    ])
)
checa(
  'realizados, pendentes e cancelados lado a lado',
  lista[3].rotulo === 'Vales realizados' && lista[4].rotulo === 'Vales pendentes' && lista[5].rotulo === 'Vales cancelados'
)
checa('as seis contagens vêm antes dos três valores', lista.slice(0, 6).every((i) => !i.dinheiro) && lista.slice(6).every((i) => i.dinheiro))
checa('dinheiro só nos três valores', lista.filter((i) => i.dinheiro).map((i) => i.rotulo).join('|') === 'Valor em compras|Valor de entrega|A pagar à agência')
checa('dinheiro em centavos inteiros', lista.filter((i) => i.dinheiro).every((i) => Number.isInteger(i.valor)))
checa('realizado com valor: verde', lista[3].tom === 'sucesso')
checa('pendente com valor: amarelo', lista[4].tom === 'aviso')
checa('cancelado com valor: vermelho', lista[5].tom === 'alerta')
checa('os outros sem destaque', lista.filter((_, i) => i < 3 || i > 5).every((i) => i.tom === 'normal'))
const zerado = indicadoresDoRelatorio({ ...base, totalRealizados: 0, totalPendentes: 0, totalCancelados: 0 })
checa('zero realizado não destaca', zerado[3].tom === 'normal')
checa('zero pendente não destaca', zerado[4].tom === 'normal')
checa('zero cancelado não destaca', zerado[5].tom === 'normal')
checa('realizados vem do relatório', lista[3].valor === 8)

console.log(falhas === 0 ? '\nindicadores do relatório ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
