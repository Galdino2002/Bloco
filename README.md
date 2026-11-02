# Bloco

Um espaço simples para importar provas e atividades como imagem e escrever diretamente sobre elas.

## Protótipo atual

- Tela inicial com identidade visual do Bloco.
- Importação de imagens pela galeria do Android.
- Editor com desenho livre sobre a imagem original.
- Caneta com 5 cores e 3 espessuras.
- Borracha para remover traços próximos ao toque.
- Desfazer e refazer traços.
- Salvar e reabrir documentos enquanto o aplicativo permanece aberto.

> Nesta primeira versão, os documentos ficam apenas na memória da sessão. O salvamento permanente no aparelho e a exportação da imagem anotada serão etapas seguintes, depois de validar a experiência de desenho no Expo Go.

## Executar no Expo Go

Requer Node.js compatível com Expo SDK 57 e o aplicativo Expo Go correspondente.

```bash
npm install
npx expo start
```

Leia o QR Code com o Expo Go no Android.

## Tecnologias

- React Native
- Expo SDK 57
- expo-image-picker
- react-native-svg

O projeto permanece em JavaScript e não exige Development Build para este protótipo.
