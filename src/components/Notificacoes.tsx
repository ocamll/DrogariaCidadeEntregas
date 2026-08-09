import { useQueryClient } from '@tanstack/react-query'
import type { AuthProfile } from '@/data/auth'
import { marcarNotificacoesPagamentoLidas } from '@/data/auth'
import { useNotificacoesHoje } from '@/data/notificacoes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { NotificacaoCard } from '@/components/NotificacaoCard'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog'

export function Notificacoes({ profile }: { profile: AuthProfile }) {
  const { data } = useNotificacoesHoje()
  const queryClient = useQueryClient()

  const lidasEm = profile.notificacoesPagamentoLidasEm
    ? new Date(profile.notificacoesPagamentoLidasEm)
    : null
  const naoLidas = (data ?? []).filter(
    (notificacao) => !lidasEm || new Date(notificacao.ocorridoEm) > lidasEm
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
          Notificações
          {naoLidas > 0 && (
            <Badge variant="secondary" className="ml-1">
              {naoLidas}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notificações de hoje</DialogTitle>
          <DialogDescription>
            Só o aviso de hoje — o histórico completo com justificativa fica na aba
            "Ocorrências".
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {(data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma notificação hoje.</p>
          )}
          {data?.map((notificacao) => (
            <NotificacaoCard key={notificacao.id} notificacao={notificacao} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
