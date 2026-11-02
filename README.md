# Bloco

Caderno digital para estudar diretamente sobre as páginas de uma prova.

## Fluxo atual

1. Converta cada página do PDF da prova em uma imagem PNG ou JPG fora do aplicativo.
2. No Bloco, toque em Importar páginas e selecione todas as imagens da prova de uma vez.
3. As imagens são organizadas como páginas de um único caderno.
4. Navegue entre as páginas e desenhe diretamente sobre cada uma.
5. Use caneta, marca-texto, borracha, desfazer, refazer e zoom.
6. Toque em Salvar para guardar o caderno na sessão atual do aplicativo.

As anotações são separadas por página. O Bloco permanece em JavaScript e foi mantido no Expo Go, sem Development Build.

## Limitação desta etapa

A conversão de PDF para PNG ainda é feita fora do Bloco. A lista de cadernos e as anotações permanecem em memória nesta primeira etapa; fechar o aplicativo pode apagar esses dados. A próxima etapa será implementar a persistência dos cadernos e das páginas.

## Executar no Expo Go

- git pull origin main
- npm install
- npx expo install --fix
- npx expo start -c

Leia o QR Code com o Expo Go no Android.

## Tecnologias

- React Native
- Expo SDK 57
- expo-image-picker
- react-native-svg
