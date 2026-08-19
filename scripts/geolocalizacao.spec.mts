// Testes da captura de geolocalização (src/lib/geolocalizacao.ts).
//
// Roda com:  npx tsx scripts/geolocalizacao.spec.mts
//
// Por que isto merece teste: a função tem TRÊS caminhos (leitura fresca,
// leitura de cache, ausência com motivo) e o que ela devolve entra num
// documento de custódia e é amarrado por hash. Um caminho errado aqui não
// dá erro — dá um romaneio afirmando a coisa errada sobre onde a saída
// aconteceu.
//
// O `navigator.geolocation` é substituído por um dublê. É a única forma
// de exercitar "permissão negada" e "offline sem cache" sem depender de
// permissão de navegador nem de rede.
import { capturarGeolocalizacao, textoGeo } from '../src/lib/geolocalizacao.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const PERMISSION_DENIED = 1
const POSITION_UNAVAILABLE = 2

// O Node 24 já tem `navigator` global, e só com getter — atribuir direto
// lança TypeError. `defineProperty` é o caminho.
function definirNavigator(valor: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: valor,
    configurable: true,
    writable: true,
  })
}

type Resposta =
  | { tipo: 'posicao'; lat: number; lon: number; precisao: number; quando: number }
  | { tipo: 'erro'; code: number }
  | { tipo: 'silencio' }

// Dublê: responde conforme `maximumAge` — é exatamente assim que o
// navegador distingue "quero leitura nova" de "aceito a guardada".
function instalarGeolocation(fresca: Resposta, cache: Resposta) {
  const responder = (r: Resposta, ok: PositionCallback, erro: PositionErrorCallback) => {
    if (r.tipo === 'silencio') return // nunca chama de volta: o timeout resolve
    if (r.tipo === 'erro') {
      erro({ code: r.code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
      return
    }
    ok({
      coords: { latitude: r.lat, longitude: r.lon, accuracy: r.precisao },
      timestamp: r.quando,
    } as GeolocationPosition)
  }

  definirNavigator({
    onLine: true,
    geolocation: {
      getCurrentPosition: (ok: PositionCallback, erro: PositionErrorCallback, opts?: PositionOptions) => {
        setTimeout(() => responder((opts?.maximumAge ?? 0) > 0 ? cache : fresca, ok, erro), 1)
      },
    },
  })
}

const AGORA = Date.parse('2026-08-18T14:30:00.000Z')
const HA_5_MIN = AGORA - 5 * 60_000

console.log('\n--- leitura fresca ---')
instalarGeolocation(
  { tipo: 'posicao', lat: -30.336, lon: -54.32, precisao: 22.5, quando: AGORA },
  { tipo: 'silencio' }
)
const fresca = await capturarGeolocalizacao()
checa('devolve coordenada', 'lat' in fresca && fresca.lat === -30.336)
checa('marca origem como fresca', 'origem' in fresca && fresca.origem === 'fresca')
checa(
  'guarda o horário REAL da medição, não o do uso',
  'obtida_em' in fresca && fresca.obtida_em === new Date(AGORA).toISOString(),
  'obtida_em' in fresca ? fresca.obtida_em : ''
)
checa('guarda a precisão', 'precisao_m' in fresca && fresca.precisao_m === 22.5)

console.log('\n--- sem leitura fresca, mas com cache (o caso OFFLINE) ---')
//
// É este o caminho que faz uma saída offline ter coordenada: o desktop
// não tem GPS, então sem rede não há leitura nova — mas o navegador
// guardou a que foi obtida quando a tela abriu com internet.
instalarGeolocation(
  { tipo: 'erro', code: POSITION_UNAVAILABLE },
  { tipo: 'posicao', lat: -30.337, lon: -54.321, precisao: 40, quando: HA_5_MIN }
)
const doCache = await capturarGeolocalizacao()
checa('usa a leitura guardada', 'lat' in doCache && doCache.lat === -30.337)
checa('marca origem como cache', 'origem' in doCache && doCache.origem === 'cache')
checa(
  'obtida_em é de 5 minutos antes, não de agora',
  'obtida_em' in doCache && doCache.obtida_em === new Date(HA_5_MIN).toISOString()
)
// O rótulo é o ponto: um romaneio não pode apresentar leitura guardada
// como se fosse do instante da selagem.
const rotulo = textoGeo(doCache)
checa('o texto avisa que NÃO é do momento da selagem', !!rotulo?.includes('não do momento da selagem'), rotulo ?? '')

console.log('\n--- permissão negada ---')
instalarGeolocation({ tipo: 'erro', code: PERMISSION_DENIED }, { tipo: 'posicao', lat: 1, lon: 2, precisao: 3, quando: AGORA })
const negada = await capturarGeolocalizacao()
checa('não devolve coordenada', !('lat' in negada))
checa('registra o motivo "negada"', 'indisponivel' in negada && negada.indisponivel === 'negada')
// Negada não tenta o cache: insistir só faria o motoboy esperar, e a
// resposta não mudaria.
checa('não cai no cache depois de negada', !('origem' in negada))
checa('o texto explica o motivo', textoGeo(negada) === 'sem coordenada — não autorizada neste computador', String(textoGeo(negada)))

console.log('\n--- nada disponível, nem fresca nem cache ---')
instalarGeolocation({ tipo: 'erro', code: POSITION_UNAVAILABLE }, { tipo: 'erro', code: POSITION_UNAVAILABLE })
const nada = await capturarGeolocalizacao()
checa('registra indisponível', 'indisponivel' in nada && nada.indisponivel === 'indisponivel')
checa('guarda quando foi tentada', 'tentada_em' in nada && typeof nada.tentada_em === 'string')
checa('o texto explica', textoGeo(nada)?.startsWith('sem coordenada —') === true, String(textoGeo(nada)))

console.log('\n--- navegador sem suporte ---')
definirNavigator({ onLine: true })
const semSuporte = await capturarGeolocalizacao()
checa('registra sem_suporte', 'indisponivel' in semSuporte && semSuporte.indisponivel === 'sem_suporte')

console.log('\n--- nunca devolve nulo ---')
//
// O contrato mudou: antes era `T | null` e o campo ficava vazio. Agora
// SEMPRE há um fato gravado — coordenada ou motivo. É o que impede o
// romaneio de ter um buraco onde deveria ter uma afirmação.
checa('fresca é objeto', typeof fresca === 'object' && fresca !== null)
checa('negada é objeto', typeof negada === 'object' && negada !== null)
checa('sem suporte é objeto', typeof semSuporte === 'object' && semSuporte !== null)

console.log('\n--- textoGeo com lixo ---')
checa('nulo vira nulo', textoGeo(null) === null)
checa('objeto vazio vira nulo', textoGeo({}) === null)
checa('sem lat/lon vira nulo', textoGeo({ precisao_m: 10 }) === null)
checa(
  'leitura fresca não ganha o aviso de cache',
  textoGeo({ lat: -30.1, lon: -54.2, precisao_m: 10, origem: 'fresca', obtida_em: new Date().toISOString() })?.includes('não do momento') === false
)

console.log(`\n${falhas === 0 ? 'geolocalização ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
