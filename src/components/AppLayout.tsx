import type { ReactNode } from 'react'
import { useAuth, signOut, type AuthProfile } from '@/data/auth'
import { useSincronizarFilaOffline } from '@/data/filaOffline'
import { Button } from '@/components/ui/button'
import { Notificacoes } from '@/components/Notificacoes'
import { FilaOfflineIndicador } from '@/components/FilaOfflineIndicador'
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
            <Notificacoes profile={profile} />
          )}
          <Button
            variant="outline"
            className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={() => signOut()}
          >
            Sair
          </Button>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  )
}
