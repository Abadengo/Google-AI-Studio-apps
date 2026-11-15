# Midas Tracker

Tracker de finanzas personales y del hogar: ingresos, gastos, ahorro, inversiones y proyecciones,
con varios perfiles (usuarios) y cuentas que se pueden ver juntos ("Todos") o por separado.
Importa movimientos desde **PDF, CSV e imágenes (JPG/PNG/WEBP)**.

## Requisitos

- [Node.js](https://nodejs.org) 20 o superior (recomendado 22 LTS).
- Una API key de Gemini (gratis en <https://aistudio.google.com/apikey>) para las funciones de IA:
  lectura de PDF escaneados/fotos, clasificación automática y el agente. Sin key, la app funciona igual
  para CSV/PDF digitales, registros manuales y proyecciones.
- Conexión a internet para **precios reales del mercado** y **tipos de cambio en vivo**.

## Cómo abrirla

1. Instala las dependencias (solo la primera vez):

   ```bash
   npm install
   ```

2. Crea un archivo `.env` (copia de `.env.example`) y pon tu key:

   ```
   GEMINI_API_KEY="tu_api_key"
   ```

3. (Recomendado) Configura la nube compartida con Firebase: ver la sección
   [Datos compartidos en la nube](#datos-compartidos-en-la-nube-firebase). Sin Firebase, la app funciona
   igual, pero los datos quedan solo en el navegador.

4. Arranca la app:

   ```bash
   npm run dev
   ```

5. Abre <http://localhost:3000> en tu navegador.

Para uso diario más rápido (versión optimizada): `npm start` (compila y arranca en modo producción).
Para cerrar la app: `Ctrl + C` en la terminal.

## Datos compartidos en la nube (Firebase)

Con Firebase configurado, los datos viven en **Firestore** y ambos ven lo mismo desde cualquier
dispositivo, en tiempo real. Se entra con **Google** y solo las cuentas de `ALLOWED_EMAILS` pueden
leer o escribir: lo garantizan las **reglas de seguridad de Firestore** (no la app). La app también
funciona sin conexión y sincroniza al volver.

### Configuración (una sola vez)

1. En <https://console.firebase.google.com> crea un proyecto.
2. **Authentication → Sign-in method → Google**: actívalo.
3. **Authentication → Settings → Authorized domains**: agrega el dominio donde publiques la app
   (por ejemplo el de Cloud Run). `localhost` ya viene incluido.
4. **Firestore Database → Create database** (modo producción).
5. **Configuración del proyecto → Tus apps → Web (`</>`)**: registra una app y copia los valores a `.env`:

   ```
   VITE_FIREBASE_API_KEY="..."
   VITE_FIREBASE_AUTH_DOMAIN="tu-proyecto.firebaseapp.com"
   VITE_FIREBASE_PROJECT_ID="tu-proyecto"
   VITE_FIREBASE_APP_ID="..."
   ALLOWED_EMAILS="correo1@gmail.com,correo2@gmail.com"
   ```

6. Publica las reglas de seguridad (genera `firestore.rules` con sus dos correos y las sube; la primera
   vez te pedirá iniciar sesión en Firebase):

   ```bash
   npm run deploy:rules
   ```

   Si prefieres hacerlo a mano: `npm run firebase:rules` y pega el contenido de `firestore.rules` en
   *Firestore → Reglas* de la consola.

7. Arranca la app, entra con Google y pulsa **"Importar estos datos a la nube"**. Hazlo en el navegador
   donde están sus datos actuales: la app los sube, verifica que llegaron todos y solo entonces abre la
   app. Los datos locales **no se borran** (quedan como copia).

### Cambiar los correos permitidos

Edita `ALLOWED_EMAILS` en `.env` (y en el servidor publicado) y vuelve a correr `npm run deploy:rules`.

### Probar las reglas

`npm run test:rules` levanta el emulador de Firebase (requiere Java), comprueba que los correos
permitidos entran y que cualquier otra cuenta, una cuenta sin verificar o un visitante sin sesión son
rechazados, y lo apaga.

### Publicar en Cloud Run

- Los valores `VITE_FIREBASE_*` se incorporan al compilar (`npm run build`), así que deben estar
  definidos en el momento de la compilación.
- En el servidor define `GEMINI_API_KEY`, `ALLOWED_EMAILS` y `VITE_FIREBASE_PROJECT_ID` (o
  `FIREBASE_PROJECT_ID`). Las funciones de IA solo responden a un usuario con sesión iniciada cuyo
  correo esté en `ALLOWED_EMAILS` (el servidor verifica el token de Google). Sin esas variables, en
  producción la IA queda desactivada.

## Dónde se guardan tus datos

- **Con Firebase**: en Firestore (`households/hogar` y su subcolección `transactions`), con caché local
  en cada dispositivo para trabajar sin conexión.
- **Sin Firebase**: solo en el navegador (localStorage). Los datos son por navegador y por dirección
  (`localhost:3000` y `127.0.0.1:3000` son lugares distintos) y se pierden si borras los datos del sitio.

## Cómo respaldar tus datos

En la app: botón **"Respaldo y Moneda"** (barra superior) o el enlace del pie de página.

- **Descargar respaldo (.json)**: copia completa (perfiles, cuentas, movimientos, presupuestos,
  fondos de ahorro, inversiones, tipos de cambio). Es el archivo que sirve para restaurar.
- **Exportar movimientos (.csv)**: para Excel / Google Sheets (no sirve para restaurar).
- **Restaurar desde .json**: reemplaza todos los datos actuales por los del archivo (pide confirmación).

La app muestra un **recordatorio** si pasaron más de 7 días desde el último respaldo `.json`
(y guarda la fecha del último). Los respaldos de versiones anteriores se pueden restaurar: se convierten
automáticamente al formato actual.

Recomendaciones:

1. Descarga un respaldo `.json` **cada vez que importes statements** o al menos una vez por semana.
2. Guárdalo en una carpeta sincronizada (Google Drive, iCloud, OneDrive) y conserva varias fechas
   (el nombre del archivo incluye la fecha).
3. Para pasar tus datos a otro computador o navegador: descarga el `.json` aquí y usa
   "Restaurar" allá.
4. Antes de "Volver a $0", "Empezar con datos en blanco" o borrar el historial del navegador, respalda.

## Cuentas, ahorro e inversiones

- Cada cuenta tiene un **tipo genérico** (transaccional, ahorro, inversión, tarjeta de crédito, efectivo, otra)
  y, si quieres, una **institución** (texto libre, solo informativo).
- **Cuentas de ahorro con interés**: en *Cuentas Bancarias* asocia un fondo a cualquier cuenta de tipo
  *Ahorro* con su tasa base y su tasa bonificada (se aplica solo si aportas cada mes).
- **Inversiones**: cada posición puede asociarse a una cuenta de tipo *Inversión*.
- Al importar, la app indica el **formato de archivo detectado** (por ejemplo, el de tu banco o broker)
  y tú eliges o creas la cuenta destino.

## Estructura de datos y migraciones

En modo local, los datos se guardan en `localStorage` con la clave `finanzas_hogar_abdiel_lara_v1` (no se cambia nunca); en la nube, en Firestore.
El estado lleva un campo `version`; cuando la estructura cambia, `src/data/migrations.ts` convierte los
datos viejos al cargarlos (desde localStorage, desde Firestore o al restaurar un respaldo). Antes de migrar se guarda una copia intacta
en `finanzas_hogar_abdiel_lara_v1_pre_v2_backup`.

## Proyecciones y datos de mercado

- **Inversiones → "Precios reales del mercado"**: actualiza precio actual, rendimiento por dividendo
  (últimos 12 meses) y calcula el crecimiento histórico del precio (hasta 10 años) de tus posiciones,
  que se usa como supuesto en las proyecciones. Fuente: Yahoo Finance. Acciones/ETF de la ASX se
  buscan con sufijo `.AX` cuando la posición está en AUD (p. ej. `VAS` → `VAS.AX`).
- **Cuentas Bancarias**: proyección de cada fondo de ahorro con su tasa base + bonificada
  (la bonificada solo se aplica si ese fondo recibe aportes cada mes).
- **Respaldo y Moneda → "Actualizar con tipos de cambio reales"**: tipos de cambio en vivo.

Las proyecciones usan rendimientos pasados como referencia; no garantizan resultados futuros.
