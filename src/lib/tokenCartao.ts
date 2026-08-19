// Leitura do token do cartão do motoboy.
//
// Mora em lib/ e NÃO IMPORTA NADA — nem o cliente Supabase, nem a Dexie.
// É o que permite testá-lo isolado (`npx tsx scripts/cartao-pdf.spec.mts`),
// e a razão é a mesma do `montarCanonico`: esta função é GÊMEA de uma
// função SQL (`public.public_id_do_token`), e gêmea que só dá pra exercitar
// dentro do app é gêmea que ninguém confere.
//
// Divergência aqui não dá erro claro. Dá "o cartão novo não é reconhecido
// offline" — meses depois, sem pista.

// O token vem do leitor como se tivesse sido digitado. Só o public_id é
// usado aqui — o segredo não serve pra nada localmente e não é guardado.
//
// Espelha `public.public_id_do_token` (migration 20260818120000). Os dois
// são os únicos pontos do sistema que sabem o formato do token, e **mudam
// sempre juntos**: divergirem não dá erro claro, dá "o cartão não é
// reconhecido quando falta internet" — e offline é justamente onde só
// este lado responde.
//
// SÓ O v3. Em 2026-08-18 o usuário descontinuou os formatos anteriores
// (v1 `DCM1.<10>.<20>` em base32 e v2 `2<10><31>` numérico): foram
// versões de teste, nenhum cartão delas chegou a circular na farmácia, e
// manter três caminhos vivos onde a operação tem um só criava superfície.
// As credenciais antigas continuam no banco como histórico; o que deixa
// de existir é o token daquele formato ser reconhecido.
export function publicIdDoToken(token: string): string | null {
  const limpo = token.trim()

  // 1 (versão) + 6 (public_id) + 15 (segredo) = 22 dígitos, sem
  // separador: um ponto no meio quebraria o modo numérico do Code 128
  // (Set C, dois dígitos por símbolo) e o código não caberia no cartão.
  if (/^3[0-9]{21}$/.test(limpo)) return limpo.slice(1, 7)

  return null
}
