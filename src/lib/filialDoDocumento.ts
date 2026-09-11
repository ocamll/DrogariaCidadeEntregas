/**
 * O nome da filial que um ROMANEIO mostra — passo 3, 2026-09-11.
 *
 * Até aqui ele vinha do join vivo `lojas(nome)`: renomear uma filial
 * mudava o cabeçalho de todo PDF histórico e mandava o reenvio ao Drive
 * para outra pasta. É a regra 7 de novo, noutra coluna — o documento tem
 * que dizer o que era verdade quando foi selado, não o que é hoje.
 *
 * Desde a migration 20260911130000 o nome é congelado em
 * `payload.loja_nome` no instante do selo, na saída e no retorno. Ele NÃO
 * entra no canônico: o `document_hash` continua cobrindo só o `loja_id`.
 *
 * Mora em `lib/` e não importa nada, pela mesma razão de `canonico.ts`:
 * a regra cabe num teste sem rede (`scripts/filial-do-documento.spec.mts`).
 *
 * ---------------------------------------------------------------------
 * AS TRÊS SITUAÇÕES, e por que são três e não duas
 *
 *   chave presente, com nome   → o nome do snapshot
 *   chave presente, nula/vazia → null. O snapshot EXISTE e diz que não
 *                                havia nome; cair no nome de hoje seria
 *                                afirmar o que o documento não afirma
 *   chave AUSENTE              → o nome atual. Só documento selado antes
 *                                da migration — todos dados de teste, que
 *                                o corte pré-V1 apaga. É leitor de formato
 *                                histórico, e sai depois do corte
 */
export function nomeDaFilialDoDocumento(payload: unknown, nomeAtual: string | null): string | null {
  if (!payload || typeof payload !== 'object' || !('loja_nome' in payload)) {
    return nomeAtual
  }
  const doSnapshot = (payload as { loja_nome: unknown }).loja_nome
  return typeof doSnapshot === 'string' && doSnapshot.trim() !== '' ? doSnapshot : null
}
