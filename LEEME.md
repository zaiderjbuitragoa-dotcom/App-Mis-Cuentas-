# Mi Dinero — PWA de finanzas personales (COP)

Funciona sin internet, se instala en el celular y guarda todo en **tu Google Sheet** (compartido con tu pareja/familia).

## 1. Crear la hoja y el backend (5 min)
1. Crea una hoja nueva en Google Sheets (ej. "Mi Dinero").
2. Extensiones → Apps Script. Pega el contenido de `apps-script/Code.gs`
   (en Configuración del proyecto activa "Mostrar appsscript.json" y pega también `appsscript.json`).
3. `ID_HOJA` y `CLAVE` ya vienen puestos en el archivo. Opcional: `CORREOS`.
4. Ejecuta la función `configurar`: acepta los permisos y crea las 4 hojas de una vez.
5. Implementar → Nueva implementación → Aplicación web → Ejecutar como: **Yo** · Acceso: **Cualquier usuario**.
   Copia la URL que termina en `/exec`.
   (Si cambias el código luego: Implementar → Administrar → editar → Nueva versión.)
6. Opcional, correo diario a las 7 a. m. con pagos próximos: ejecuta `activarRecordatorios`.

## 2. Publicar la app (HTTPS obligatorio para instalarla)
Sube esta carpeta (index.html, app.css, app.js, sw.js, manifest, íconos) a GitHub Pages, Netlify o Cloudflare Pages (gratis).
Prueba local: `python3 -m http.server 8000` y abre http://localhost:8000.

## 3. Usarla
- Abre la URL en el celular → "Agregar a pantalla de inicio".
- Ajustes: escribe tu nombre, pega la URL `/exec` y la CLAVE → "Guardar y sincronizar".
- Tu pareja repite el paso con la misma URL y CLAVE: ambos registran sobre la misma hoja.
- Ajustes → crea un PIN de 4 dígitos.

## Cómo calcula (sin descontar dos veces)
- Cada movimiento tiene UN estado: **pagado** o **pendiente**.
- Saldo libre = Recibido − Pagado − Pendiente. Al pagar un pendiente pasa a "Pagado"; el libre no cambia.
- Pagar la tarjeta o transferir entre cuentas NO es gasto (el gasto se contó al comprar).
- Las cuotas de deudas y los movimientos "se repite cada mes" se programan solos como pendientes.

## Pagos
La app **no procesa pagos**: cada pendiente puede llevar un enlace https (PSE, banco, portal de la empresa). "Pagar" lo abre y tú confirmas al volver. Así no maneja dinero ni claves.
Pasarela real (Wompi/ePayco) requiere comercio registrado y servidor para webhooks; la arquitectura queda lista para añadirla como una acción más en Code.gs.

## Seguridad (límites honestos)
- PIN con PBKDF2 (bloquea pantalla; tras 5 fallos espera 30 s; se bloquea tras 1 min en segundo plano). Los datos locales no están cifrados: el PIN es un bloqueo de pantalla.
- La URL /exec es pública pero toda petición exige la CLAVE (comparación en tiempo constante). Quien tenga la clave ve y edita tus datos: compártela solo con tu familia y cámbiala en Code.gs si se filtra.
- No guardes números completos de tarjeta, CVV ni claves bancarias (la app solo pide los últimos 4).
- CSP estricta, todo el HTML se escapa, enlaces solo https, y la hoja neutraliza fórmulas (`=`, `+`, `-`, `@`).
- Las columnas técnicas (Id, U, Servidor, Del, Datos) están ocultas en la hoja; no las borres. Puedes editar los datos desde la app.
