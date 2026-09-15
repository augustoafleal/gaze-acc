# Diagnóstico de inicialização entre dispositivos

## Por que o comportamento parecia aleatório

O fluxo anterior juntava eventos independentes em uma única mensagem de
"iniciando câmera":

1. abria a câmera apenas para testar a permissão;
2. fechava imediatamente esse primeiro stream;
3. criava um worker do WebEyeTrack;
4. o worker baixava WASM do jsDelivr, Face Landmarker do Google Storage e o
   modelo BlazeGaze da própria aplicação;
5. inicializava obrigatoriamente o delegate GPU/WebGL;
6. somente depois disso pedia para abrir a câmera uma segunda vez.

Assim, o Android podia mostrar a câmera como autorizada enquanto nenhum stream
estava ativo. Falha de rede, bloqueio de CDN, pouca memória, falha do WebGL ou
erro interno do worker produziam o mesmo timeout genérico de 30 segundos. O
worker do pacote não encaminhava o motivo do erro à UI.

Além disso, a interface de piscadas executava a estimativa completa de gaze com
TensorFlow/BlazeGaze em todos os frames de olhos abertos, embora consumisse
somente `open`/`closed`. Isso elevava download, parsing, memória e uso de GPU sem
benefício para essa tela. O JavaScript inicial de produção tinha cerca de 2.9
MB antes de gzip.

## Correção aplicada

- um único pedido e um único stream de câmera;
- confirmação por um frame real, não apenas pela permissão;
- detector de piscadas dedicado, sem TensorFlow/BlazeGaze;
- Face Landmarker em worker clássico, com CPU/WASM em vez de GPU/WebGL
  obrigatório; o formato clássico permite que o bootstrap WASM do MediaPipe
  use `importScripts()`;
- WASM da versão npm fixada servido pela própria aplicação;
- rota legada carregada sob demanda, reduzindo o JavaScript inicial padrão para
  cerca de 220 KB antes de gzip;
- progresso e erro separados para navegador, permissão, câmera, modelo e
  detector;
- timeouts específicos e mensagens diferentes para permissão negada, câmera
  ocupada, ausência de frames, falha de download e falha de execução.

## Limite restante e solução de produção

O modelo oficial Face Landmarker de aproximadamente 3.6 MB ainda vem do Google
Storage. A UI agora mostra se esse download terminou ou falhou. Para eliminar a
última dependência externa, hospede o arquivo
`face_landmarker/float16/1/face_landmarker.task` na mesma origem e compile com:

```bash
VITE_FACE_LANDMARKER_MODEL_URL=/gaze-acc/mediapipe/face_landmarker.task npm run build
```

Esse arquivo deve ser versionado e servido com cache de longo prazo. Depois
disso, a primeira visita ainda baixa modelo e um dos runtimes WASM, mas nenhuma
CDN externa participa da inicialização.

## Leitura da nova tela

- **Permissão pronta + Câmera com erro:** a autorização existe, mas o Android ou
  navegador não entregou frames; normalmente câmera ocupada, sessão encerrada
  pelo sistema ou falha do dispositivo.
- **Câmera pronta + Modelo com erro:** a câmera não é o problema; é rede,
  bloqueio do Google Storage ou arquivo ausente.
- **Modelo pronto + Detector com erro:** o download terminou, mas o aparelho não
  conseguiu instanciar/executar o runtime; memória e compatibilidade do browser
  são os suspeitos principais.
- **Tudo pronto + aguardando rosto:** câmera e IA funcionam; o problema é
  detecção (luz, enquadramento, distância, reflexo ou rosto fora do quadro).
