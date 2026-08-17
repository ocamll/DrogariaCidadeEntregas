import type { AuthProfile } from '@/data/auth'
import { AgenciasCadastro } from '@/components/AgenciasCadastro'
import { MototaxistasCadastro } from '@/components/MototaxistasCadastro'
import { ConveniosCadastro } from '@/components/ConveniosCadastro'
import { UsuariosCadastro } from '@/components/UsuariosCadastro'
import { CredenciaisCadastro } from '@/components/CredenciaisCadastro'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export function Cadastros({ profile }: { profile: AuthProfile }) {
  // Usuários e Credenciais são as sub-abas que gerente não vê: criar
  // acesso e emitir credencial física são as ações mais sensíveis do
  // sistema. O gate de verdade está na RLS, na Edge Function e nas
  // funções SECURITY DEFINER — aqui é só pra não mostrar o que não vai
  // funcionar.
  const isAdmin = profile.papel === 'admin'

  return (
    <Tabs defaultValue="agencias">
      <TabsList>
        <TabsTrigger value="agencias">Agências</TabsTrigger>
        <TabsTrigger value="mototaxistas">Mototaxistas</TabsTrigger>
        <TabsTrigger value="convenios">Convênios</TabsTrigger>
        {isAdmin && <TabsTrigger value="credenciais">Credenciais</TabsTrigger>}
        {isAdmin && <TabsTrigger value="usuarios">Usuários</TabsTrigger>}
      </TabsList>
      <TabsContent value="agencias" className="pt-3">
        <AgenciasCadastro profile={profile} />
      </TabsContent>
      <TabsContent value="mototaxistas" className="pt-3">
        <MototaxistasCadastro profile={profile} />
      </TabsContent>
      <TabsContent value="convenios" className="pt-3">
        <ConveniosCadastro profile={profile} />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="credenciais" className="pt-3">
          <CredenciaisCadastro profile={profile} />
        </TabsContent>
      )}
      {isAdmin && (
        <TabsContent value="usuarios" className="pt-3">
          <UsuariosCadastro profile={profile} />
        </TabsContent>
      )}
    </Tabs>
  )
}
