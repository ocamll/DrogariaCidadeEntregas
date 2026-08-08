import { useQueryClient } from '@tanstack/react-query'
import type { AuthProfile } from '@/data/auth'
import { marcarNotificacoesPagamentoLidas } from '@/data/auth'
import { useAlteracoesPagamentoHoje } from '@/data/pagamentos'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlteracaoPagamentoCard } from '@/components/AlteracaoPagamentoCard'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'

export function NotificacoesPagamento({ profile }: { profile: AuthProfile }) {
  const { data } = useAlteracoesPagamentoHoje()
  const queryClient = useQueryClient()

  const lidasEm = profile.notificacoesPagamentoLidasEm
    ? new Date(profile.notificacoesPagamentoLidasEm)
    : null
  const naoLidas = (data ?? []).filter(
    (alteracao) => !lidasEm || new Date(alteracao.ocorridoEm) > lidasEm
  ).length

  function handleOpenChange(open: boolean) {
    if (!open || naoLidas === 0) return
    marcarNotificacoesPagamentoLidas(profile.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['profile', profile.id] })
    })
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          Alterações de pagamento
          {naoLidas > 0 && (
            <Badge variant="secondary" className="ml-1">
              {naoLidas}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterações de pagamento hoje</DialogTitle>
          <DialogDescription>
            Só o aviso de hoje — o histórico completo com justificativa fica na aba
            "Divergências".
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {(data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma alteração registrada hoje.</p>
          )}
          {data?.map((alteracao) => (
            <AlteracaoPagamentoCard key={alteracao.id} alteracao={alteracao} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
