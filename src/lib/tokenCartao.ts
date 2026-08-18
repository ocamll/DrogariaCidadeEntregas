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
// Espelha `public.public_id_do_token` (migration 20260817130000) e conhece
// os TRÊS formatos. Nenhum cartão é reemitido quando o formato muda, e
// estes dois parsers são os únicos pontos do sistema — banco e cliente —
// que sabem que existe mais de um. Mudam sempre juntos.
//
// Todos os numéricos são sem separador: ponto no meio quebraria o modo
// numérico do Code 128 (Set C, dois dígitos por símbolo) e o código
// ficaria quase 40% mais largo.
export function publicIdDoToken(token: string): string | null {
  const limpo = token.trim()

  // v3: 1 (versão) + 6 (public_id) + 15 (segredo) = 22 dígitos. Mais
  // curto que o v2 pra dobrar a margem de impressão — 0,426mm por módulo
  // contra 0,262mm. Ver o cabeçalho da migration 20260817130000.
  if (/^3[0-9]{21}$/.test(limpo)) return limpo.slice(1, 7)

  // v2: 1 + 10 (public_id) + 31 (segredo) = 42 dígitos.
  if (/^2[0-9]{41}$/.test(limpo)) return limpo.slice(1, 11)

  // v1: DCM1.<10>.<20>, alfabeto Crockford
  const partes = limpo.split('.')
  if (partes.length === 3 && partes[0] === 'DCM1' && partes[1].length === 10) return partes[1]

  return null
}
