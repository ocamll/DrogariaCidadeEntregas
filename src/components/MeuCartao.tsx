import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useMinhaCredencial,
  useRedefinirMeuPin,
  credencialBloqueada,
} from '@/data/credenciais'
import { CriarPinDoCartao } from '@/components/CriarPinDoCartao'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Carregando, EmAndamento } from '@/components/EmAndamento'

// O cartão de autorização do gerente, na mão de quem é dele.
//
// POR QUE ISTO EXISTE, e não é conveniência: a exceção do gerente serve
// pra destravar o balcão quando o motoboy perdeu o cartão ou esqueceu o
// PIN. Um gerente que esqueceu o PRÓPRIO PIN e precisa esperar o admin
// atender o telefone não destrava nada — às 20h de uma sexta, com o
// motoboy esperando, a exceção simplesmente não existe.
//
// Redefinir aqui NÃO afrouxa nada, e vale escrever por quê: continuam
// sendo necessárias as duas coisas — a SESSÃO, que prova quem é, e o
// CARTÃO, que prova posse (sem ele o PIN novo não se cria). Quem tivesse
// só a sessão zeraria um PIN que não consegue usar.
//
// O motoboy não tem equivalente disto, e não é esquecimento: ele não tem
// conta, então não há sessão que prove quem ele é. O PIN dele continua
// sendo redefinido pelo admin — e é exatamente por isso que a exceção do
// gerente precisa funcionar.
export function MeuCartao({ profile }: { profile: AuthProfile }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setAberto(true)}>
        Meu cartão
      </Button>
      {aberto && <MeuCartaoDialog profile={profile} onFechar={() => setAberto(false)} />}
    </>
  )
}

function MeuCartaoDialog({
  profile,
  onFechar,
}: {
  profile: AuthProfile
  onFechar: () => void
}) {
  const consulta = useMinhaCredencial(profile.id)
  const redefinir = useRedefinirMeuPin()
  const [confirmandoReset, setConfirmandoReset] = useState(false)

  const credencial = consulta.data ?? null
  const bloqueada = credencial !== null && credencialBloqueada(credencial)

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Meu cartão de autorização</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {consulta.isPending ? (
            <Carregando />
          ) : consulta.isError ? (
            <p className="text-sm text-destructive">
              Não consegui consultar seu cartão: {(consulta.error as Error).message}
            </p>
          ) : credencial === null ? (
            // "Não tem cartão" e "não consegui perguntar" são coisas
            // diferentes, e os dois ramos acima existem pra isso.
            <p className="text-sm">
              Você ainda não tem cartão de autorização. Peça ao administrador para emitir um — ele
              serve para liberar uma saída ou um retorno quando o motoboy perdeu o cartão ou
              esqueceu o PIN.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">••••{credencial.publicId.slice(-4)}</span>
                {bloqueada ? (
                  <Badge variant="destructive">
                    Bloqueado até {new Date(credencial.bloqueadoAte!).toLocaleTimeString('pt-BR')}
                  </Badge>
                ) : (
                  <Badge variant={credencial.temPin ? 'secondary' : 'outline'}>
                    {credencial.temPin ? 'PIN configurado' : 'Aguardando PIN'}
                  </Badge>
                )}
              </div>

              <p className="text-xs text-foreground/70">
                {credencial.ultimoUsoEm
                  ? `Último uso em ${new Date(credencial.ultimoUsoEm).toLocaleString('pt-BR')}.`
                  : 'Ainda não foi usado.'}
              </p>

              {/* Sem PIN: o caminho é criar, com o cartão na mão. Este é
                  o mesmo formulário da tela do admin — um só, pra não
                  existirem duas validações do formato do cartão. */}
              {!credencial.temPin && (
                <div className="rounded-lg border border-dashed p-3">
                  <CriarPinDoCartao
                    titularNome={profile.nome}
                    rotuloDoCartao="Bipa o seu cartão"
                    onPronto={() => void consulta.refetch()}
                  />
                </div>
              )}

              {credencial.temPin && !confirmandoReset && (
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <p className="text-sm">
                    Esqueceu o PIN? Você mesmo pode apagá-lo e criar outro — precisa estar com o
                    cartão na mão e com internet.
                  </p>
                  <div>
                    <Button variant="outline" size="sm" onClick={() => setConfirmandoReset(true)}>
                      Esqueci meu PIN
                    </Button>
                  </div>
                </div>
              )}

              {credencial.temPin && confirmandoReset && (
                <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
                  <p className="text-sm">
                    O PIN atual deixa de valer <strong>agora</strong>. Em seguida você cria o novo,
                    bipando o cartão. As autorizações que você já deu continuam intactas.
                  </p>
                  {redefinir.isError && (
                    <p className="text-sm text-destructive">
                      {(redefinir.error as Error).message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConfirmandoReset(false)}>
                      Cancelar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={redefinir.isPending}
                      onClick={async () => {
                        await redefinir.mutateAsync()
                        setConfirmandoReset(false)
                        void consulta.refetch()
                      }}
                    >
                      {redefinir.isPending ? <EmAndamento>Apagando</EmAndamento> : 'Apagar o PIN'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
