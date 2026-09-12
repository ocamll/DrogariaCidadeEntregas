// O vocabulário da autorização excepcional — 4B, 2026-09-11.
//
// Não importa nada, de propósito: estes literais atravessam a tela, a
// fila offline, o envelope selado, a Edge Function e dois CHECKs do banco
// (`assinaturas_motivo_excecao_check` e o de `motoboy_autorizacoes`). Um
// lugar só no cliente, testável sem rede.
//
// QUEM VALIDOU A SAÍDA
//
//   motoboy   o próprio motoboy apresentou o cartão e digitou o PIN
//   gerente   o gerente da filial apresentou o cartão DELE e digitou o PIN
//             DELE, porque o motoboy não tinha o que apresentar
//
// No segundo caso o motoboy continua sendo o responsável pelo vale — ele
// é identificado pelo nome, não autenticado. Quem autentica é o gerente.
export type ValidacaoDaSaida = 'motoboy' | 'gerente'

// DOIS motivos, e não três. Decidido pelo usuário em 2026-09-11, pelo
// processo que cada um dispara no admin:
//
//   cartao_perdido   credencial NOVA do zero (o PIN daquele cartão nem
//                    existe ainda)
//   pin_esquecido    só redefinir o PIN; o cartão continua o mesmo
//
// "Os dois ao mesmo tempo" desemboca no primeiro, e por isso não existe.
// Um terceiro valor aqui seria recusado pelo CHECK do banco.
export type MotivoExcecao = 'cartao_perdido' | 'pin_esquecido'

export const MOTIVOS_EXCECAO: readonly MotivoExcecao[] = ['cartao_perdido', 'pin_esquecido']

export const MOTIVO_EXCECAO_LABEL: Record<MotivoExcecao, string> = {
  cartao_perdido: 'Cartão perdido',
  pin_esquecido: 'PIN esquecido',
}

export function ehMotivoExcecao(valor: unknown): valor is MotivoExcecao {
  return valor === 'cartao_perdido' || valor === 'pin_esquecido'
}
