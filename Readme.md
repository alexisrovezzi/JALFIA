# JALFIA

JALFIA es una extension de Chrome para detectar formularios web y completar campos de forma asistida. Esta primera version evita IA deliberadamente: prioriza reglas deterministicas, inspeccion del DOM y confirmacion humana antes de escribir sobre la pagina.

## Estado actual

- Mantiene memoria local de la estructura de cada pantalla y estrategias de interaccion comprobadas. No persiste valores ingresados, transcripciones, opciones ni mensajes de validacion. En Ajustes muestra un resumen compacto y un detalle desplegable por documento. Borrar memoria de esta pagina incluye la pantalla principal y sus iframes disponibles. Reanalizar mantiene el aprendizaje. La memoria vuelve a comprobarse contra el DOM actual; no reemplaza la deteccion. Se limita a 200 pantallas con antiguedad maxima de 90 dias.

- Detecta campos visibles en la pestana activa: `input`, `textarea`, `select` y elementos `contenteditable`.
- Infere etiquetas desde `label`, `aria-label`, `aria-labelledby`, `placeholder`, `name`, `id` y texto cercano.
- Reconoce tipos basicos: texto, numero, fecha, combo, checkbox/radio, email, telefono, URL y texto largo.
- Reconoce tambien controles ARIA `switch`, `checkbox` y `radio`, y checkboxes ocultos en controles visibles de Vuetify. Las casillas e interruptores se muestran como Si/No; al completar se hace clic solo si el estado necesita cambiar y se comprueba el resultado.
- El boton `Elegir el formulario o sector a analizar` permite resaltar y seleccionar un contenedor de campos para limitar el escaneo. Escape cancela la seleccion; el boton de restablecer vuelve al alcance automatico. Los menus asociados pueden seguir estando fuera del sector elegido.
- El selector elige el control al hacer clic sobre el y el formulario completo al hacer clic en su fondo y muestra un borde azul con glow pulsante (sin animacion si se prefiere movimiento reducido). Mantener apretado y arrastrar permite delimitar un area: se incluyen los campos visibles que se superponen al recuadro. Para voz, un solo campo editable se usa como destino de dictado; varios campos se interpretan como un formulario limitado a esa seleccion. La misma seleccion por area esta disponible desde el boton de sector, sin iniciar el microfono.
- Muestra un panel flotante dentro de la pagina, con bordes redondeados, sombras suaves y un encabezado visual de producto.
- Permite arrastrar el panel, cambiar su tamano desde la esquina inferior derecha y configurar su opacidad.
- Incluye una vista de Ajustes desde la esquina superior derecha para configurar la opacidad y activar o desactivar el modo oscuro. Estas preferencias se guardan en la extension para futuras sesiones.
- Permite editar manualmente los valores detectados campo por campo.
- El boton Aa activa el modo escritura para escribir o pegar un dictado sin microfono. Elegir destino y continuar usa el mismo selector y el mismo flujo de interpretacion, revision y confirmacion que la voz. Para campos de texto prepara una insercion directa; para formularios consulta la IA configurada. El texto permanece solo en el panel durante la sesion y se limpia cuando todos sus cambios se aplican.
- Al revisar un dictado dirigido a texto se puede elegir insertar en el cursor (por defecto), agregar al final o reemplazar todo el contenido del destino. Reemplazar requiere una confirmacion explicita. La eleccion se reinicia en cada nuevo dictado y no afecta al llenado de formularios.
- Rellenar incluye solo los campos editados en JALFIA y los marcados para vaciar. Visitar un campo no lo marca para reemplazar. Los cambios aplicados correctamente dejan de estar pendientes; los que fallan se conservan para reintentar.
- Incluye `Analizar en profundidad` para recorrer los combos y autocompletos, y `Obtener opciones` / `Actualizar opciones` por campo. Abre los campos sin escribir ni seleccionar valores, espera hasta 1,5 segundos y conserva las opciones al cerrar sus menus. Permite ver la lista y usarla como sugerencias al escribir en JALFIA.
- Elimina los campos y sus opciones cuando dejan de estar disponibles. Al cambiar un campo del formulario, descarta las opciones guardadas de los otros campos porque pueden depender de ese valor. Los menus con busqueda remota o listas virtualizadas pueden mostrar solo una parte de las opciones; esta exploracion captura las opciones presentes en el DOM.
- Permite dictar un campo hasta pulsar detener, acumulando las frases y reanudando el reconocimiento cuando el navegador termina una sesion por silencio. Cerrar el panel tambien detiene el dictado. Los errores de permisos o del servicio interrumpen la escucha.
- El microfono principal primero permite elegir el destino con un borde azul. Elegir un campo de texto prepara un dictado para insertar en el cursor o reemplazar la seleccion, conservando el resto del texto. Elegir el fondo de un formulario limita la interpretacion por IA a sus campos. La escritura requiere revisar y confirmar; Escape cancela la seleccion. Este selector funciona en el documento principal con campos HTML y editores contenteditable. Google Docs tiene un adaptador experimental que reconoce la hoja y envia un evento de pegado a su editor interno; comprueba el texto exportado del documento antes de informar exito y evita reenviar el mismo intento si no pudo comprobarlo. No requiere enviar el documento a la IA ni persiste su contenido. La seleccion generica dentro de iframes y otros editores canvas sigue requiriendo integracion adicional.
- Completa el formulario disparando eventos `input` y `change`, lo que ayuda con formularios hechos en React, Vue o Angular.

