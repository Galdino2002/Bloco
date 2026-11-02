# Bloco

Um espaço de estudos para importar materiais, escrever sobre imagens e realizar simulados.

## Ambiente de provas

- Catálogo inicial: ENEM, UECE, URCA, FUVEST, UNICAMP, UNESP e concursos.
- Modelos de etapas e duração baseados nos editais/formatos de referência; editais futuros podem alterar regras e tempos.
- Banco inicial com questões autorais de demonstração, alternativas, gabarito e explicações.
- Importação de cadernos em PDF para consulta externa durante a sessão.
- Folha digital para registrar respostas, marcar questões para revisar e navegar pelo caderno.
- Cronômetro com pausa e retomada.
- Histórico persistido localmente com SQLite.
- Área de rascunho de redação para o primeiro dia do ENEM.
- Resultados e revisão de respostas para questões do banco.

**Importante:** o banco de questões atual é pequeno e contém exemplos autorais, não é um acervo oficial de questões. O PDF selecionado é aberto no leitor do aparelho; nesta versão o Bloco não renderiza as páginas do PDF dentro do editor, não extrai automaticamente suas questões e não corrige automaticamente gabaritos de provas importadas. A redação fica salva como rascunho, sem correção automática.

## Executar no Expo Go

Requer Node.js compatível com Expo SDK 57 e Expo Go correspondente.

```bash
git pull origin main
npm install
npx expo install --fix
npx expo start -c
```

Leia o QR Code com o Expo Go no Android.

## Tecnologias

- React Native
- Expo SDK 57
- expo-image-picker
- expo-document-picker
- expo-sqlite
- react-native-svg

O projeto permanece em JavaScript e não exige Development Build para os recursos descritos.