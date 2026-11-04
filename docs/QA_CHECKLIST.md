# Checklist de qualidade do Bloco

Use este roteiro em um aparelho com Expo Go SDK 57. Faça os testes com uma cópia de segurança dos dados antes de validar operações destrutivas.

## Inicialização e dados
- [ ] Instalar dependências com `npm ci`.
- [ ] Executar `npm test` e `npm run lint`.
- [ ] Abrir o app com `npx expo start -c`.
- [ ] Criar uma nota, editar texto e desenho, sair e reabrir.
- [ ] Fechar o app pelo sistema, abrir novamente e conferir a nota.
- [ ] Simular armazenamento principal inválido em ambiente de teste e verificar recuperação pelo backup.

## Cadernos
- [ ] Criar, renomear, duplicar, favoritar, mover e excluir um caderno.
- [ ] Recuperar um item da lixeira.
- [ ] Criar pastas e subpastas e conferir filtros e movimentação.
- [ ] Importar múltiplas imagens e navegar entre páginas.
- [ ] Testar caneta, marca-texto, borracha, laço, mover, redimensionar, girar, desfazer e refazer.
- [ ] Testar zoom com um e dois dedos.
- [ ] Exportar PDF com páginas contendo imagem, texto e desenho.

## Provas
- [ ] Importar um PDF permitido com internet ativa.
- [ ] Conferir quantidade e ordem das páginas.
- [ ] Anotar em mais de uma página e navegar entre elas.
- [ ] Pausar, sair, reabrir e conferir tempo e anotações.
- [ ] Testar encerramento do cronômetro e estados da prova.
- [ ] Testar PDF inválido, protegido por senha, grande demais e cancelamento da seleção.

## Redações
- [ ] Criar redação digitada e manuscrita.
- [ ] Alterar título, editar, sair e reabrir.
- [ ] Confirmar indicador de salvamento e persistência após reiniciar o app.
- [ ] Duplicar, excluir e pesquisar redações.
- [ ] Compartilhar texto e imagem para correção.

## Backup e restauração
- [ ] Exportar backup com cadernos, provas e redações.
- [ ] Confirmar que imagens locais estão incluídas.
- [ ] Restaurar em um conjunto de dados de teste.
- [ ] Restaurar backup legado contendo apenas cadernos.
- [ ] Tentar importar JSON inválido e confirmar que os dados atuais permanecem intactos.
- [ ] Interromper a restauração em ambiente de teste e verificar o comportamento de rollback.

## UX e acessibilidade
- [ ] Conferir telas em celular pequeno e tablet.
- [ ] Conferir teclado aberto, rolagem e áreas de toque.
- [ ] Verificar contraste, textos cortados, estados vazios e mensagens de erro.
- [ ] Confirmar que ações destrutivas pedem confirmação.
- [ ] Conferir que controles têm rótulos acessíveis e estados claros.
