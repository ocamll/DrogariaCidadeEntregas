import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import type { AuthProfile } from '@/data/auth'
import type { FormaComValor } from '@/data/pagamentos'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificarOcorrenciaDialog } from '@/components/NotificarOcorrenciaDialog'
import { CancelarValeDialog } from '@/components/CancelarValeDialog'
import { ReceberDocumentoDialog } from '@/components/ReceberDocumentoDialog'
import {
  cargoRecebeDocumento,
  tiposQuePodemEstarPendentes,
  type ValeParaRecebimento,
} from '@/lib/documentosDoVale'

export function EntregaAcoesMenu({
  entregaId,
  numeroVale,
  clienteNome,
  tipo,
  statusEntrega,
  previstos,
  valorCents,
  temReceita,
  receitaRecebidaEm,
  statusDocumental,
  profile,
}: {
  entregaId: string
  numeroVale: string
  clienteNome: string
  tipo: 'cliente' | 'transferencia'
  statusEntrega: string
  previstos: FormaComValor[]
  valorCents: number
  temReceita: boolean
  receitaRecebidaEm: string | null
  statusDocumental: string
  profile: AuthProfile
}) {
  const [ocorrenciaAberta, setOcorrenciaAberta] = useState(false)
  const [cancelamentoAberto, setCancelamentoAberto] = useState(false)
  const [recebimentoAberto, setRecebimentoAberto] = useState(false)

  const vale: ValeParaRecebimento = {
    tipo,
    statusEntrega,
    statusDocumental,
    formasPrevistas: previstos,
    temReceita,
    receitaRecebidaEm,
  }
  // Depois do retorno, com papel que pode estar pendente, e só pra caixa e
  // gerente: o admin consulta, não declara recebimento físico. É palpite
  // pela linha do vale — o diálogo lê o retorno e o servidor confere.
  const podeReceber =
    cargoRecebeDocumento(profile.papel) && tiposQuePodemEstarPendentes(vale).length > 0

  // transferência não tem pagamento — divergência não faz sentido nela.
  // Sem receita marcada, também não tem o que notificar de "falta de
  // receita".
  const podeNotificar = tipo !== 'transferencia' || temReceita

  // Só vale pendente cancela: depois que entra numa corrida o papel está
  // com o motoboy, e o desfecho passa a ser insucesso no retorno.
  const podeCancelar = statusEntrega === 'pendente'

  if (!podeNotificar && !podeCancelar && !podeReceber) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Ações do vale">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {podeReceber && (
            <DropdownMenuItem onSelect={() => setRecebimentoAberto(true)}>
              Receber documento
            </DropdownMenuItem>
          )}
          {podeNotificar && (
            <DropdownMenuItem onSelect={() => setOcorrenciaAberta(true)}>
              Notificar ocorrência
            </DropdownMenuItem>
          )}
          {podeCancelar && (
            <DropdownMenuItem variant="destructive" onSelect={() => setCancelamentoAberto(true)}>
              Cancelar vale
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {podeNotificar && (
        <NotificarOcorrenciaDialog
          entregaId={entregaId}
          tipo={tipo}
          previstos={previstos}
          valorCents={valorCents}
          temReceita={temReceita}
          profile={profile}
          open={ocorrenciaAberta}
          onOpenChange={setOcorrenciaAberta}
        />
      )}

      {podeReceber && (
        <ReceberDocumentoDialog
          entregaId={entregaId}
          numeroVale={numeroVale}
          clienteNome={clienteNome}
          vale={vale}
          profile={profile}
          open={recebimentoAberto}
          onOpenChange={setRecebimentoAberto}
        />
      )}

      {podeCancelar && (
        <CancelarValeDialog
          entregaId={entregaId}
          numeroVale={numeroVale}
          clienteNome={clienteNome}
          profile={profile}
          open={cancelamentoAberto}
          onOpenChange={setCancelamentoAberto}
        />
      )}
    </>
  )
}
