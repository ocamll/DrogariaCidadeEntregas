// Data no fuso de quem está olhando, não em UTC.
//
// POR QUE ISTO EXISTE
//
// `new Date(iso).toISOString().slice(0, 10)` parece dar "o dia" e não dá:
// dá o dia em UTC. Uma saída às 21h em São Gabriel (UTC-3) é
// `2026-02-02T00:00:00Z` — o dia seguinte em UTC. Toda saída do fim da
// tarde cairia na data errada.
//
// Isso não incomodava enquanto o Drive tinha pasta por MÊS: só a última
// noite do mês errava. Com pasta por DIA, erra toda noite.
//
// A farmácia opera num fuso só, então o fuso do dispositivo é o certo
// aqui — é a mesma escolha que a aba Fechamento já fazia pra decidir o
// que é "o dia" (era uma cópia local desta função; agora é esta).
// Não confundir com a regra 8: ali o que está em jogo é QUE INSTANTE
// gravar, e a resposta continua sendo os dois relógios. Aqui é só como
// escrever um instante já escolhido.

/** `AAAA-MM-DD` no fuso local. */
export function dataLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** `AAAA-MM` no fuso local. */
export function mesLocal(d: Date): string {
  return dataLocal(d).slice(0, 7)
}

/**
 * Quanto tempo a corrida levou, do selo da saída ao fechamento.
 *
 * **Os dois instantes têm que ser do relógio do SERVIDOR**
 * (`corridas.saida_em` e `retorno_em`, carimbados por trigger). Misturar
 * servidor com dispositivo daria um intervalo que não aconteceu — o PC
 * do balcão pode estar 40 minutos errado, que é a razão da regra 8.
 *
 * Morava em `romaneioPdf.ts`, e mudou de casa quando a PÁGINA do romaneio
 * passou a mostrar os relógios também: importar aquele módulo só por esta
 * função puxaria o gerador de PDF pro bundle principal.
 *
 * Devolve `null` quando a corrida ainda está aberta. Quem exibe tem que
 * DIZER isso, não omitir o campo: ausência e "ainda em rota" não podem se
 * parecer.
 */
export function duracaoDaCorrida(saidaEm: string | null, retornoEm: string | null): string | null {
  if (!saidaEm || !retornoEm) return null
  const ms = new Date(retornoEm).getTime() - new Date(saidaEm).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}
