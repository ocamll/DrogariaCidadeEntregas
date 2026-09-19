// O que é vale REALIZADO e o que é PENDENTE, num lugar só.
//
// Decisão do usuário em 2026-09-18: em rota ainda não tem desfecho e conta
// como pendente. Só entregue e insucesso são realizados — e só eles entram
// no "A pagar à agência" (cada tentativa gera vale cobrável; a que ainda
// não voltou, ainda não).
//
// Relatório, planilha, PDF e Fechamento leem daqui. Com a regra copiada em
// cada tela, o "A pagar" de uma acabaria diferente do da outra.
//
// Cancelado não é nem um nem outro: só existe a partir de pendente e não
// soma dinheiro nenhum.

const REALIZADOS = ['entregue', 'insucesso']
const PENDENTES = ['pendente', 'em_rota']

export function valeFoiRealizado(statusEntrega: string): boolean {
  return REALIZADOS.includes(statusEntrega)
}

export function valeEstaPendente(statusEntrega: string): boolean {
  return PENDENTES.includes(statusEntrega)
}
