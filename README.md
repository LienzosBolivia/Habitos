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

**Hoy** muestra primero las tareas y después las herramientas de enfoque y de clases. Conserva el tren, las monedas, la ruleta y los controles de sesión.

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
