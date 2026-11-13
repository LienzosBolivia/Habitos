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

El inventario añade tickets de re-giro (3 monedas, nivel 3), condensadores (5 monedas, nivel 3) y escudos de racha (20 monedas, nivel 5). Los escudos protegen una racha existente si ayer no se cumplió el hábito, sin inventar un cumplimiento ni generar un pago. Los condensadores actualizan también el límite guardado de la tarea o subtarea, para que el descuento sobreviva a una pausa o recarga. La tienda anterior de permisos sigue disponible desde el inventario.

Desactivar el arranque automático deja pendiente una auditoría para la siguiente reconexión. El usuario distingue un fallo de disciplina de mantenimiento: solo al confirmar disciplina se vacía el saldo, se baja un nivel (mínimo 1) y se recibe 50% XP durante 48 horas. Cerrar o recargar el navegador, por sí solo, no prueba un fallo de disciplina.
