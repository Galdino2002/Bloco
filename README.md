# Bloco

Caderno digital para estudar, organizar anotações e resolver provas diretamente nas páginas.

## Cadernos
- Importação de páginas em imagem e navegação entre páginas.
- Escrita, desenho, marca-texto, borracha, laço e edição dos traços.
- Zoom, salvamento automático local e recuperação por backup.
- Organização por pastas, favoritos, busca, lixeira e duplicação.
- Exportação do caderno em PDF.

## Ambiente de provas
- Fluxos de prova para URCA, UECE e os dois dias do ENEM.
- Importação de PDFs e conversão de páginas para imagens locais.
- Resolução diretamente sobre as páginas, com ferramentas de anotação.
- Cronômetro, salvamento automático e retomada de provas salvas.

## Ambiente de redação
- Redação digitada e manuscrita.
- Ferramentas de desenho, seleção e edição de traços.
- Salvamento automático, recuperação por backup e histórico de redações.
- Compartilhamento de texto ou imagem para solicitar correção.

## Backup
- Exportação de cadernos, provas e redações em um arquivo JSON.
- Inclusão dos arquivos de imagem locais associados às páginas.
- Restauração com confirmação e cópias de segurança locais.

## Compatibilidade
- Expo SDK 57 e React Native 0.86.
- Projeto preparado para execução pelo Expo Go; não exige Development Build para os fluxos documentados.
- A conversão de PDF do ambiente de provas carrega PDF.js de uma CDN e precisa de internet durante a importação.
- PDFs protegidos por senha ou muito grandes podem não ser convertidos; o importador aplica limite de tamanho.

## Instalação e execução

No terminal, execute: `git pull origin main`, `npm install`, `npm test`, `npm run lint` e `npx expo start -c`. Leia o QR Code com o Expo Go no Android.

## Qualidade e integridade

A suíte `npm test` verifica a camada compartilhada de leitura, gravação e recuperação de listas com backup. O lint verifica problemas estáticos. Esses testes não substituem a validação manual no Expo Go: importação de arquivos, desenho por toque, impressão/PDF, compartilhamento e comportamento em segundo plano precisam ser exercitados em aparelhos reais.

Consulte `docs/QA_CHECKLIST.md` para o roteiro de validação antes de publicar uma versão.
