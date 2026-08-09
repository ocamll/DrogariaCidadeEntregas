import type { AuthProfile } from '@/data/auth'
import { AgenciasCadastro } from '@/components/AgenciasCadastro'
import { MototaxistasCadastro } from '@/components/MototaxistasCadastro'
import { ConveniosCadastro } from '@/components/ConveniosCadastro'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export function Cadastros({ profile }: { profile: AuthProfile }) {
  return (
    <Tabs defaultValue="agencias">
      <TabsList>
        <TabsTrigger value="agencias">Agências</TabsTrigger>
        <TabsTrigger value="mototaxistas">Mototaxistas</TabsTrigger>
        <TabsTrigger value="convenios">Convênios</TabsTrigger>
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
    </Tabs>
  )
}
