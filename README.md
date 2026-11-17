# Bitácora de Hábitos

Aplicación en español para hábitos, rutinas, tareas, proyectos, sesiones de enfoque, recompensas y evidencias. Se sirve como sitio estático y se puede instalar como PWA.

## Protección de datos

- Los datos y las evidencias se guardan en IndexedDB. Un error de lectura no reinicia ni sobrescribe la bitácora.
- Antes de restaurar o reiniciar se conserva una copia recuperable completa. Se mantienen las últimas tres en este dispositivo, descargables desde **Estadísticas → Copia de seguridad → Ver copias recuperables**. Estas copias también dependen del almacenamiento del navegador: descarga un JSON para conservarlo fuera del dispositivo.
- Las restauraciones validan el formato y cambian datos y fotos en una sola transacción. Si la transacción falla, se conservan los datos anteriores.
- Si Drive y este dispositivo tienen versiones diferentes, se conservan los cambios locales y se pide elegir. Al elegir la copia local para Drive, se guardan ambas versiones como puntos de recuperación antes de subir. No hay fusión automática de registros.
- Una subida no da por sincronizados cambios realizados mientras estaba en curso. Los errores de Drive no se interpretan como ausencia de un respaldo.
- Las nuevas exportaciones excluyen claves de API y tokens. La clave de Groq se conserva en `sessionStorage` durante la sesión de la pestaña. Los respaldos antiguos ya existentes pueden conservar credenciales antiguas.

## Pantallas y planificación

**Hoy** muestra primero la locomotora y la sesión de enfoque; después, las tareas y las herramientas de clases. Conserva el tren, las monedas, la ruleta y los controles de sesión.

**Estadísticas** incluye períodos de 7, 30 y 90 días, comparación con el período anterior, tiempo ejecutando tareas, días con actividad, tareas completadas y progreso de proyectos. El tiempo de subtareas ya está incluido en su tarea; no se suma dos veces. Las rutinas nuevas guardan su fecha de creación; las antiguas mantienen el historial disponible.

La **IA** presenta una propuesta editable: permite elegir tareas, modificar subtareas, descartar el plan y evitar nombres duplicados antes de guardar. Los servicios externos requieren sus conexiones y permisos habituales.

## Desarrollo y pruebas

El código de la aplicación permanece en `index.html`; no requiere compilación ni dependencias para utilizarla. Las dependencias siguientes son solo para pruebas (Node.js 24):

