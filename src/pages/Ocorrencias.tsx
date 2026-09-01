import { useTodasNotificacoes } from '@/data/notificacoes'
import { NotificacaoCard } from '@/components/NotificacaoCard'
import { Consulta } from '@/components/Consulta'
import { derivarEstado } from '@/lib/estadoDeConsulta'

// O registro permanente de ocorrências — é aqui que a gestão vem
// procurar o "porquê" de uma divergência depois de o dia acabar.
//
// A cadeia antiga era `if (isLoading) … if (isError) … if (!data) →
// "Nenhuma ocorrência registrada ainda."`, e a ORDEM enganava: parecia
// que os dois primeiros ramos protegiam o terceiro. Não protegiam, porque
// com a query pausada `isLoading` e `isError` vêm os dois `false` e o
// `!data` cai no último ramo.
//
// Numa tela de auditoria a mentira é cara: "nenhuma ocorrência" é o
// resultado que a gestão usa pra concluir que o dia correu limpo.
export function Ocorrencias() {
  const consulta = useTodasNotificacoes()
  const estado = derivarEstado(consulta)

  return (
    <Consulta
      estado={estado}
      vazio={<p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada ainda.</p>}
      aoRecarregar={() => void consulta.refetch()}
    >
      {(notificacoes) => (
        <div className="flex flex-col gap-3">
          {notificacoes.map((notificacao) => (
            <NotificacaoCard key={notificacao.id} notificacao={notificacao} mostrarData />
          ))}
        </div>
      )}
    </Consulta>
  )
}
