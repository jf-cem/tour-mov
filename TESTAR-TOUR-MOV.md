# Testar tour-mov 0.2

Esta cópia usa os mesmos panoramas da tour-pano e um motor experimental de movimento. A tour-pano original conserva-se. Parâmetros e precisão física ainda precisam de calibração.

## Fora de Benfica

1. Abre a tour-mov diretamente no Safari do iPhone ou Chrome do Android, ao ar livre.
2. Mantém **Quero experimentar aqui**, **GPS + passos + percurso** e **Caminhar em linha reta**. Começa no Panorama 01 e no sentido Ida.
3. Se quiseres analisar o resultado, ativa **Gravar este ensaio no aparelho para exportar**. Sem esta opção, não se guarda uma sessão exportável.
4. Toca em **Começar caminhada** e autoriza localização e movimento. Fica parado durante a preparação, pelo menos 10 segundos e cinco leituras estáveis.
5. Caminha em frente, com o telefone na mão. O primeiro trecho define o eixo GPS; a distância necessária depende da precisão indicada e pode exceder 20 m. Os passos confirmados podem prever avanço durante um trecho limitado enquanto o eixo ainda se prepara.
6. Para 5–10 segundos e olha à volta: a imagem deve manter-se. Volta a caminhar.
7. Antes de regressar pelo mesmo caminho, escolhe **Regresso** e toca em **Confirmar sentido**. O sentido GPS também é inferido quando há deslocamento informativo; a confirmação permite ensaiar regresso em trechos curtos.
8. Toca em **Terminar caminhada** e depois **Exportar sessão do ensaio**. Guarda o JSON para análise.

Experimenta o mesmo guião com **GPS + atividade** e **GPS · referência**. O replay pode comparar os métodos sobre uma única gravação com dados de movimento, sem repetir exatamente a caminhada.

Uma mensagem de confirmação ou espera indica falta de evidência suficiente. Não aumentes artificialmente a precisão. Nos trechos curtos, o motor pode conservar uma imagem ou saltar uma imagem quando a posição anterior não foi identificável.

## No local real

Seleciona **Estou no local da visita**. Se reconheces o ponto, seleciona o panorama correspondente e confirma **estou fisicamente no panorama escolhido** antes de iniciar. Sem essa confirmação, o início depende de GPS identificável. Não confirmes presença apenas por abrir o link ou escolher uma imagem.

Durante um ensaio gravado, **Marcar uma referência do ensaio** guarda o ponto selecionado pela pessoa, independentemente da posição calculada. Seleciona o ponto onde estás realmente; não copies automaticamente a imagem exibida como referência de verdade. No ensaio remoto, estas referências são virtuais, não validação física de Benfica.

## Limites deste ensaio

- Comprimento inicial do passo: 0,65 m, editável antes da caminhada. O detetor confirma cadência e pode omitir os primeiros passos ou passos lentos; gestos periódicos ainda podem causar falsos passos.
- Previsão limitada a 8 m desde o último GPS utilizável e 12 s sem GPS. A incerteza cresce com passos; um fix fraco não a apaga.
- GPS sem movimento disponível continua com comportamento conservador; panoramas separados por poucos metros podem não ser distinguíveis.
- Geometria do percurso provisória. Caminhar em linha reta não valida as curvas de Benfica.
- Sair da página termina a sessão. Reiniciar prepara uma nova origem. Olhar com o telefone é independente do sentido da marcha.
- Registo opcional em memória: até 36 000 eventos ou aproximadamente 12 MB de texto; ao atingir o limite, fica marcado como truncado. Não há upload automático.

## Verificação local

```powershell
node movement/tests/core.cjs
node movement/tests/fusion.cjs
node movement/tests/sensors.cjs
node test-walk.cjs
node movement/tests/browser.cjs
node movement/replay.cjs sessao-exportada.json resultado.json
```

O teste de browser usa Playwright e Edge temporário; ajustar `PLAYWRIGHT_MODULE` e `CHROME_PATH` noutro ambiente. Os testes automatizados simulam GPS/sensores; não comprovam precisão no telemóvel físico.
