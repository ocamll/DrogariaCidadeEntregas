import { useEffect, useRef } from 'react'
import SignaturePad from 'signature_pad'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

// O canvas de assinatura, um só.
//
// Morava dentro de `NovaCorrida.tsx` e saiu de lá em 2026-08-21, quando o
// Romaneio de Retorno passou a precisar do mesmo campo. Duas cópias de um
// canvas parecem inofensivas até uma delas ganhar o `ratio` de tela
// retina e a outra não — e aí os traços gravados nos dois documentos
// deixam de estar na mesma escala, o que só aparece no PDF, meses depois.
//
// Ele NÃO decide nada sobre custódia: quem lê `toData()` e quando é a
// tela. Aqui só há o canvas e o botão de limpar.
export function CampoAssinatura({
  rotulo,
  padRef,
}: {
  rotulo: string
  padRef: React.RefObject<SignaturePad | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d')?.scale(ratio, ratio)

    const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' })
    padRef.current = pad
    return () => {
      pad.off()
      padRef.current = null
    }
  }, [padRef])

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{rotulo}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => padRef.current?.clear()}>
          Limpar
        </Button>
      </div>
      <canvas ref={canvasRef} className="h-32 w-full touch-none rounded-lg border bg-white" />
    </div>
  )
}
