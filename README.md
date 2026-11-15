# Midas Tracker

Finanzas del hogar para dos personas: ingresos, gastos, presupuestos, cuentas, ahorro con interés,
inversiones y proyecciones. Se pueden ver los datos de todos juntos o por persona. Importa extractos en
**PDF digital y CSV**, y todo se procesa en el navegador.

Es una app **100 % estática**: no hay servidor. Se publica gratis en **Firebase Hosting** (plan
Spark, sin facturación), los datos viven en **Firestore**, se entra con **Google** y solo dos cuentas
tienen acceso.

## Desarrollo local

Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint       # verificación de tipos
npm run build      # genera dist/
```

Mientras `src/firebase/config.ts` esté vacío, la app funciona en modo local: los datos quedan solo en
ese navegador.

## Configurar Firebase (una sola vez)

1. En <https://console.firebase.google.com> crea un proyecto (plan **Spark**, gratis).
2. **Authentication → Sign-in method → Google**: actívalo.
3. **Firestore Database → Create database** (modo producción).
4. **Configuración del proyecto → Tus apps → Web (`</>`)**: registra una app y copia `apiKey`,
   `authDomain`, `projectId` y `appId` en `src/firebase/config.ts`. Estos valores son públicos por
   diseño; la seguridad la dan las reglas de Firestore.
5. Pon el id del proyecto en `.firebaserc` (en lugar de `TU-PROYECTO-FIREBASE`).

### Reglas de seguridad (solo sus dos correos)

El repositorio es público, así que los correos **no** están en el código:

1. Copia `.env.example` como `.env` y escribe los dos correos en `ALLOWED_EMAILS`.
2. Publica las reglas (la primera vez te pedirá `firebase login`):

   ```bash
   npm run deploy:rules
   ```

   Esto genera `firestore.rules` a partir de `firestore.rules.template` (fuera de git) y lo sube.
   Para cambiar los correos, edita `.env` y vuelve a correrlo.

`npm test` prueba las reglas en el emulador de Firebase (requiere Java): los correos permitidos
entran; cualquier otra cuenta, una cuenta sin verificar o un visitante sin sesión son rechazados.

## Publicación automática (GitHub Actions → Firebase Hosting)

`.github/workflows/firebase-hosting-merge.yml` compila (`npm ci && npm run build`) y publica en el
canal **live** en cada push a `main`. Necesita el secreto `FIREBASE_SERVICE_ACCOUNT` en GitHub, que
crea `firebase init hosting:github` (ver más abajo). Sin ese secreto, la Action compila pero no publica.

`firebase.json` sirve `dist/` como SPA (todas las rutas van a `index.html`).

La app queda en `https://<id-del-proyecto>.web.app`. Agrega ese dominio en **Authentication → Settings →
Authorized domains** si no aparece.

## Importar los datos existentes

Abre la app publicada en el navegador donde están tus datos actuales, entra con Google y pulsa
**"Importar estos datos a la nube"**. La app sube todo, verifica que llegó completo y solo entonces abre;
los datos locales no se borran. También puedes importar un respaldo `.json`.

## Respaldos

En **"Respaldo y Moneda"**: descarga un respaldo completo `.json` (sirve para restaurar), exporta los
movimientos a CSV o restaura un `.json` (los de versiones anteriores se convierten solos). La app recuerda
hacer un respaldo cada 7 días.

## Tipos de cambio y precios

- **Tipos de cambio**: botón "Actualizar con tipos de cambio reales", directamente desde el navegador con
  fuentes gratuitas y sin clave (open.er-api.com y, de respaldo, exchange-api en jsDelivr). Si fallan, se
  mantienen los actuales y se pueden editar a mano. Se muestra la fecha de la última actualización.
- **Precios de acciones/ETF**: se actualizan a mano (clic en el precio); cada posición muestra la fecha de
  la última actualización.

## Estructura de datos y migraciones

Firestore: `households/hogar` (configuración) y su subcolección `transactions` (un documento por
movimiento). El estado lleva un campo `version`; `src/data/migrations.ts` convierte los datos antiguos al
cargarlos (desde localStorage, Firestore o un respaldo). En modo local la clave de localStorage es
`finanzas_hogar_abdiel_lara_v1` y no se cambia para no perder datos existentes.
