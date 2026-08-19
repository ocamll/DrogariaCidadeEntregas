import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },

  // As quatro bibliotecas pesadas do projeto entram por `await import()`,
  // pra só descerem quando alguém abre a tela que precisa delas (planilha,
  // PDF, cartão do motoboy). Isso é de propósito e não muda.
  //
  // O que muda aqui é só o DESENVOLVIMENTO. Sem esta lista, o Vite só
  // descobre essas dependências no instante em que o import dinâmico
  // roda, e aí re-otimiza o cache de deps no meio da sessão. A página que
  // já estava aberta continua segurando a URL antiga (`?v=<hash>`), que
  // passa a dar 404:
  //
  //   Failed to fetch dynamically imported module: .../bwip-js_browser.js?v=…
  //
  // Um reload resolve, mas o erro aparece justamente na primeira vez que
  // alguém usa a tela — e parece bug do app. Pré-empacotando na
  // inicialização, a descoberta acontece antes de qualquer página existir.
  //
  // Custo: `npm run dev` demora um pouco mais pra subir. Não afeta o
  // build de produção, onde o code splitting continua igual.
  optimizeDeps: {
    // O bwip-js saiu daqui com a credencial CR80: o app não o importa mais
    // (src/lib/code128.ts desenha as barras), ele só roda nos specs.
    include: ['exceljs', 'jspdf', 'jspdf-autotable'],
  },
})
