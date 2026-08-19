import { useEffect, useRef, useState } from 'react'
import {
  AUTH_METHOD_LABEL,
  type AssinaturaDoRomaneio,
  type CustodiaDoVale,
} from '@/data/romaneios'
import { textoGeo } from '@/lib/geolocalizacao'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Romaneio } from '@/pages/Romaneio'

// =====================================================================
// Assinatura desenhada a partir dos traços
//
// O banco guarda os STROKES (vetores), não um PNG — decisão que já vinha
// do schema inicial e que o romaneio manteve. Então quem desenha é a
// tela, e a imagem pode ser gerada em qualquer tamanho depois.
//
// Não uso `SignaturePad.fromData` de propósito: ele redesenha em
// coordenadas absolutas, do tamanho do canvas onde a assinatura foi
// capturada. Aqui o espaço é outro (uma linha de tabela, não um tablet),
// então a assinatura sairia cortada. Desenhar à mão permite calcular o
// retângulo real dos pontos e ajustar — funciona pra qualquer tamanho de
// captura, inclusive os que ainda não existem.
// =====================================================================

type Ponto = { x: number; y: number }
type Traco = { points?: Ponto[] }

export function AssinaturaDesenhada({
  strokes,
  largura = 260,
  altura = 90,
}: {
  strokes: unknown
  largura?: number
  altura?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = largura * ratio
    canvas.height = altura * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, largura, altura)

    const tracos = (Array.isArray(strokes) ? strokes : []) as Traco[]
    const pontos = tracos.flatMap((t) => t.points ?? [])
    if (pontos.length === 0) return

    const minX = Math.min(...pontos.map((p) => p.x))
    const maxX = Math.max(...pontos.map((p) => p.x))
    const minY = Math.min(...pontos.map((p) => p.y))
    const maxY = Math.max(...pontos.map((p) => p.y))

    const margem = 6
    // `|| 1` cobre a assinatura de um traço só na horizontal (ou
    // vertical), onde a largura do retângulo é zero e a escala viraria
    // infinito.
    const escala = Math.min(
      (largura - margem * 2) / (maxX - minX || 1),
      (altura - margem * 2) / (maxY - minY || 1)
    )
    const deslocX = margem + (largura - margem * 2 - (maxX - minX) * escala) / 2
    const deslocY = margem + (altura - margem * 2 - (maxY - minY) * escala) / 2

    ctx.strokeStyle = getComputedStyle(canvas).color
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const traco of tracos) {
      const pts = traco.points ?? []
      if (pts.length === 0) continue
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = deslocX + (p.x - minX) * escala
        const y = deslocY + (p.y - minY) * escala
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      // Um toque só (um ponto) não desenha linha nenhuma; o arco garante
      // que ele apareça em vez de sumir.
      if (pts.length === 1) {
        ctx.arc(deslocX, deslocY, 1, 0, Math.PI * 2)
      }
      ctx.stroke()
    }
  }, [strokes, largura, altura])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: largura, height: altura }}
      className="rounded border bg-white text-black dark:bg-neutral-100"
    />
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-28 shrink-0 text-foreground/60">{rotulo}</span>
      <span className="break-all">{valor}</span>
    </div>
  )
}

export function BlocoAssinatura({ assinatura }: { assinatura: AssinaturaDoRomaneio }) {
  const ehCaixa = assinatura.tipoSignatario === 'caixa'
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wider uppercase text-foreground/70">
        Assinatura do {ehCaixa ? 'caixa' : 'motoboy'}
      </p>
      <AssinaturaDesenhada strokes={assinatura.strokes} />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{assinatura.nome}</p>
        {assinatura.agenciaNome && (
          <p className="text-xs text-foreground/70">{assinatura.agenciaNome}</p>
        )}
        <Linha
          rotulo="Autenticação"
          valor={
            assinatura.authMethod
              ? (AUTH_METHOD_LABEL[assinatura.authMethod] ?? assinatura.authMethod)
              : null
          }
        />
        {/* Só os 4 últimos: o suficiente pra casar com o cartão físico na
            mão, e nunca o token, que não existe fora do papel. */}
        <Linha
          rotulo="Credencial"
          valor={assinatura.credencialPublicId ? `••••${assinatura.credencialPublicId.slice(-4)}` : null}
        />
        <Linha
          rotulo="Servidor"
          valor={new Date(assinatura.assinadoEm).toLocaleString('pt-BR')}
        />
        <Linha
          rotulo="Dispositivo"
          valor={
            assinatura.assinadoEmLocal
              ? new Date(assinatura.assinadoEmLocal).toLocaleString('pt-BR')
              : null
          }
        />
        <Linha rotulo="IP" valor={assinatura.ip} />
        <Linha rotulo="Geolocalização" valor={textoGeo(assinatura.geolocalizacao)} />
        <Linha
          rotulo="Hash"
          valor={assinatura.signatureHash ? `${assinatura.signatureHash.slice(0, 32)}…` : null}
        />
      </div>
    </div>
  )
}

// O bloco que aparece dentro do vale quando o chevron abre.
export function CustodiaDoValeDetalhe({ custodia }: { custodia: CustodiaDoVale }) {
  const [verDocumento, setVerDocumento] = useState(false)

  const caixa = custodia.assinaturas.find((a) => a.tipoSignatario === 'caixa')
  const motoboy = custodia.assinaturas.find((a) => a.tipoSignatario === 'motoboy')

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Romaneio {custodia.numero}</span>
        {custodia.status === 'conflito' ? (
          <Badge variant="destructive">Conflito — não selado</Badge>
        ) : (
          <Badge variant="secondary">Selado</Badge>
        )}
        {/* Uma saída sincronizada depois não é a mesma coisa que uma
            validada na hora, e a tela não deve deixar as duas parecerem
            iguais. */}
        {custodia.modo === 'offline_sincronizada' && (
          <Badge variant="outline">Registrada offline</Badge>
        )}
        {custodia.status === 'selado' && (
          <Button variant="ghost" size="sm" onClick={() => setVerDocumento(true)}>
            Ver romaneio
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {custodia.ocorridoEmLocal && (
          <Linha
            rotulo="Saída"
            valor={new Date(custodia.ocorridoEmLocal).toLocaleString('pt-BR')}
          />
        )}
        {custodia.modo === 'offline_sincronizada' && (
          <Linha
            rotulo="Validada"
            valor={
              custodia.seladoEm ? new Date(custodia.seladoEm).toLocaleString('pt-BR') : 'ainda não'
            }
          />
        )}
        <Linha
          rotulo="Hash final"
          valor={custodia.finalHash ? `${custodia.finalHash.slice(0, 32)}…` : null}
        />
      </div>

      {custodia.status === 'conflito' ? (
        <p className="text-sm text-destructive">
          Esta saída não pôde ser selada — algum vale já estava em outra corrida. As assinaturas
          ficaram guardadas no registro do conflito, para a gestão resolver.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {caixa && <BlocoAssinatura assinatura={caixa} />}
          {motoboy && <BlocoAssinatura assinatura={motoboy} />}
        </div>
      )}

      {/* Dialog e não navegação: `EntregasTable` aparece em três telas
          diferentes, e levar uma função de navegação até lá exigiria fiar
          o prop por todas elas. Além disso o caixa não perde o lugar na
          lista — ele estava conferindo um vale, não saindo dela. */}
      <Dialog open={verDocumento} onOpenChange={setVerDocumento}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="sr-only">Romaneio {custodia.numero}</DialogTitle>
          </DialogHeader>
          <Romaneio romaneioId={custodia.romaneioId} onVoltar={() => setVerDocumento(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
