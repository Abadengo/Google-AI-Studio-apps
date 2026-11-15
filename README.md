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

   Si vas a publicarla (Cloud Run u otro servidor), agrega también una contraseña para la IA:

   ```
   APP_PASSWORD="una-contraseña-larga"
   ```

   La app la pide una sola vez y la guarda en el navegador. Sin `APP_PASSWORD`, en modo producción
   (`npm start`) las funciones de IA quedan desactivadas para que nadie gaste tu clave.

3. Arranca la app:

   ```bash
   npm run dev
   ```

4. Abre <http://localhost:3000> en tu navegador.

Para uso diario más rápido (versión optimizada): `npm start` (compila y arranca en modo producción).
Para cerrar la app: `Ctrl + C` en la terminal.

## Dónde se guardan tus datos

Todo se guarda **solo en tu navegador** (localStorage), no en un servidor ni en la nube. Esto implica:

- Los datos son por **navegador y por dirección**: `http://localhost:3000` y `http://127.0.0.1:3000`
  son "lugares" distintos, igual que Chrome y Safari. Usa siempre la misma dirección.
- Si borras los datos de navegación / cookies del sitio, o usas modo incógnito, **se pierden**.

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

Los datos se guardan en `localStorage` con la clave `finanzas_hogar_abdiel_lara_v1` (no se cambia nunca).
El estado lleva un campo `version`; cuando la estructura cambia, `src/data/migrations.ts` convierte los
datos viejos al cargarlos (y también al restaurar un respaldo). Antes de migrar se guarda una copia intacta
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
