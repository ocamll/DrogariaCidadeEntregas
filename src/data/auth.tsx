import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type Papel = 'caixa' | 'gerente' | 'admin' | 'agencia' | 'superadmin'

// TODO: substituir por Database['public']['Tables']['profiles']['Row'] quando
// `supabase gen types typescript` estiver configurado neste projeto.
export type AuthProfile = {
  id: string
  tenantId: string
  lojaId: string | null
  lojaNome: string | null
  nome: string
  papel: Papel
  notificacoesPagamentoLidasEm: string | null
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'loading-profile'; session: Session }
  | { status: 'profile-error'; session: Session; error: Error }
  | { status: 'signed-in'; session: Session; profile: AuthProfile }

const AuthContext = createContext<AuthState | null>(null)

type ProfileRow = {
  id: string
  tenant_id: string
  loja_id: string | null
  nome: string
  papel: Papel
  notificacoes_pagamento_lidas_em: string | null
  lojas: { nome: string } | null
}

async function fetchProfile(userId: string): Promise<AuthProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, tenant_id, loja_id, nome, papel, notificacoes_pagamento_lidas_em, lojas(nome)')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    // profile inexistente ou `ativo = false`: current_tenant_id() retorna NULL,
    // a policy nunca casa, e o select volta 0 linhas sem erro nenhum.
    throw new Error('Perfil não encontrado ou inativo. Fale com o administrador.')
  }

  const row = data as unknown as ProfileRow

  return {
    id: row.id,
    tenantId: row.tenant_id,
    lojaId: row.loja_id,
    lojaNome: row.lojas?.nome ?? null,
    nome: row.nome,
    papel: row.papel,
    notificacoesPagamentoLidasEm: row.notificacoes_pagamento_lidas_em,
  }
}

export async function marcarNotificacoesPagamentoLidas(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ notificacoes_pagamento_lidas_em: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}

export async function signInWithPassword(email: string, senha: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
  if (error) throw error
}

export function signOut() {
  return supabase.auth.signOut()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  const profileQuery = useQuery({
    queryKey: ['profile', session?.user.id],
    queryFn: () => fetchProfile(session!.user.id),
    enabled: !!session,
    retry: false,
    staleTime: 5 * 60_000,
  })

  let state: AuthState
  if (session === undefined) {
    state = { status: 'loading' }
  } else if (session === null) {
    state = { status: 'signed-out' }
  } else if (profileQuery.isError) {
    state = { status: 'profile-error', session, error: profileQuery.error as Error }
  } else if (profileQuery.data) {
    state = { status: 'signed-in', session, profile: profileQuery.data }
  } else {
    state = { status: 'loading-profile', session }
  }

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa ser usado dentro de <AuthProvider>.')
  return ctx
}
