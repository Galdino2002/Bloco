# Bloco

Caderno digital para estudar e resolver provas diretamente nas páginas.

## Cadernos comuns

1. Toque em **Importar páginas** e selecione imagens PNG ou JPG.
2. As imagens são organizadas como páginas de um caderno.
3. Navegue entre as páginas e use caneta, marca-texto, borracha, desfazer, refazer e zoom.
4. Toque em **Salvar** para guardar o caderno durante a sessão atual.

## Ambiente de provas

1. Na tela inicial, toque em **Ambiente de provas**.
2. Escolha URCA, UECE ou um dos dias do ENEM.
3. Confira o tempo padrão da prova.
4. Selecione o PDF no aparelho.
5. O aplicativo converte as páginas do PDF em imagens JPEG locais.
6. Resolva desenhando diretamente sobre as páginas. O cronômetro fica visível no editor.
7. Toque em **Salvar e sair** para guardar as anotações e o tempo restante. As provas salvas aparecem na lista para continuar depois.

### Tempos configurados

- URCA: 4 horas.
- UECE: 4 horas por prova/fase.
- ENEM – 1º dia: 5 horas e 30 minutos.
- ENEM – 2º dia: 5 horas.

### Observações técnicas

- O fluxo foi desenvolvido para Expo SDK 57 e bibliotecas compatíveis com Expo Go; não requer Development Build.
- A conversão usa PDF.js carregado de CDN. É necessário estar conectado à internet durante a conversão do PDF. As páginas convertidas e os dados das provas são armazenados localmente no aparelho.
- Para evitar uso excessivo de memória, o importador limita o PDF a 45 MB. PDFs protegidos por senha podem não ser convertidos.
- As provas do Ambiente de provas têm salvamento automático periódico e salvamento ao sair. Os cadernos comuns ainda permanecem em memória nesta etapa.

## Instalar e executar

Depois de atualizar a branch:

```powershell
git pull origin main
npm install
npx expo start -c
```

Leia o QR Code com o Expo Go no Android.

## Tecnologias

- React Native
- Expo SDK 57
- expo-image-picker
- expo-document-picker
- expo-file-system
- @react-native-async-storage/async-storage
- react-native-webview
- react-native-svg
- PDF.js