## Instalacion local

Desde Ajustes > Configurar IA se abre una pagina propia de la extension con proveedor (local, OpenAI o compatible), URL base, API key y modelo. `Cargar modelos` consulta la lista disponible; tambien puede escribirse el identificador. `Probar conexion` envia un mensaje sintetico y comprueba una respuesta JSON, sin datos del formulario. La prueba puede consumir uso de API. Guardar conserva la configuracion.

La conexion es directa desde el proceso de fondo. Las claves se guardan en almacenamiento restringido a contextos internos de la extension. OpenAI usa `/v1/responses`; los servidores compatibles usan `<URL base>/chat/completions`. El llenado por voz con interpretacion de IA sera una etapa posterior.

1. Abrir Chrome y entrar a `chrome://extensions`.
2. Activar `Modo desarrollador`.
3. Elegir `Cargar descomprimida`.
4. Seleccionar esta carpeta: `C:\repos\JALFIA`.
5. Abrir una pagina con un formulario y tocar el icono de JALFIA.
6. El panel flotante se abre sobre la pagina. Volver a tocar el icono lo oculta.

JALFIA no se ejecuta sobre paginas internas del navegador como `chrome://extensions`, `chrome://settings`, `edge://extensions` o `about:`. Chrome y Edge bloquean ese tipo de inyeccion por seguridad.

## Prueba rapida

JALFIA detecta tambien los documentos dentro de iframes y conserva un unico panel principal. En Ajustes, `Documentos a analizar` permite elegir toda la pagina, solo el documento principal o un iframe disponible. Cada campo se identifica por frame y documento; si el iframe navega, los cambios anteriores no se aplican al documento nuevo. Los frames sin permisos o no accesibles no se incluyen. Recargar la extension y la pagina es necesario despues de actualizar el manifiesto.

La demo `demo/iframes.html` contiene un buscador principal y el formulario en un iframe para comprobar deteccion y seleccion de alcance.

Opcion simple: abrir `demo/formulario.html` en Chrome y, en la ficha de la extension dentro de `chrome://extensions`, activar `Permitir acceso a URLs de archivo`.

Opcion recomendada: servir la carpeta con un servidor local y abrir la demo por HTTP:

```powershell
python -m http.server 5173
```

Luego abrir `http://localhost:5173/demo/formulario.html`, ejecutar la extension, completar los valores detectados desde el panel y presionar `Completar formulario`.

## Alcance de esta primera version

Esta base todavia no intenta "entender" semanticamente todos los formularios. La idea es construir primero un motor confiable y observable:

1. detectar los campos reales de la pagina;
2. mostrarle al usuario que se encontro;
3. permitir corregir valores antes de completar;
4. escribir en el DOM de forma compatible con frameworks modernos.

El modo voz muestra un microfono central. Al detener manualmente, obtiene las opciones faltantes e interpreta la transcripcion usando el proveedor configurado. Envia etiquetas, tipos, opciones y reglas, sin valores actuales del formulario. Muestra solo los cambios propuestos, con la frase que los justifica; las dudas requieren seleccion explicita. `Aplicar seleccionados` valida y comprueba los valores aplicados. Los campos no mencionados quedan intactos. El modo manual sigue disponible desde `Completar manualmente`; su microfono superior permite volver al modo voz. La interpretacion requiere una configuracion de IA guardada y cuota disponible.
