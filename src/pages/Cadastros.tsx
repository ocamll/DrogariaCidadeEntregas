import type { AuthProfile } from '@/data/auth'
import { AgenciasCadastro } from '@/components/AgenciasCadastro'
import { MototaxistasCadastro } from '@/components/MototaxistasCadastro'
import { ConveniosCadastro } from '@/components/ConveniosCadastro'
import { UsuariosCadastro } from '@/components/UsuariosCadastro'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export function Cadastros({ profile }: { profile: AuthProfile }) {
  // Usuários é a única sub-aba que gerente não vê: criar e editar acesso
  // é a ação mais sensível do sistema. O gate de verdade está na RLS e na
  // Edge Function — aqui é só pra não mostrar o que não vai funcionar.
  const isAdmin = profile.papel === 'admin'

  return (
    <Tabs defaultValue="agencias">
      <TabsList>
        <TabsTrigger value="agencias">Agências</TabsTrigger>
        <TabsTrigger value="mototaxistas">Mototaxistas</TabsTrigger>
        <TabsTrigger value="convenios">Convênios</TabsTrigger>
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
        <TabsContent value="usuarios" className="pt-3">
          <UsuariosCadastro profile={profile} />
        </TabsContent>
      )}
    </Tabs>
  )
}
