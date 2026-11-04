# Segurança de dependências

Última verificação automatizada: 4 de novembro de 2026.

## Resultado

O `npm audit` identificou 27 avisos no grafo completo de dependências:

- 2 de severidade alta;
- 23 de severidade moderada;
- 2 de severidade baixa.

Os dois avisos altos aparecem em dependências transitivas associadas ao Expo SDK 57: `@expo/cli` e `zod`. Há também avisos moderados em dependências do Expo e das ferramentas de lint.

## Decisão de compatibilidade

Foi executado `npm audit fix` sem a opção `--force`. A árvore continuou com os mesmos 27 avisos. O ajuste compatível atualizou/reorganizou dependências do lockfile, mas não resolveu os avisos altos.

O npm sugere alterações que podem exigir downgrade do Expo para SDK 51 ou atualização de módulos para SDK 58. Essas mudanças não foram aplicadas porque quebrariam a compatibilidade atual do projeto com Expo SDK 57 e poderiam impedir a execução no Expo Go usado no desenvolvimento.

**Não foi aplicado override forçado de Zod 4 nem downgrade de SDK.** A troca de uma dependência de esquema usada pelo Expo CLI sem garantia de compatibilidade pode quebrar comandos de desenvolvimento, importação de configuração ou builds.

## Medidas atuais

- O lockfile está versionado e é instalado com `npm ci`.
- O CI reporta os avisos de dependências em cada execução.
- O CI valida versões Expo, testes, lint e exportação do bundle Android.
- Não foi usada a opção `npm audit fix --force`.

## Próxima ação de segurança

Reavaliar os avisos quando houver uma versão corrigida oficialmente compatível com Expo SDK 57 ou quando o projeto puder migrar de forma planejada para uma versão do Expo Go correspondente ao SDK mais recente. Até lá, não declarar a árvore de dependências livre de vulnerabilidades.
