import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useCancelarEntrega } from '@/data/entregas'
import { uuidv7 } from '@/lib/uuid'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function CancelarValeDialog({
  entregaId,
  numeroVale,
  clienteNome,
  profile,
  open,
  onOpenChange,
}: {
  entregaId: string
  numeroVale: string
  clienteNome: string
  profile: AuthProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const cancelar = useCancelarEntrega()

  function handleConfirmar() {
    const motivoTrim = motivo.trim()
    // Motivo é obrigatório pela regra 4 e pelo CHECK do banco — melhor
    // barrar aqui com mensagem clara que deixar estourar constraint.
    if (!motivoTrim) {
      setErro('Motivo é obrigatório — é ele que explica o cancelamento depois.')
      return
    }
    setErro(null)

    cancelar.mutate(
      {
        tenantId: profile.tenantId,
        entregaId,
        numeroVale,
        motivo: motivoTrim,
        canceladoPor: profile.id,
        autorNome: profile.nome,
        ocorridoEmLocal: new Date().toISOString(),
        eventoIdempotencyKey: uuidv7(),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => setErro(e.message),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar {numeroVale}</DialogTitle>
          <DialogDescription>
            O vale de {clienteNome} sai da lista de pendentes e não entra mais em corrida nem
            nos totais de dinheiro. Ele não é apagado: continua no histórico como cancelado, com
            o motivo, quem cancelou e quando.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="motivo-cancelamento">Motivo</Label>
          <Textarea
            id="motivo-cancelamento"
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder='Ex: "Digitei o endereço errado, refiz no vale seguinte." / "Cliente desistiu da compra."'
          />
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancelar.isPending}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={handleConfirmar} disabled={cancelar.isPending}>
            {cancelar.isPending ? 'Cancelando…' : 'Cancelar vale'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
