import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import type { AuthProfile } from '@/data/auth'
import type { FormaPagamento } from '@/data/pagamentos'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificarOcorrenciaDialog } from '@/components/NotificarOcorrenciaDialog'

export function EntregaAcoesMenu({
  entregaId,
  tipo,
  formaEsperadaAtual,
  valorCents,
  temReceita,
  profile,
}: {
  entregaId: string
  tipo: 'cliente' | 'transferencia'
  formaEsperadaAtual: FormaPagamento | null
  valorCents: number
  temReceita: boolean
  profile: AuthProfile
}) {
  const [ocorrenciaAberta, setOcorrenciaAberta] = useState(false)

  // transferência não tem pagamento — divergência não faz sentido nela.
  // Sem receita marcada, também não tem o que notificar de "falta de
  // receita". Se nenhum dos dois se aplica, não tem ação nenhuma pra
  // oferecer aqui.
  const podeNotificar = tipo !== 'transferencia' || temReceita
  if (!podeNotificar) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Ações do vale">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOcorrenciaAberta(true)}>
            Notificar ocorrência
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NotificarOcorrenciaDialog
        entregaId={entregaId}
        tipo={tipo}
        formaEsperadaAtual={formaEsperadaAtual}
        valorCents={valorCents}
        temReceita={temReceita}
        profile={profile}
        open={ocorrenciaAberta}
        onOpenChange={setOcorrenciaAberta}
      />
    </>
  )
}
