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
import { MarcarDivergenciaDialog } from '@/components/MarcarDivergenciaDialog'

export function EntregaAcoesMenu({
  entregaId,
  tipo,
  formaEsperadaAtual,
  valorCents,
  profile,
}: {
  entregaId: string
  tipo: 'cliente' | 'transferencia'
  formaEsperadaAtual: FormaPagamento | null
  valorCents: number
  profile: AuthProfile
}) {
  const [divergenciaAberta, setDivergenciaAberta] = useState(false)

  // transferência não tem pagamento — não faz sentido "divergência" nela.
  if (tipo === 'transferencia') return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Ações do vale">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDivergenciaAberta(true)}>
            Notificar divergência de pagamento
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MarcarDivergenciaDialog
        entregaId={entregaId}
        formaEsperadaAtual={formaEsperadaAtual}
        valorCents={valorCents}
        profile={profile}
        open={divergenciaAberta}
        onOpenChange={setDivergenciaAberta}
      />
    </>
  )
}