```sh
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

Las pruebas de datos usan JSDOM e IndexedDB simulado para verificar errores de escritura, restauración atómica, copias recuperables, conflictos de Drive, estadísticas y revisión de planes de IA. Las pruebas de navegador usan Chromium, una pantalla móvil y datos sintéticos; no utilizan cuentas personales ni claves reales de los servicios externos.

Para utilizar un Chromium ya instalado, establece `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` con la ruta de su ejecutable. El flujo de GitHub Actions ejecuta ambas suites en un entorno de pruebas.

## RPG 3.0

Los hábitos diarios pagan una bonificación por día cumplido, una sola vez por fecha: días 1–7, 0,5; 8–21, 1; 22–45, 1,5; 46–90, 2,5 monedas. La suma exacta es **166 monedas** en un ciclo perfecto de 90 días (3,5 + 14 + 36 + 112,5). Es una bonificación adicional a las monedas por tiempo validado y proyectos. Al completar el ciclo el hábito queda Forjado y deja de pagar, incluso si luego pierde su racha. Los hábitos antiguos ya forjados no reciben pagos retroactivos.

El XP se acredita con el tiempo validado por evidencia, conservando fracciones sin redondear cada minuto parcial. El nivel usa el umbral `round(300 × (nivel − 1)^1.5)`. El multiplicador ×2 se desbloquea en nivel 5 y el descanso con monedas reduce su espera de 10 a 8 minutos en nivel 10. Se requiere una moneda completa para comprar un descanso.

El inventario añade tickets de re-giro (3 monedas, nivel 3), condensadores (5 monedas, nivel 3) y escudos de racha (5 monedas, nivel 5). Los escudos protegen una racha existente si ayer no se cumplió el hábito, sin inventar un cumplimiento ni generar un pago. Los condensadores actualizan también el límite guardado de la tarea o subtarea, para que el descuento sobreviva a una pausa o recarga. La tienda anterior de permisos sigue disponible desde el inventario.

Desactivar el arranque automático deja pendiente una auditoría para la siguiente reconexión. El usuario distingue un fallo de disciplina de mantenimiento: solo al confirmar disciplina se vacía el saldo, se baja un nivel (mínimo 1) y se recibe 50% XP durante 48 horas. Cerrar o recargar el navegador, por sí solo, no prueba un fallo de disciplina.

## Packs de bienvenida

El botón **🎁** de la barra superior abre los bonos de bienvenida, con siete packs únicos: **5, 5, 6, 6, 7, 7 y 9 monedas** (45 en total). Los días 2 y 6 incluyen un ticket de re-giro; el día 1, un duplicador; el día 7, un escudo. Los ítems se agregan al inventario y pueden usarse sin alcanzar todavía el nivel de compra.

El programa empieza cuando el usuario abre por primera vez esta versión, incluso para cuentas existentes. El primer pack está disponible de inmediato para reclamarlo; los siguientes se desbloquean por fecha, en orden, con un máximo de un reclamo por día. Se usa el reloj de la aplicación. Los packs pendientes no vencen si se falta un día, pero no se pueden cobrar juntos al volver.

El saldo, el inventario y el recibo del reclamo se guardan juntos antes de mostrar el premio. El progreso de bienvenida está incluido en los respaldos de la bitácora. Esta es una aplicación personal con datos locales y sincronización por respaldo: no es un sistema de premios validado por un servidor.

## Tienda e inventario

La pestaña inferior **Tienda** reúne seis objetos y una sección **Inventario**. Los pases de scroll y juego cuestan 6 monedas; el social, 10. Todos duran 10 minutos y se acumulan al comprarlos, incluso sin sesión activa. En Inventario, **Usar** consume una unidad e inicia el tiempo libre sin volver a cobrar; se necesita sesión activa y no tener otro permiso en curso. Los tres detienen el sistema.

El **Duplicador ×2** reemplaza al condensador (5 monedas, nivel 3). Las unidades antiguas se convierten una por una. Al usarlo, duplica los pagos de trabajo acreditados durante 30 minutos (tiempo, finalización, hábitos y proyectos); no modifica tareas, XP ni packs. No consume otra unidad si hay uno activo.

## Locomotora durante el tiempo libre

Al usar una moneda de 3 minutos o un pase de scroll/juego, la ejecución se apaga temporalmente: locomotora y humo detenidos, sonido apagado y sin sumar tiempo de tareas o de pensando. El panel muestra el tiempo libre restante. La sesión conserva su fecha de fin y el cooldown vigente; al finalizar el permiso se retoma el estado de espera únicamente si la sesión sigue activa. Un permiso guardado se respeta después de recargar la aplicación.

## Moneda extra por completar trabajo con evidencia

Completar una tarea sin subtareas y con una nota o foto de evidencia otorga **1 moneda adicional**, independientemente de las monedas acumuladas por tiempo. Si tiene subtareas, cada subtarea efectivamente completada otorga **1 moneda**, validada con la evidencia de su tarea principal; en ese caso no se agrega otra moneda al cerrar la principal. Si se completan primero las subtareas y se guarda después la evidencia, se acreditan las pendientes al guardar o editar esa evidencia.

El bono aplica a tareas puntuales, tareas de proyectos y hábitos/rutinas. En hábitos y rutinas se registra una vez por tarea o subtarea y por fecha; en tareas puntuales y de proyectos, una sola vez por identificador aunque se cambien de fecha. Los permisos comprados no generan este bono. Desmarcar, volver a marcar, editar la evidencia o recargar no repite los pagos. Una tarea ya premiada como principal no vuelve a pagar al añadir subtareas; una premiada por subtareas no paga después como principal al borrarlas.

Los recibos se conservan en `coins.completionRewards`, junto con el saldo en los respaldos. No hay un barrido automático de registros antiguos: se comprueba el bono al completar trabajo, marcar subtareas o guardar/editar la evidencia. El XP y las reglas de monedas por tiempo conservan su cálculo anterior.


## Alarmas y galería

En Hoy, toca **Activar y probar alarma**, acepta las notificaciones y comprueba el volumen multimedia. El sonido usa tonos independientes del MP3 y del silencio del tren. Programa tonos con Web Audio, comprueba plazos de tiempo libre, sesión y tarea, y recupera avisos vencidos al regresar. Las notificaciones requieren permiso y Service Worker. Una web estática no puede garantizar alarmas puntuales si Android suspende su proceso o el usuario cierra la aplicación; no se usan temporizadores del Service Worker como falsa garantía.

Galería muestra monedas recibidas junto a las tareas y subtareas, y una vista **Monedas** con ingresos, compras, descuentos y usos. Cada compra descuenta una vez; activar un ítem registra uso sin cobrar otra vez. El saldo previo se conserva como saldo inicial; no se reconstruyen importes históricos sin recibos. Los pagos por cada bloque acumulado de 30 minutos se atribuyen a la tarea cuya acreditación completa ese bloque. Los movimientos se conservan en los respaldos y se validan al importar.

Al tocar una evidencia, el visor permite **Editar / añadir información**. Conserva foto, fecha original y metadatos al modificar la nota; la edición no repite recompensas ya acreditadas.

## Archivo de enlaces en Galería

**Galería → Archivo** guarda enlaces de Google Drive con nombre obligatorio y fecha elegida por el usuario. La búsqueda por nombre ignora tildes y mayúsculas; el filtro de mes usa esa fecha. Las fichas se ordenan por fecha descendente y permiten editar nombre, fecha o enlace, quitar el registro local y abrir el original en Drive. Quitar un enlace no elimina el archivo de Google Drive.

Las fichas muestran una vista previa embebida con carga diferida; al tocar **Ver** se abre el visor dentro de la página. Al cerrar se descarga el iframe del visor. Se muestran inicialmente 12 fichas y se pueden cargar más, mientras la búsqueda recorre todos los registros. Los formatos compatibles, los permisos de Drive, la sesión de Google y la conectividad determinan si Google puede mostrar una vista previa; siempre hay un enlace **Abrir en Drive** como alternativa. Se usan visores de Google, sin copiar archivos, hacerlos públicos ni intentar extraerlos a un canvas entre dominios.

Acepta enlaces HTTPS de archivos y carpetas de `drive.google.com`, incluidos `file/d`, `open?id` y `uc?id`, y documentos de `docs.google.com`. Conserva `resourcekey` cuando es necesario para el acceso. Rechaza otros dominios, enlaces incompletos y protocolos de contenido activo. Los registros se guardan en `state.archiveLinks` y viajan en los respaldos y la sincronización existentes. Los respaldos anteriores sin Archivo siguen siendo válidos.


## Préstamos de monedas

En el regalo superior, **Bonificaciones → Préstamo** permite solicitar de 1 a 100 monedas enteras, sin requisitos de nivel ni relación con los packs de bienvenida. Solo se admite una deuda activa. Se recibe el capital completo y se devuelve el capital más un **interés único del 10%** (25 → 27,5; 100 → 110). La cotización muestra las cifras antes de aceptar. No hay vencimiento, cobro automático ni interés diario.

La liquidación es manual y requiere conservar al menos **1 moneda de reserva** después del pago. Tras pagar se puede pedir otro préstamo. Los duplicadores no multiplican los préstamos y los préstamos no generan XP. Tanto la entrega como el pago se registran en Galería → Monedas. El estado activo y los recibos pagados se conservan en `coins.loans` y en los respaldos, que validan capital, tasa, interés, total e identificadores.

Cada operación guarda saldo, deuda y movimiento juntos en una transacción local; se bloquean solicitudes simultáneas y se comprueba que otra pestaña no haya cambiado los datos. Si la escritura falla, el estado anterior permanece intacto. La sincronización conserva el manejo existente de conflictos entre dispositivos.


El duplicador de bienvenida se entrega el día 1 para nuevas semanas. Las semanas ya iniciadas con el calendario anterior conservan su duplicador del día 4, sin duplicar ni perder el premio. El precio actual del escudo es 5 monedas; conserva el requisito de nivel 5.

## Modo de seguimiento diario

El habitáculo de Hoy incluye **Seguimiento de hoy**, debajo de la locomotora, con un interruptor propio. Al activarlo incluye las tareas principales de hoy (hábitos, rutinas, tareas puntuales y tareas del proyecto seleccionado) y añade automáticamente las nuevas tareas de ese día. **Elegir tareas y añadir subtareas** permite excluir principales o incluir subtareas explícitamente. Los permisos comprados no entran como trabajo a cumplir. La lista es independiente de las tareas originales: excluir no borra la tarea.

Cada compromiso admite una hora de hoy y una duración opcional de 1 a 1440 minutos. En blanco significa ejecución sin límite, incluso si antes tenía un límite guardado. La propuesta de hora es aleatoria dentro de lo que queda del día (priorizando 06:00–22:30), editable antes de aceptar. Si faltan horarios se vuelve a preguntar al regresar a la app y cada cinco minutos de uso; **Decidir después** evita que el diálogo vuelva a abrirse cada segundo.

A los 30 minutos se pide confirmar o cambiar la hora; a los 15, 10, 5, 3, 2 y 1 minutos se notifica la ejecución. Los recibos de avisos se guardan para evitar repeticiones; si la app estuvo suspendida solo se muestra el umbral actual, sin una ráfaga de avisos vencidos. Se necesita activar/probar la alarma y permitir notificaciones. Como en las alarmas existentes, Android puede suspender una web: no hay garantía de puntualidad con el proceso congelado o cerrado.

Al llegar la hora, comienza cuando hay una sesión activa, no hay descanso pagado y no está corriendo otra tarea. Si coinciden varias, esperan en cola; las vencidas empiezan **al volver a ejecutar**, sin inventar tiempo trabajado durante la ausencia. Una pausa no provoca reinicios continuos; guardar una nueva hora permite programar otra ejecución. La duración finita pausa el trabajo al agotarse, sin marcar cumplimiento ni fabricar evidencia. Las reglas de evidencia y recompensas siguen iguales. Mientras el seguimiento está activo sustituye el auto-inicio antiguo por recordatorios para evitar dos planificadores compitiendo.

El cierre se hace a **medianoche local**, o al regresar si la aplicación estaba cerrada. Cada tarea principal con un compromiso realmente iniciado y todavía sin completar genera **5 monedas de penalización una sola vez por día**; incluir padre y varias subtareas no multiplica la multa. Una subtarea elegida por separado puede cumplir su compromiso sin completar el padre no seleccionado. Los compromisos nunca iniciados no se multan. Desactivar el modo o excluir un compromiso después de iniciarlo pausa los avisos, pero conserva la obligación de ese día.

Saldo, recibo de cierre y descuento se guardan en el mismo estado persistido. Si el saldo no alcanza, queda `coins.followPenaltyDue`: se descuenta de posteriores créditos, incluidos premios y préstamos, y se anota por separado en Galería → Monedas. El saldo no se vuelve negativo ni el multiplicador aumenta las penalizaciones. La lista, sus horarios, avisos, recibos y deuda pendiente se incluyen y validan en los respaldos; los respaldos antiguos siguen siendo válidos.
