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
