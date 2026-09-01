// POR QUE O LOGIN FALHOU — e o defeito que o E2 não alcançou.
//
// Este arquivo não importa nada. Mesma disciplina de `username.ts`,
// `estadoDeConsulta.ts` e `papeis.ts`: regra que decide o que a tela
// AFIRMA tem que ser exercitável sem navegador e sem rede.
//
// ---------------------------------------------------------------------
// O DEFEITO
// ---------------------------------------------------------------------
// Até o E5, `Login.tsx` fazia isto:
//
//     {mutation.isError && <p>E-mail ou senha inválidos.</p>}
//
// QUALQUER erro virava "credencial inválida" — inclusive não ter rede.
// Offline, o app afirmava que a senha estava errada sem ter tido como
// perguntar a ninguém.
//
// É exatamente o defeito que o E2 caçou em nove telas, na décima que ele
// não cobriu: o E2 tratou CONSULTAS, e login é uma escrita. O vocabulário
// dele serve inteiro aqui —
//
//     recusado      o servidor respondeu, e disse não
//     indisponivel  não houve a quem perguntar
//     erro          a tentativa falhou por outro motivo
//
// — e a distinção entre os dois primeiros é a que importa: dizer "senha
// errada" para quem está sem internet manda a pessoa trocar uma senha
// que está certa.

/** O que dá pra saber de uma tentativa de login que não deu certo. */
export type SintomaDeLogin = {
  /** `navigator.onLine` NO INSTANTE DA AÇÃO, não no do último render. */
  online: boolean
  /** `status` do erro do supabase-js, quando houver. Falha de rede dá 0. */
  status?: number | null
  /** `name` do erro — `AuthRetryableFetchError` e `TypeError` são de rede. */
  nome?: string | null
}

export type FalhaDeLogin = 'recusado' | 'indisponivel' | 'erro'

/**
 * `AuthRetryableFetchError` é o que o supabase-js levanta quando o fetch
 * não completou; `TypeError` é o que o próprio `fetch` levanta quando o
 * navegador não conseguiu sair. Nenhum dos dois é resposta do servidor.
 */
const NOMES_DE_REDE = ['AuthRetryableFetchError', 'TypeError', 'FetchError']

/**
 * Classifica a falha.
 *
 * **A ordem importa, e o `online: false` vem primeiro de propósito.**
 * Sem rede não existe resposta autoritativa, e nesse caso nem vale olhar
 * o resto: um status residual de uma tentativa anterior não pode virar
 * "senha errada".
 *
 * `status === 0` é o carimbo de "não saiu da máquina" — o supabase-js o
 * usa quando não houve resposta HTTP nenhuma. Um 400/401 de verdade é o
 * servidor dizendo não, e aí `recusado` é a afirmação certa.
 *
 * O default é `recusado` porque o caso esmagadoramente comum é senha
 * errada, e porque é a única mensagem acionável para quem está no
 * balcão. `erro` fica para o que tem cara de defeito do servidor (5xx),
 * onde mandar a pessoa redigitar a senha seria perda de tempo.
 */
export function classificarFalhaDeLogin(sintoma: SintomaDeLogin): FalhaDeLogin {
  if (!sintoma.online) return 'indisponivel'
  if (sintoma.nome && NOMES_DE_REDE.includes(sintoma.nome)) return 'indisponivel'
  if (sintoma.status === 0) return 'indisponivel'
  if (typeof sintoma.status === 'number' && sintoma.status >= 500) return 'erro'
  return 'recusado'
}

/**
 * O que a tela escreve. Um lugar só — as três frases já divergiram uma
 * vez neste projeto quando moravam espalhadas (o rótulo do signatário,
 * que o `papeis.ts` veio resolver).
 *
 * Repare no que `indisponivel` **não** diz: nada sobre a senha. A tela
 * não sabe se ela está certa, e não deve chutar.
 */
export const TEXTO_DA_FALHA: Record<FalhaDeLogin, string> = {
  recusado: 'Usuário ou senha inválidos.',
  indisponivel: 'Sem conexão — não deu pra verificar o usuário. Tente de novo quando a internet voltar.',
  erro: 'O servidor não respondeu direito. Tente de novo em instantes.',
}

/**
 * O erro que a tela recebe, já classificado.
 *
 * Mora AQUI, e não em `data/auth.tsx`, por dois motivos que apontam pro
 * mesmo lugar: ele é puro (não precisa do cliente Supabase, logo pode
 * ser exercitado sob `tsx`), e pô-lo num arquivo que exporta componente
 * React acende o `only-export-components` do oxlint — foi assim que o
 * defeito se anunciou.
 */
export class FalhaDeLoginError extends Error {
  // Campo declarado à mão, e não `constructor(readonly falha)`: o
  // tsconfig deste projeto usa `erasableSyntaxOnly`, que recusa
  // parameter property porque ela EMITE código — e o alvo aqui é
  // TypeScript apagável, não transpilado.
  readonly falha: FalhaDeLogin

  constructor(falha: FalhaDeLogin) {
    super(TEXTO_DA_FALHA[falha])
    this.falha = falha
    this.name = 'FalhaDeLoginError'
  }
}
