// =====================================================================
// Geolocalização
//
// **Nunca bloqueia a saída**, e isso não é conveniência: o PC do balcão
// não tem GPS. O navegador resolve posição mandando os WiFi vizinhos pro
// serviço do Google, o que EXIGE REDE. Offline não existe a quem
// perguntar — exigir coordenada seria proibir saída sem internet, que é
// justamente o caminho que este projeto passou dias provando.
//
// O QUE DÁ PRA FAZER OFFLINE, E O QUE NÃO DÁ
//
// O navegador guarda a última leitura. Se ele conseguiu uma com rede,
// ela continua acessível depois — e vem com `timestamp` dizendo QUANDO
// foi obtida. Então:
//
//   1. `aquecerGeolocalizacao()` pede uma leitura quando a tela abre com
//      internet, pra existir algo recente no cache na hora de selar;
//   2. ao selar, tenta leitura fresca; não vindo, aceita a do cache.
//
// **A leitura do cache é rotulada como tal.** `obtida_em` é o horário
// real da medição e `origem` diz se veio fresca ou do cache. Um romaneio
// que dissesse "posição no momento da selagem" mostrando uma leitura de
// duas horas antes seria a tela afirmando o que não sabe — o defeito que
// este projeto já pagou caro três vezes.
//
// E quando não há nada, grava-se o MOTIVO em vez de um campo vazio.
// "Não registrada" e "negada pelo usuário" são fatos diferentes numa
// cadeia de custódia; um buraco não distingue os dois.
// =====================================================================

// Prazo pra leitura fresca. Maior que os 3s de antes: aquele número
// existia pra não deixar o motoboy esperando, mas era curto demais pra
// alguém RESPONDER ao pedido de permissão do navegador, que é o momento
// em que a permissão de verdade se decide.
const TIMEOUT_GEO_MS = 8000

// Quão velha uma leitura de cache pode ser e ainda servir. Dez minutos:
// o balcão não se move, então a posição não envelhece de verdade — o que
// envelhece é a afirmação, e por isso `obtida_em` vai junto.
const IDADE_MAXIMA_CACHE_MS = 10 * 60_000

export type Geolocalizacao =
  | {
      lat: number
      lon: number
      precisao_m: number
      /** Quando a leitura foi de fato medida, não quando foi usada. */
      obtida_em: string
      origem: 'fresca' | 'cache'
    }
  | {
      /** Sem coordenada: o motivo é o dado. */
      indisponivel: 'negada' | 'sem_suporte' | 'indisponivel' | 'expirou'
      tentada_em: string
    }

function lerPosicao(opcoes: PositionOptions): Promise<GeolocationPosition | GeolocationPositionError | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }
    // Resolve uma vez só: o timeout do navegador nem sempre dispara (aba
    // em segundo plano, permissão pendente), então o nosso é quem
    // garante que a promessa termina.
    let respondido = false
    const responder = (v: GeolocationPosition | GeolocationPositionError | null) => {
      if (respondido) return
      respondido = true
      resolve(v)
    }
    const relogio = setTimeout(() => responder(null), (opcoes.timeout ?? TIMEOUT_GEO_MS) + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(relogio)
        responder(p)
      },
      (e) => {
        clearTimeout(relogio)
        responder(e)
      },
      opcoes
    )
  })
}

/**
 * Pede uma leitura enquanto há rede, só pra deixar algo recente no cache
 * do navegador. Não devolve nada e não atrapalha: é chamada quando a tela
 * monta, do mesmo jeito que o cache de credenciais.
 */
export async function aquecerGeolocalizacao(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return
  await lerPosicao({ enableHighAccuracy: false, timeout: TIMEOUT_GEO_MS, maximumAge: 0 })
}

export async function capturarGeolocalizacao(): Promise<Geolocalizacao> {
  const agora = new Date().toISOString()

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { indisponivel: 'sem_suporte', tentada_em: agora }
  }

  const converter = (p: GeolocationPosition, origem: 'fresca' | 'cache'): Geolocalizacao => ({
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    precisao_m: p.coords.accuracy,
    obtida_em: new Date(p.timestamp).toISOString(),
    origem,
  })

  // 1. Leitura fresca. Offline no desktop isto falha, e é esperado.
  const fresca = await lerPosicao({
    enableHighAccuracy: false,
    timeout: TIMEOUT_GEO_MS,
    maximumAge: 0,
  })
  if (fresca && 'coords' in fresca) return converter(fresca, 'fresca')

  // Permissão negada não melhora com segunda tentativa, e insistir só
  // faria o motoboy esperar por nada.
  if (fresca && 'code' in fresca && fresca.code === fresca.PERMISSION_DENIED) {
    return { indisponivel: 'negada', tentada_em: agora }
  }

  // 2. O que o navegador tiver guardado. É aqui que a saída offline
  //    consegue coordenada, quando a tela foi aberta com rede antes.
  const doCache = await lerPosicao({
    enableHighAccuracy: false,
    timeout: 1500,
    maximumAge: IDADE_MAXIMA_CACHE_MS,
  })
  if (doCache && 'coords' in doCache) return converter(doCache, 'cache')

  return {
    indisponivel: fresca === null ? 'expirou' : 'indisponivel',
    tentada_em: agora,
  }
}


const MOTIVO_SEM_GEO: Record<string, string> = {
  negada: 'não autorizada neste computador',
  sem_suporte: 'o navegador não oferece localização',
  indisponivel: 'não foi possível determinar',
  expirou: 'não respondeu a tempo',
}

/**
 * Texto pra tela e pro PDF. Uma leitura do CACHE não é a posição no
 * momento da selagem, e o rótulo diz isso — apresentá-la como leitura do
 * instante seria a tela afirmando o que não sabe.
 *
 * Ausência vira frase com motivo, não campo vazio: "não registrada" e
 * "negada" são fatos diferentes numa cadeia de custódia.
 */
export function textoGeo(geo: unknown): string | null {
  if (!geo || typeof geo !== 'object') return null
  const g = geo as Partial<Record<string, unknown>>

  if (typeof g.indisponivel === 'string') {
    return `sem coordenada — ${MOTIVO_SEM_GEO[g.indisponivel] ?? g.indisponivel}`
  }

  if (typeof g.lat !== 'number' || typeof g.lon !== 'number') return null

  const precisao = typeof g.precisao_m === 'number' ? ` (±${Math.round(g.precisao_m)}m)` : ''
  const quando =
    g.origem === 'cache' && typeof g.obtida_em === 'string'
      ? ` — leitura de ${new Date(g.obtida_em).toLocaleTimeString('pt-BR')}, não do momento da selagem`
      : ''
  return `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}${precisao}${quando}`
}
