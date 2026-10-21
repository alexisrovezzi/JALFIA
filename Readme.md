# JALFIA

## Descargas e instrucciones

El enlace `Paquetes publicados` abre las publicaciones del workflow en GitHub. Cuando JALFIA identifica una publicacion disponible, `Descargar ZIP` descarga directamente su paquete con los metadatos del commit. Usar ese paquete para conservar la identificacion del codigo instalado y la comparacion de actualizaciones. `Instrucciones de actualizacion` abre esta seccion.

Las [publicaciones de desarrollo](https://github.com/alexisrovezzi/JALFIA/releases) incluyen un paquete `JALFIA-<version>-<commit>.zip`. Cada push a `main` ejecuta las pruebas y, si pasan, publica automaticamente una prerelease con el ZIP, el commit y las novedades. Las publicaciones de desarrollo pueden compartir el numero de version: el commit identifica la compilacion. Si todavia no aparece el paquete del commit, su publicacion puede estar en curso o haber fallado; consultá GitHub Actions. Antes de la primera ejecucion exitosa no habra un paquete preparado.

Para instalar por primera vez, descargar el ZIP adjunto a la publicacion (no el archivo automatico `Source code`), extraerlo en una carpeta permanente y cargar esa carpeta desde `chrome://extensions` > Modo desarrollador > Cargar descomprimida.

Para actualizar una instalacion existente:

1. Guardar las ediciones pendientes en las paginas abiertas.
2. Descargar el ZIP de la publicacion elegida.
3. Extraer y reemplazar los archivos dentro de la **misma carpeta** que Chrome tiene cargada. No extraer dentro de una subcarpeta. No eliminar la extension de Chrome.
4. En `chrome://extensions`, pulsar recargar en JALFIA.
5. Recargar las paginas donde se utiliza la extension.
6. Abrir Ajustes > Acerca de JALFIA y comprobar el commit instalado.

Descargar el ZIP no instala la actualizacion. La campanita consulta publicaciones al abrir el panel, como maximo una vez por hora automaticamente; `Buscar novedades` permite comprobar manualmente. No hay consultas periodicas con el panel cerrado. Solo avisa cuando existe un paquete publicado cuyo commit desciende del instalado. Un error conserva el ultimo resultado con su fecha; no significa que la instalacion este actualizada. La consulta publica a GitHub no incluye formularios, dictados ni claves de IA.

### Metadatos y empaquetado local

Requiere Node.js 24 y Git. No requiere instalar dependencias npm.

```powershell
npm run metadata
npm run package
```

`metadata` genera `src/build-info.json` con el commit local, fecha y cambios pendientes en los archivos distribuidos. Regenerarlo despues de cambiar de commit o modificar el codigo; despues recargar la extension y las paginas abiertas. El indicador de cambios locales es una fotografia del momento de generacion, no un monitor del repositorio. Sin este archivo, el panel informa `Commit no disponible`.

`package` regenera los metadatos y escribe el ZIP en `dist/`. Incluye `manifest.json`, `src/` y este documento; excluye Git, pruebas y demos. Ambos resultados estan ignorados por Git. La version se toma del manifiesto y no se incrementa automaticamente.

El workflow `.github/workflows/development-release.yml` publica con etiqueta `dev-<SHA completo>`. Reejecutar el workflow permite completar la misma publicacion sin duplicarla. Solo el trabajo de publicacion tiene permiso de escritura sobre contenidos. La primera publicacion real ocurre despues de integrar estos cambios en `main`; comprobar su resultado y el ZIP adjunto en GitHub Actions y Releases.

JALFIA es una extension de Chrome para detectar formularios web, completar campos de forma asistida e insertar dictados en un destino seleccionado. Combina inspeccion del DOM, reglas deterministicas e interpretacion opcional por IA, con revision y confirmacion antes de escribir sobre la pagina.

## Estado actual

- Mantiene memoria local de la estructura de cada pantalla y estrategias de interaccion comprobadas. No persiste valores ingresados, transcripciones, opciones ni mensajes de validacion. En Ajustes muestra un resumen compacto y un detalle desplegable por documento. Borrar memoria de esta pagina incluye la pantalla principal y sus iframes disponibles. Reanalizar mantiene el aprendizaje. La memoria vuelve a comprobarse contra el DOM actual; no reemplaza la deteccion. Se limita a 200 pantallas con antiguedad maxima de 90 dias.

- Detecta campos visibles en la pestana activa: `input`, `textarea`, `select` y elementos `contenteditable`.
- Excluye los controles de solo lectura por su propiedad `readOnly`, independientemente del nombre del campo. Conserva combos y autocompletos cuyo input es de solo lectura pero permite elegir una opcion en un desplegable.
- Infere etiquetas desde `label`, `aria-label`, `aria-labelledby`, `placeholder`, `name`, `id` y texto cercano.
- Reconoce etiquetas sin `for` en contenedores con un unico control, por ejemplo editores personalizados. Evita usar una etiqueta ambigua de un grupo de campos.
- Reconoce tipos basicos: texto, numero, fecha, combo, checkbox/radio, email, telefono, URL y texto largo.
- Reconoce fechas y horas presentadas mediante inputs de texto cuando su etiqueta y valor indican el formato. Convierte fechas `DD/MM/YYYY` a ISO para validar y las vuelve a mostrar y escribir en el formato del control. Las horas usan `HH:mm` o `HH:mm:ss` segun lo observado. Envia a la IA el formato detectado y las mascaras y restricciones declaradas; otros formatos personalizados pueden requerir adaptacion.
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
- Los cambios de voz o escritura completados y comprobados desaparecen del menu. Esto no bloquea los campos: pueden seleccionarse nuevamente para otro dictado. Al finalizar todos los cambios se limpia el texto de esa operacion.
- Ante un error de interpretacion, conserva el texto en modo escritura para corregirlo y reintentar. Muestra el progreso de interpretacion y mensajes que identifican el campo o formato que fallo.
- La cruz de la barra inferior cancela el dictado y descarta el texto, destino y propuestas pendientes. No deshace cambios ya aplicados. Durante una operacion ocupada hay que esperar a que termine para cancelar.
- Incluye `Analizar en profundidad` para recorrer los combos y autocompletos, y `Obtener opciones` / `Actualizar opciones` por campo. Abre los campos sin escribir ni seleccionar valores, espera hasta 1,5 segundos y conserva las opciones al cerrar sus menus. Permite ver la lista y usarla como sugerencias al escribir en JALFIA.
- Elimina los campos y sus opciones cuando dejan de estar disponibles. Al cambiar un campo del formulario, descarta las opciones guardadas de los otros campos porque pueden depender de ese valor. Los menus con busqueda remota o listas virtualizadas pueden mostrar solo una parte de las opciones; esta exploracion captura las opciones presentes en el DOM.
- Incluye las opciones actualmente seleccionadas de controles Vuetify aunque no aparezcan en la parte visible de la lista, y omite propuestas que mantienen la misma seleccion.
- Permite dictar hasta pulsar detener, acumulando las frases y reanudando el reconocimiento cuando el navegador termina una sesion por silencio. Ante `network`, intenta recuperar la escucha hasta tres veces conservando el texto reconocido. Detener y cancelar tienen prioridad sobre los reintentos. Si el navegador no emite el fin de escucha, hay un cierre de respaldo para evitar que el panel quede bloqueado. Los errores de permisos no se reintentan.
- El microfono principal primero permite elegir el destino con un borde azul. Elegir un campo de texto prepara un dictado para insertar en el cursor o reemplazar la seleccion, conservando el resto del texto. Elegir el fondo de un formulario limita la interpretacion por IA a sus campos. La escritura requiere revisar y confirmar; Escape cancela la seleccion. Este selector funciona en el documento principal con campos HTML y editores contenteditable. Google Docs tiene un adaptador experimental que reconoce la hoja y envia un evento de pegado a su editor interno; comprueba el texto exportado del documento antes de informar exito y evita reenviar el mismo intento si no pudo comprobarlo. No requiere enviar el documento a la IA ni persiste su contenido. La seleccion generica dentro de iframes y otros editores canvas sigue requiriendo integracion adicional.
- Completa el formulario disparando eventos `input` y `change`, lo que ayuda con formularios hechos en React, Vue o Angular.

## Instalacion local

Desde Ajustes > Configurar IA se abre una pagina propia de la extension con proveedor (local, OpenAI o compatible), URL base, API key y modelo. `Cargar modelos` consulta la lista disponible; tambien puede escribirse el identificador. `Probar conexion` envia un mensaje sintetico y comprueba una respuesta JSON, sin datos del formulario. La prueba puede consumir uso de API. Guardar conserva la configuracion.

La conexion es directa desde el proceso de fondo. Las claves se guardan en almacenamiento restringido a contextos internos de la extension. OpenAI usa `/v1/responses`; los servidores compatibles usan `<URL base>/chat/completions`. El llenado con interpretacion de IA ya esta disponible por voz o modo escritura. Para Open WebUI, la URL base normalmente termina en `/api`.

1. Abrir Chrome y entrar a `chrome://extensions`.
2. Activar `Modo desarrollador`.
3. Elegir `Cargar descomprimida`.
4. Seleccionar esta carpeta: `C:\repos\JALFIA`.
5. Abrir una pagina con un formulario y tocar el icono de JALFIA.
6. El panel flotante se abre sobre la pagina. Volver a tocar el icono lo oculta.

JALFIA no se ejecuta sobre paginas internas del navegador como `chrome://extensions`, `chrome://settings`, `edge://extensions` o `about:`. Chrome y Edge bloquean ese tipo de inyeccion por seguridad.

Despues de actualizar el codigo, recargar primero la extension y despues las paginas donde esta abierta. Si la extension se recarga mientras una pagina sigue usando el contexto anterior, JALFIA indica que hay que recargar esa pagina. La burbuja minimizada permanece clickeable y puede recargarla para recuperar la extension; guardar antes las ediciones pendientes porque esa recuperacion recarga la pagina completa.

El reconocimiento de voz depende del servicio ofrecido por el navegador. En las pruebas realizadas, funciono en Chrome, mientras el navegador integrado devolvio `network`. El modo escritura permite probar el mismo flujo sin microfono ni un servidor adicional de transcripcion.

## Prueba rapida

JALFIA detecta tambien los documentos dentro de iframes y conserva un unico panel principal. En Ajustes, `Documentos a analizar` permite elegir toda la pagina, solo el documento principal o un iframe disponible. Cada campo se identifica por frame y documento; si el iframe navega, los cambios anteriores no se aplican al documento nuevo. Los frames sin permisos o no accesibles no se incluyen. Recargar la extension y la pagina es necesario despues de actualizar el manifiesto.

La demo `demo/iframes.html` contiene un buscador principal y el formulario en un iframe para comprobar deteccion y seleccion de alcance.

Opcion simple: abrir `demo/formulario.html` en Chrome y, en la ficha de la extension dentro de `chrome://extensions`, activar `Permitir acceso a URLs de archivo`.

Opcion recomendada: servir la carpeta con un servidor local y abrir la demo por HTTP:

```powershell
python -m http.server 5173
```

Luego abrir `http://localhost:5173/demo/formulario.html`, ejecutar la extension, completar los valores detectados desde el panel y usar `Rellenar` para revisar y confirmar. Para probar la IA sin microfono, activar `Aa`, escribir una instruccion ficticia y elegir el destino.

Las pruebas automatizadas se ejecutan con Node.js:

```powershell
node --test
```

## Alcance de esta primera version

Esta base todavia no intenta "entender" semanticamente todos los formularios. La idea es construir primero un motor confiable y observable:

1. detectar los campos reales de la pagina;
2. mostrarle al usuario que se encontro;
3. permitir corregir valores antes de completar;
4. escribir en el DOM de forma compatible con frameworks modernos.

El modo voz muestra un microfono central. Al detener manualmente, obtiene las opciones faltantes e interpreta la transcripcion usando el proveedor configurado. Envia el texto ingresado, etiquetas, tipos, opciones (incluidas las selecciones actuales detectadas), formatos y reglas; no envia el contenido actual de los campos de texto libre. Muestra solo los cambios propuestos, con la frase que los justifica; las dudas requieren seleccion explicita. `Confirmar y aplicar` valida y comprueba los valores aplicados. Los campos no mencionados quedan intactos. El modo manual sigue disponible desde `Completar manualmente`. La interpretacion requiere una configuracion de IA guardada y cuota disponible.

La respuesta de la IA se valida antes de ofrecer cambios: identificadores existentes, evidencia presente en el texto original, opciones disponibles y tipos admitidos. Se normalizan espacios y saltos de linea en la evidencia, booleanos JSON para controles Si/No y numeros finitos. Estas comprobaciones no garantizan que el modelo interprete correctamente toda instruccion; la revision humana sigue siendo necesaria. La prueba completa de la nota Inamex aun no esta validada y su selector de diagnosticos requiere soporte adicional. Google Docs fue probado con insercion de dictado en Chrome; los modos adicionales de agregar y reemplazar requieren comprobacion en cada editor.
