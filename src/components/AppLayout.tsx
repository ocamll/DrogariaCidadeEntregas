import { useState, type ReactNode } from 'react'
import { useAuth, signOut, type AuthProfile } from '@/data/auth'
import { useSincronizarFilaOffline, useOperacoesDoUsuario } from '@/data/filaOffline'
import { Button } from '@/components/ui/button'
import { Notificacoes } from '@/components/Notificacoes'
import { RegistroAuditoria } from '@/components/RegistroAuditoria'
import { FilaOfflineIndicador } from '@/components/FilaOfflineIndicador'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import logo from '@/assets/logo.png'

const PAPEL_LABEL: Record<AuthProfile['papel'], string> = {
  caixa: 'Caixa',
  gerente: 'Gerente',
  admin: 'Administrador',
  agencia: 'Agência',
  superadmin: 'Superadmin',
}

export function AppLayout({ children }: { children: ReactNode }) {
  const auth = useAuth()
  useSincronizarFilaOffline()
  if (auth.status !== 'signed-in') return null

  const { profile } = auth

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Drogaria Cidade" className="h-9 w-auto" />
          <p className="text-xs opacity-90">
            {profile.nome} · {PAPEL_LABEL[profile.papel]}
            {profile.lojaNome ? ` · ${profile.lojaNome}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FilaOfflineIndicador />
          {(profile.papel === 'admin' || profile.papel === 'gerente') && (
            <>
              <RegistroAuditoria profile={profile} />
              <Notificacoes profile={profile} />
            </>
          )}
          <BotaoSair profile={profile} />
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  )
}

// Sair com operação pendente na fila AVISA, mas não impede.
//
// A escolha é deliberada: o PC do balcão é compartilhado e trancar o
// caixa dentro da própria sessão é pior que o problema que isso
// resolveria. Nada se perde ao sair — as operações continuam gravadas
// localmente e voltam a sincronizar quando esta mesma conta entrar de
// novo, porque a fila tem dono. Quem garante isso não é esta tela e sim
// a Edge Function, que confere o JWT contra o dono da operação.
function BotaoSair({ profile }: { profile: AuthProfile }) {
  const pendentes = useOperacoesDoUsuario(profile.id)
  const [confirmando, setConfirmando] = useState(false)

  function handleSair() {
    if (pendentes.length > 0) {
      setConfirmando(true)
      return
    }
    void signOut()
  }

  return (
    <>
      <Button
        variant="outline"
        className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        onClick={handleSair}
      >
        Sair
      </Button>

      <Dialog open={confirmando} onOpenChange={setConfirmando}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendentes.length === 1
                ? 'Uma operação ainda não sincronizou'
                : `${pendentes.length} operações ainda não sincronizaram`}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm">
            Elas ficam gravadas neste computador e só sobem quando <strong>{profile.nome}</strong>{' '}
            entrar de novo aqui — outra conta não sincroniza por você. Nada se perde, mas até lá
            esses lançamentos não existem para as outras filiais.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(false)}>
              Ficar e aguardar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmando(false)
                void signOut()
              }}
            >
              Sair mesmo assim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
