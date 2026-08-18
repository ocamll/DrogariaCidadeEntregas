import { useState } from 'react'
import {
  useFilaOperacoesPendentes,
  tentarAgora,
  descartarItemTerminal,
} from '@/data/filaOffline'
import type { ItemFilaOperacao } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const ROTULO_POR_TIPO: Record<ItemFilaOperacao['tipo'], string> = {
  entrega: 'Vale de cliente',
  transferencia: 'Transferência entre filiais',
  corrida: 'Saída do motoboy',
  romaneio_saida: 'Saída do motoboy (romaneio)',
  divergencia: 'Divergência de pagamento',
  fechamento_corrida: 'Retorno de corrida',
  falta_receita: 'Ocorrência de documento',
}

export function FilaOfflineIndicador() {
  const pendentes = useFilaOperacoesPendentes()
  const [aberto, setAberto] = useState(false)

  if (pendentes.length === 0) return null

  // Três situações que pedem respostas diferentes, e por isso não podem
  // aparecer como o mesmo aviso:
  //   terminal  → não vai resolver sozinho, precisa de gente
  //   bloqueado → é de outro usuário; resolve quando aquela conta entrar
  //   erro      → vai tentar de novo sozinho
  const terminais = pendentes.filter((i) => i.status === 'terminal')
  const bloqueados = pendentes.filter((i) => i.status === 'bloqueado')
  const comErro = pendentes.filter((i) => i.status === 'erro')
  // O que "Tentar agora" alcança: tudo que ainda pode sair da fila.
  const retentaveis = pendentes.filter((i) => i.status === 'erro' || i.status === 'pendente')

  const rotulo = terminais.length > 0
    ? 'Precisa de atenção'
    : bloqueados.length > 0
      ? 'De outro usuário'
      : comErro.length > 0
        ? 'Não sincronizado'
        : 'Sincronizando'

  const variante = terminais.length > 0 || comErro.length > 0 ? 'destructive' : 'secondary'

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAberto(true)}
        className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
      >
        {rotulo}
        <Badge variant={variante} className="ml-1">
          {pendentes.length}
        </Badge>
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Operações ainda não sincronizadas</DialogTitle>
          </DialogHeader>

          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {pendentes.map((item) => (
              <div key={item.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{ROTULO_POR_TIPO[item.tipo]}</span>
                  <Badge
                    variant={
                      item.status === 'terminal'
                        ? 'destructive'
                        : item.status === 'bloqueado'
                          ? 'outline'
                          : 'secondary'
                    }
                  >
                    {item.status === 'terminal'
                      ? 'Precisa de atenção'
                      : item.status === 'bloqueado'
                        ? 'De outro usuário'
                        : item.status === 'erro'
                          ? 'Vai tentar de novo'
                          : 'Na fila'}
                  </Badge>
                </div>
                <p className="text-xs text-foreground/70">
                  Registrado em {new Date(item.criadoEm).toLocaleString('pt-BR')}
                  {item.tentativas > 0 && ` · ${item.tentativas} tentativa(s)`}
                </p>
                {item.erro && <p className="mt-1 text-xs text-destructive">{item.erro}</p>}
                {item.status === 'bloqueado' && (
                  <p className="mt-1 text-xs text-foreground/70">
                    Só sincroniza quando a conta que registrou entrar neste computador.
                  </p>
                )}

                {item.status === 'terminal' && (
                  <div className="mt-2 flex flex-col gap-2">
                    <ConflitoDetalhado detalhe={item.detalhe} />
                    <p className="text-xs text-foreground/70">
                      A tentativa está registrada no sistema, com as duas assinaturas — dispensar
                      aqui só limpa este aviso.
                    </p>
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void descartarItemTerminal(item.id)}
                      >
                        Já anotei, dispensar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
            {/* Habilitado pra qualquer item que ainda possa sair da fila,
                não só pros que já falharam. Item 'pendente' que nunca foi
                executado era o único que o botão não alcançava — e é o mais
                aflitivo de todos, porque não tem erro nenhum escrito nele. */}
            <Button onClick={() => void tentarAgora()} disabled={retentaveis.length === 0}>
              Tentar agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Traduz o motivo cru do conflito pra uma frase que diz o que fazer.
//
// "ja_em_corrida" sozinho não ajuda ninguém no balcão: o que a pessoa
// precisa saber é QUAL vale e que ele já saiu com outra corrida.
const MOTIVO_CONFLITO: Record<string, string> = {
  ja_em_corrida: 'já saiu em outra corrida',
  status_nao_permite: 'não estava mais pendente',
  outra_filial: 'é de outra filial',
  outro_tenant: 'não é desta farmácia',
  vale_inexistente: 'não existe mais',
  documento_alterado: 'o conteúdo mudou depois de assinado',
  autenticacao_falhou: 'o PIN não conferiu na sincronização',
  cartao_de_outro_motoboy: 'o cartão apresentado é de outro motoboy',
}

function ConflitoDetalhado({ detalhe }: { detalhe: unknown }) {
  if (!detalhe || typeof detalhe !== 'object') return null
  const conflitos = (detalhe as { conflitos?: unknown }).conflitos
  if (!Array.isArray(conflitos) || conflitos.length === 0) return null

  return (
    <ul className="flex flex-col gap-0.5">
      {conflitos.map((c: { numero_vale?: string; motivo?: string }, i) => (
        <li key={i} className="text-xs">
          <strong>{c.numero_vale ?? 'Vale'}</strong> —{' '}
          {c.motivo ? (MOTIVO_CONFLITO[c.motivo] ?? c.motivo) : 'motivo desconhecido'}
        </li>
      ))}
    </ul>
  )
}
