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

// O que o servidor respondeu ao `autorizar_saida`, em frase de balcão. É o
// SQL que descobre de quem é o cartão e recusa a combinação errada; a tela
// só traduz. Mora aqui desde o retorno v2 porque as duas telas chamam a
// mesma autorização — e duas cópias das frases divergiriam na primeira
// mudança.
//
// A diferença entre as operações é real, e é só esta: na saída o motoboy
// da exceção é ESCOLHIDO; no retorno ele vem da saída, e não há o que
// escolher.
export function mensagemDaAutorizacao(
  motivo: string,
  { porGerente, operacao }: { porGerente: boolean; operacao: 'saida' | 'retorno' }
): string {
  switch (motivo) {
    case 'pin_incorreto':
      return 'PIN incorreto.'
    case 'bloqueado':
      return 'Credencial bloqueada por tentativas seguidas de PIN incorreto.'
    case 'gerente_invalido':
      return 'Este cartão não é de um gerente ativo. A autorização excepcional é só do gerente da filial.'
    case 'motoboy_invalido':
      return operacao === 'saida'
        ? 'O motoboy escolhido não está ativo. Escolha outro.'
        : 'O motoboy desta corrida está desativado no cadastro. Sem ele ativo, o gerente não consegue autorizar o retorno — fale com o administrador.'
    case 'excecao_exige_motoboy_e_motivo':
      return operacao === 'saida' ? 'Falta escolher o motoboy e o motivo.' : 'Falta escolher o motivo.'
    case 'cartao_de_outro_motoboy':
      return 'Este cartão é de outro motoboy.'
    case 'motivo_sem_excecao':
      return 'Com o cartão do próprio motoboy não há exceção a registrar.'
    default:
      return porGerente ? 'Não consegui autenticar o gerente.' : 'Não consegui autenticar o motoboy.'
  }
}
