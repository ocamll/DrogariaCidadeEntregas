import { AuthProvider, useAuth, signOut } from '@/data/auth'
import { Login } from '@/pages/Login'
import { Painel } from '@/pages/Painel'
import { AppLayout } from '@/components/AppLayout'
import { Button } from '@/components/ui/button'

function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground">Carregando…</p>
    </div>
  )
}

function ProfileErrorScreen({ error }: { error: Error }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
      <p className="text-destructive">{error.message}</p>
      <Button variant="outline" onClick={() => signOut()}>
        Sair
      </Button>
    </div>
  )
}

function AppContent() {
  const auth = useAuth()

  switch (auth.status) {
    case 'loading':
    case 'loading-profile':
      return <LoadingScreen />
    case 'signed-out':
      return <Login />
    case 'profile-error':
      return <ProfileErrorScreen error={auth.error} />
    case 'signed-in':
      return (
        <AppLayout>
          <Painel profile={auth.profile} />
        </AppLayout>
      )
  }
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
