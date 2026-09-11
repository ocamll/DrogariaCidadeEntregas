// Quem entra no cache local de credenciais — e a resposta muda com o
// titular.
//
// Este arquivo não importa nada, de propósito: é regra, e regra que
// decide o que fica guardado no navegador de um terminal do balcão tem
// que caber num teste sem banco e sem rede
// (`npx tsx scripts/credencialNoCache.spec.mts`).
//
// O CARTÃO DO MOTOBOY entra sempre. Ele já entrava, e a razão não mudou:
// sem rede, bipar só identifica alguém se o `public_id` estiver aqui.
//
// O CARTÃO DO GERENTE entra só se for da PRÓPRIA FILIAL, e isso tem dois
// motivos que se somam:
//
//   1. não ampliar exposição. O cache é uma lista de nomes que fica
//      gravada no navegador de um PC compartilhado. O do balcão precisa
//      saber quem pode autorizar ALI, não quem gerencia as outras 17
//      filiais.
//   2. não oferecer o impossível. A autorização do gerente é conferida,
//      no selo, contra a filial do documento (4B.2). Um gerente de outra
//      filial seria identificado no balcão, digitaria o PIN, e a operação
//      seria recusada depois — com o motoboy esperando. É a mesma regra
//      que já vale pra lista de vales da saída.
//
// Gerente sem filial e usuário sem filial não casam com ninguém: o admin
// não opera balcão, e é dele que `lojaIdDoUsuario` vem nulo.
export type TitularDaCredencial = 'motoboy' | 'gerente'

export type CredencialParaCache = {
  titular: TitularDaCredencial
  // A filial do TITULAR do cartão. Nula para motoboy (ele é de uma
  // agência, não de uma filial) e para um gerente sem filial, que o
  // banco não deveria produzir mas não custa tratar.
  lojaIdDoTitular: string | null
}

export function credencialEntraNoCache(
  credencial: CredencialParaCache,
  lojaIdDoUsuario: string | null
): boolean {
  if (credencial.titular === 'motoboy') return true
  if (credencial.lojaIdDoTitular === null || lojaIdDoUsuario === null) return false
  return credencial.lojaIdDoTitular === lojaIdDoUsuario
}
