// O RELATO DO RETORNO — "o que aconteceu?", fora dos bytes assinados.
//
// Decidido em 2026-09-14/15 (NOTAS 111, versão 2): quando um item do
// retorno DIVERGE — pagamento diferente do previsto, ou documento
// declarado faltante —, quem confirma escreve o que aconteceu ou marca
// "precisa apurar".
//
// FICA FORA do DCRR1 de propósito: é declaração do balcão sobre uma
// diferença, não fato que o motoboy confirma com cartão e PIN. Por isso
// este arquivo não importa nada de `canonicoRetorno.ts`, e
// `canonicoRetorno.ts` não importa nada daqui — são dois contratos
// deliberadamente separados. Viaja no selo por um parâmetro PRÓPRIO
// (`p_relatos`), nunca dentro de `p_retorno`.
//
// Mora em `lib/` e não importa nada do Supabase — é o que permite montar
// o jsonb isolado, sem depender de tela nem de rede.

export type NaturezaRelato = 'pagamento' | 'documento'
export type SituacaoRelato = 'relatado' | 'precisa_apurar'

export type RelatoRetorno = {
  entregaId: string
  natureza: NaturezaRelato
  /** Só quando natureza = 'documento'; null em 'pagamento'. */
  tipoDocumento: string | null
  situacao: SituacaoRelato
  /** Obrigatório quando situacao = 'relatado'; null em 'precisa_apurar'. */
  relato: string | null
}

/**
 * O `p_relatos` que vai pro servidor — cada linha ganha um id NOVO aqui,
 * a cada chamada, o mesmo desenho do `pagamentoId` do realizado: nunca
 * reaproveitado, sempre cunhado no instante em que o pacote nasce.
 *
 * Não valida nada — quem valida é o selo, contra o que o PRÓPRIO retorno
 * apurou (pagamento divergente, documento faltante). Este arquivo só sabe
 * montar o formato; não sabe o que a saída esperava nem o que este
 * retorno declarou.
 */
export function paraJsonbRelatos(
  relatos: ReadonlyArray<RelatoRetorno>,
  novoId: () => string
): unknown[] {
  return relatos.map((r) => ({
    id: novoId(),
    entrega_id: r.entregaId,
    natureza: r.natureza,
    tipo_documento: r.tipoDocumento,
    situacao: r.situacao,
    relato: r.relato,
  }))
}
