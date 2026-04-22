# PRD — Sistema de Seguimiento de Medicación "Bipolar"

**Repo target:** `bipolar.tumvp.uy`
**Stack:** Next.js 15 (App Router) + React 19 + Node.js + SQLite (better-sqlite3) + TypeScript
**Deployment:** VPS con dominio `bipolar.tumvp.uy` (HTTPS obligatorio)

---

## 1. Objetivo

PWA instalable que permite a un paciente registrar la toma diaria de medicación con un solo tap. Si el paciente no toma la medicación o llega tarde >4h durante 3 días, se notifica automáticamente a un contacto de emergencia mediante **email con Excel adjunto del historial de las últimas 4 semanas** y **llamada telefónica automática con mensaje de voz (Twilio)**.

---

## 2. Roles

### 2.1 Admin (único)
- Credenciales definidas en `.env` (seed al iniciar DB).
- **NO** se pueden crear más admins desde la UI.
- Puede: crear/editar/eliminar usuarios, configurar hora de medicación por usuario, ver logs de alertas enviadas.

### 2.2 Usuario
- Creado por el admin con: `username`, `password`, `fullName`, `medicationTime` (HH:mm), `emergencyContactEmail`, `emergencyContactPhone` (formato E.164, ej: `+59899123456`).
- Puede: apretar botón de toma, ver su historial, grabar audio/texto cuando corresponda.

---

## 3. Stack Técnico (obligatorio)

```
- Next.js 15 (App Router, Server Actions habilitados)
- React 19
- TypeScript strict
- SQLite con better-sqlite3 (archivo local en /data/bipolar.db)
- Drizzle ORM
- TailwindCSS 4 + shadcn/ui
- JWT con jsonwebtoken (expiración: sin vencimiento — NUNCA expira)
- bcrypt para passwords (12 rounds)
- Resend API para emails
- Twilio Voice API para llamadas automáticas (TTS con Amazon Polly)
- ExcelJS para generar reportes .xlsx
- Recharts para gráficas
- date-fns + date-fns-tz para manejo de timezone America/Montevideo
- node-cron para job diario
- PWA con next-pwa o manifest + service worker manual
- **Docker + docker-compose** para deployment reproducible
- **Nginx** como reverse proxy (vhost dedicado apuntando al contenedor)
```

---

## 4. Timezone

**TODO el manejo de fechas/horas usa `America/Montevideo` (UTC-3, sin DST desde 2015).**

- Timestamps en DB: se guardan en **ISO 8601 con offset** o como UTC y se convierten al mostrar.
- Recomendado: guardar como `TEXT` con formato ISO incluyendo offset `-03:00`.
- Toda comparación de "día" (ej: "¿ya tomó hoy?") se hace convirtiendo a `America/Montevideo` primero.
- Utilidad central: `src/lib/time.ts` con funciones `nowUY()`, `toUY(date)`, `formatUY(date, fmt)`, `isSameDayUY(a, b)`, `startOfDayUY(date)`.

---

## 5. Esquema de Base de Datos

```sql
-- users
CREATE TABLE users (
  id TEXT PRIMARY KEY,               -- uuid v4
  username TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  fullName TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  medicationTime TEXT,               -- 'HH:mm' (null para admin)
  emergencyContactEmail TEXT,        -- null para admin
  emergencyContactPhone TEXT,        -- null para admin, formato E.164
  createdAt TEXT NOT NULL,           -- ISO con offset UY
  updatedAt TEXT NOT NULL
);

-- medication_logs (registro de cada tap del botón)
CREATE TABLE medication_logs (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  takenAt TEXT NOT NULL,             -- ISO con offset UY (momento del tap)
  scheduledFor TEXT NOT NULL,        -- ISO del día+hora programada correspondiente
  delayMinutes INTEGER NOT NULL,     -- diferencia en minutos (puede ser negativo)
  isLate INTEGER NOT NULL DEFAULT 0, -- 1 si delayMinutes > 240
  description TEXT,                  -- texto explicación (si isLate=1)
  audioPath TEXT,                    -- ruta al archivo de audio (si isLate=1)
  createdAt TEXT NOT NULL
);

CREATE INDEX idx_logs_user_taken ON medication_logs(userId, takenAt);
CREATE INDEX idx_logs_user_scheduled ON medication_logs(userId, scheduledFor);

-- daily_status (uno por usuario por día, llenado por cron)
CREATE TABLE daily_status (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                -- 'YYYY-MM-DD' en zona UY
  status TEXT NOT NULL CHECK(status IN ('ontime','late','missed')),
  logId TEXT REFERENCES medication_logs(id),
  createdAt TEXT NOT NULL,
  UNIQUE(userId, date)
);

-- alerts (log de alertas enviadas a contacto de emergencia)
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  triggeredAt TEXT NOT NULL,
  reason TEXT NOT NULL,              -- ej: "3 incidentes consecutivos: 2026-04-20,2026-04-21,2026-04-22"
  emailsSentTo TEXT NOT NULL,        -- JSON array de emails
  excelPath TEXT,                    -- ruta al xlsx generado
  audioLogIds TEXT,                  -- JSON array de medication_log IDs cuyos audios se adjuntaron
  audioAttachmentCount INTEGER NOT NULL DEFAULT 0,
  audioSkippedForSize INTEGER NOT NULL DEFAULT 0,  -- audios omitidos por exceder 40MB total
  createdAt TEXT NOT NULL
);

-- call_logs (cada intento de llamada Twilio ligado a una alerta)
CREATE TABLE call_logs (
  id TEXT PRIMARY KEY,
  alertId TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  toNumber TEXT NOT NULL,            -- E.164
  twilioCallSid TEXT,                -- SID devuelto por Twilio (null si falló antes de crear)
  attemptNumber INTEGER NOT NULL,    -- 1, 2, 3, 4 (primera + 3 reintentos)
  status TEXT NOT NULL,              -- 'queued'|'ringing'|'in-progress'|'completed'|'busy'|'no-answer'|'failed'|'canceled'
  duration INTEGER,                  -- segundos (null hasta completar)
  errorCode TEXT,                    -- código de Twilio si falló
  errorMessage TEXT,
  scheduledAt TEXT NOT NULL,         -- cuándo se disparó/agendó este intento
  completedAt TEXT,                  -- cuándo terminó (conteste o falle definitivamente)
  createdAt TEXT NOT NULL
);

CREATE INDEX idx_calls_alert ON call_logs(alertId);
CREATE INDEX idx_calls_status ON call_logs(status);

-- sessions (opcional para invalidación; JWT stateless no vence pero permitimos revocar)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tokenHash TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  revokedAt TEXT
);
```

---

## 6. Autenticación

### 6.1 Login
- `POST /api/auth/login` → `{ username, password }` → `{ token, user }`.
- Token JWT firmado con `JWT_SECRET` del `.env`.
- **Payload JWT:** `{ sub: userId, role, iat }` — **SIN claim `exp`**.
- Token guardado en `localStorage` (NO cookie httpOnly, porque queremos persistencia absoluta tipo kiosk).
- Middleware de Next.js valida Bearer token en rutas `/api/*` excepto `/api/auth/login`.

### 6.2 Seed del admin
- Al iniciar el server, si no existe user `role='admin'`, crear uno con:
  - `username = process.env.ADMIN_USERNAME`
  - `password = process.env.ADMIN_PASSWORD` (hashear con bcrypt)
  - `fullName = 'Administrator'`
- Si ya existe admin, no tocar.

---

## 7. Funcionalidad Usuario

### 7.1 Pantalla principal (post-login)
- Fondo limpio, un único botón GRANDE centrado: **"TOMÉ LOS REMEDIOS"**.
- Tamaño mínimo del botón: 70% del ancho, 40% del alto de viewport.
- Feedback táctil: scale 0.95 on press, haptic vibration si disponible.
- Debajo: pequeño texto con hora programada y estado del día actual ("Pendiente" / "Tomado a las 21:03" / "Tarde — faltan X minutos").
- Icono de hamburguesa arriba-derecha.

### 7.2 Lógica del tap
```
On tap:
  now = nowUY()
  scheduledToday = combinar (today en UY, user.medicationTime)
  delayMin = diffMinutes(now, scheduledToday)

  if (delayMin > 240):
    // Abre modal obligatorio
    abrir modal que requiere:
      - grabar audio con WebRTC (obligatorio O texto)
      - campo de texto (obligatorio O audio)
      - al menos UNO de los dos debe estar presente
    al confirmar → POST /api/logs con audio + description
  else:
    POST /api/logs directo
```

### 7.3 Menú hamburguesa
- **Historial:**
  - Filtros: `desde` (date opcional), `hasta` (date opcional).
  - Orden: `asc` / `desc` (default desc).
  - Paginación: 20 por página.
  - Muestra: fecha/hora de toma, hora programada, delay en minutos, badge (Ontime/Tarde/Faltó), descripción si hubo, link a audio si hubo.
- **Gráfica:**
  - Eje X: últimos 30 días (por defecto, configurable a 7/14/30/90).
  - Eje Y: hora del día (0-24h).
  - Punto por cada toma: verde si ontime, amarillo si tarde, rojo (vacío/marcador especial) si faltó.
  - Línea horizontal de referencia en `medicationTime`.
- **Cerrar sesión** (elimina localStorage + llama `/api/auth/logout`).

### 7.4 Grabación WebRTC
- Usar `MediaRecorder` API con `mimeType: 'audio/webm;codecs=opus'`.
- Permiso de micrófono pedido al abrir modal.
- UI: botón REC circular grande, timer, botón stop, preview, botón regrabar.
- Upload como `multipart/form-data` a `/api/logs` junto al texto.
- Guardar en `/data/audio/{userId}/{logId}.webm`.

---

## 8. Funcionalidad Admin

### 8.1 Panel admin (`/admin`)
- Redirige aquí si `user.role === 'admin'` al loguearse.
- Lista de usuarios con acciones: editar, eliminar, ver historial.
- Botón "Nuevo usuario" abre formulario:
  - `username` (único, requerido)
  - `password` (requerido, mínimo 8 chars)
  - `fullName` (requerido)
  - `medicationTime` (HH:mm, requerido)
  - `emergencyContactEmail` (requerido, validar email)
  - `emergencyContactPhone` (requerido, validar E.164 con regex `^\+[1-9]\d{7,14}$`)
- Al editar: todos los campos editables; password opcional (si vacío no cambia).

### 8.2 Vista de alertas
- `/admin/alerts` lista todas las alertas disparadas, con link al Excel y al log de emails.

---

## 9. Lógica de Incidentes y Alertas

### 9.1 Definición de "incidente diario"
Un usuario tiene un **incidente en el día X** si:
- **(a)** No existe `medication_log` cuyo `scheduledFor` caiga en X (falta total), **O**
- **(b)** Existe un log para X pero con `isLate = 1` (delay > 240 minutos).

Peso semántico: (a) > (b), pero ambos cuentan como incidente.

### 9.2 Regla de alerta
Si el usuario acumula **3 días con incidente en los últimos 7 días calendario** (zona UY), se dispara alerta.

> Nota: son 3 días con incidente, no necesariamente consecutivos, dentro de ventana móvil de 7 días. Esto captura patrones de incumplimiento sin requerir 3 seguidos.

### 9.3 Triggers (ambos activos)

**Trigger A — Cron diario:**
- `node-cron` corre todos los días a las **23:59 America/Montevideo**.
- Para cada usuario:
  1. Calcula status del día que termina.
  2. Upsert en `daily_status`.
  3. Evalúa ventana últimos 7 días. Si cumple regla → dispara alerta.

**Trigger B — Reactivo al tap:**
- Al registrar un log, si ese log es tarde, después de insertarlo recomputar la ventana y disparar alerta si aplica.

### 9.4 Anti-spam
- Antes de disparar, verificar que NO exista alerta previa para ese usuario en las **últimas 24h**. Si existe, skip.

### 9.5 Acciones al disparar alerta
Todas las acciones se ejecutan **en paralelo** al detectar la condición:

1. Generar Excel de las últimas **4 semanas** del usuario (ver sección 10).
2. Recolectar **todos los archivos de audio** asociados a `medication_logs` del usuario en los **últimos 7 días calendario** (UY). Puede haber 0, 1 o varios (uno por cada toma tarde con audio).
3. Enviar email al **contacto de emergencia** con:
   - Asunto: `[Alerta] Incumplimiento de medicación — {fullName}`
   - Cuerpo: nombre, relación, resumen de 3 incidentes, hora actual.
   - **Adjunto 1:** Excel con historial de 4 semanas.
   - **Adjuntos 2..N:** archivos de audio `.webm` de los últimos 7 días, renombrados como `audio-YYYY-MM-DD-HHmm.webm` para que sean reconocibles por fecha.
   - Si un adjunto total supera el límite de Resend (~40MB por email), priorizar los audios más recientes y mencionar en el cuerpo: "Se adjuntan los N audios más recientes. Historial completo disponible en `/admin/alerts/{id}`."
4. Enviar email al **usuario** con:
   - Asunto: `Aviso: se ha notificado a tu contacto de emergencia`
   - Cuerpo: informarle que debido a 3 incidentes recientes, se activó el protocolo y se notificó a `{emailContacto}` y `{telContacto}` (mostrar últimos dígitos enmascarados). Mencionar que sus grabaciones fueron compartidas con el contacto.
5. Insertar registro en `alerts` con snapshot: `audioAttachmentCount` y lista de `logId`s incluidos.
6. **Disparar llamada telefónica al contacto de emergencia** vía Twilio (ver sección 11).

### 9.6 Política de reintentos de llamada
- Intento 1: inmediato al disparar alerta.
- Intentos 2, 3, 4: cada uno **10 minutos después** del anterior si el anterior terminó en status `no-answer`, `busy`, `failed` o `canceled`.
- Si cualquier intento termina en `completed` con `duration >= 5` segundos → se considera contacto exitoso y **se cancelan los reintentos pendientes**.
- Máximo total: 4 intentos (primera + 3 reintentos).
- Si los 4 intentos fallan: marcar alerta con flag `callsExhausted=true` y registrar en log de admin (visible en `/admin/alerts`).

---

## 10. Reporte Excel (ExcelJS)

**Archivo:** `historial-{username}-{YYYYMMDD}.xlsx`

**Hoja 1 — "Historial":**
| Fecha | Día | Hora programada | Hora real | Delay (min) | Estado | Descripción | Audio |
|-------|-----|-----------------|-----------|-------------|--------|-------------|-------|

- 28 filas (últimas 4 semanas).
- Si faltó ese día: fila con Estado "FALTÓ" y campos en rojo.
- Formato condicional: verde (ontime), amarillo (tarde), rojo (faltó).

**Hoja 2 — "Gráfica":**
- Chart de línea/puntos insertado con ExcelJS.
- Eje X: fechas (28 días).
- Eje Y: delay en minutos (línea de referencia en 0 y 240).

**Hoja 3 — "Resumen":**
- Total tomas: N
- Tomas a tiempo: N
- Tomas tarde: N
- Faltas: N
- % cumplimiento: X%

Guardar en `/data/reports/{userId}/{timestamp}.xlsx` y adjuntar al email.

---

## 11. Integración Twilio Voice

### 11.1 Setup
- Cuenta Twilio con número virtual ya provisionado (proporcionado por el operador).
- Credenciales: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` en `.env`.
- SDK: `twilio` oficial de npm (`npm install twilio`).

### 11.2 TwiML del mensaje
Mensaje TTS en español con voz `Polly.Mia` (Amazon Polly neural, español mexicano — la más clara para Uruguay):

```xml
<Response>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">
    Hola. Este es un aviso automático del sistema de seguimiento de medicación.
  </Say>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">
    El paciente {fullName} ha presentado incumplimiento en la toma de su
    medicación durante los últimos días. Por favor, revise el correo
    electrónico enviado a {emergencyContactEmail} para ver el detalle.
  </Say>
  <Pause length="2"/>
  <Say language="es-MX" voice="Polly.Mia">
    Repito: alerta de medicación para {fullName}.
    Por favor, contacte al paciente lo antes posible.
  </Say>
  <Pause length="1"/>
</Response>
```

El TwiML se genera dinámicamente en `/api/twilio/twiml/:callLogId` (endpoint público, validado con firma de Twilio).

### 11.3 Módulo `lib/twilio.ts`

Funciones exportadas:
- `initiateCall(alertId, userId, toNumber, attemptNumber)` → crea registro en `call_logs`, llama `client.calls.create(...)`, guarda `twilioCallSid`.
- `handleStatusCallback(callSid, status, duration)` → actualiza `call_logs`; si `status` es terminal (completed/failed/no-answer/busy/canceled) y NO fue exitoso, agenda siguiente intento.
- `scheduleRetry(alertId, nextAttemptNumber)` → usa `setTimeout` persistente (ver 11.5) con delay de 10 min.
- `cancelPendingRetries(alertId)` → marca retries agendados como `canceled` si llegó un `completed` exitoso.

### 11.4 Endpoints públicos (sin JWT, validados con firma Twilio)

- `POST /api/twilio/twiml/:callLogId` → devuelve el XML TwiML del mensaje. Twilio lo consume al contestar la llamada.
- `POST /api/twilio/status/:callLogId` → webhook de status callback. Twilio lo llama en cada cambio de estado (initiated, ringing, answered, completed).

**Validación de firma Twilio (obligatoria):**
```ts
import { validateRequest } from 'twilio';
const signature = req.headers['x-twilio-signature'];
const url = `${APP_URL}${req.url}`;
const valid = validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body);
if (!valid) return new Response('Forbidden', { status: 403 });
```

Configurar en cada `calls.create`:
```ts
await client.calls.create({
  to: toNumber,
  from: TWILIO_FROM_NUMBER,
  url: `${APP_URL}/api/twilio/twiml/${callLogId}`,
  statusCallback: `${APP_URL}/api/twilio/status/${callLogId}`,
  statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  statusCallbackMethod: 'POST',
  timeout: 30,           // segundos antes de dar no-answer
  machineDetection: 'Enable',  // si salta contestador, no perder el mensaje
});
```

### 11.5 Persistencia de reintentos
No usar `setTimeout` en memoria (se pierde al reiniciar el server). En su lugar:

- Agregar columna `nextRetryAt TEXT` a `call_logs` cuando se agenda un retry.
- El cron (`lib/cron.ts`) corre **cada minuto** un job adicional que:
  1. Busca `call_logs` con `status IN ('no-answer','busy','failed','canceled')` y `nextRetryAt <= now` y `attemptNumber < 4`.
  2. Para cada uno: dispara el siguiente intento.
- Esto sobrevive reinicios del server.

### 11.6 Success criteria de una llamada
Una llamada cuenta como **exitosa** (y cancela reintentos) si:
- `status === 'completed'` Y
- `duration >= 5` segundos Y
- `answeredBy !== 'machine_*'` (no fue contestador automático — si Twilio detectó máquina, no cuenta como contacto humano exitoso).

Si fue máquina (`answeredBy === 'machine_end_beep'` o similar), igual se deja el mensaje pero se agenda siguiente intento porque no hay garantía de escucha.

### 11.7 Admin UI
- En `/admin/alerts`, cada alerta muestra un sub-panel con los intentos de llamada:
  - Tabla: `#`, `Hora`, `Número`, `Status`, `Duración`, `Error`.
  - Badge general: 🟢 "Contactado", 🟡 "En reintento", 🔴 "Sin contacto tras 4 intentos".
- Botón "Reintentar ahora" (manual) si todos los intentos automáticos fallaron.

### 11.8 Costos esperados
- Twilio Voice a Uruguay: ~USD 0.013/min (tarifa saliente a móvil UY, verificar en dashboard).
- Mensaje dura ~25 segundos → ~USD 0.006 por llamada.
- Peor caso por alerta (4 intentos sin contacto): ~USD 0.025.
- TTS Polly Neural: incluido en el costo por minuto, sin cobro extra.

---

## 12. PWA (instalable en celular)

### 12.1 Manifest
`public/manifest.json`:
```json
{
  "name": "Bipolar — Seguimiento de Medicación",
  "short_name": "Bipolar",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

### 12.2 Service Worker
- Cachear shell de la app (HTML, JS, CSS, iconos).
- Estrategia `network-first` para `/api/*`.
- Estrategia `cache-first` para assets estáticos.
- Offline fallback: mostrar mensaje "Sin conexión — tu toma se registrará cuando vuelva internet" y usar IndexedDB queue para reintentar POST /api/logs.

### 12.3 Prompt de instalación
- Detectar `beforeinstallprompt` y mostrar botón "Instalar app" en menú hamburguesa si está disponible.

---

## 13. API — Contratos

Todas las rutas bajo `/api`. Respuestas JSON. Errores con shape `{ error: string, code: string }`.

### Auth
- `POST /api/auth/login` → body `{ username, password }` → `{ token, user: { id, username, fullName, role, medicationTime } }`
- `POST /api/auth/logout` → `{ ok: true }` (revoca sesión)
- `GET /api/auth/me` → `{ user }`

### Health
- `GET /api/health` → `{ ok: true, ts: "ISO" }` (sin auth, usado por Docker healthcheck)

### Logs
- `POST /api/logs` → `multipart/form-data` con campos `description?` y `audio?` (file). Devuelve `{ log, dayStatus }`.
- `GET /api/logs?from=YYYY-MM-DD&to=YYYY-MM-DD&order=asc|desc&page=1&pageSize=20` → `{ logs[], total, page, pageSize }`
- `GET /api/logs/chart?days=30` → `{ points: [{ date, hour, minute, status }] }`
- `GET /api/logs/:id/audio` → stream del audio (validar ownership)

### Admin (require role=admin)
- `GET /api/admin/users` → lista
- `POST /api/admin/users` → crear
- `PATCH /api/admin/users/:id` → editar
- `DELETE /api/admin/users/:id` → eliminar
- `GET /api/admin/users/:id/logs?...` → historial de otro user
- `GET /api/admin/alerts` → lista de alertas con sub-array de `callLogs[]`
- `GET /api/admin/alerts/:id/excel` → descarga del Excel
- `POST /api/admin/alerts/:id/retry-call` → dispara reintento manual de llamada

### Twilio (públicos, validados con firma Twilio)
- `POST /api/twilio/twiml/:callLogId` → devuelve XML TwiML con el mensaje personalizado
- `POST /api/twilio/status/:callLogId` → webhook de status callback de Twilio

---

## 14. Estructura de Carpetas

```
/
├── .env.example
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── nginx/
│   └── bipolar.tumvp.uy.conf   # vhost de referencia (se copia al host)
├── next.config.ts
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── data/                    # gitignored; montado como volumen Docker
│   ├── bipolar.db
│   ├── audio/{userId}/
│   └── reports/{userId}/
└── src/
    ├── app/
    │   ├── (auth)/login/page.tsx
    │   ├── (app)/page.tsx                  # botón principal
    │   ├── (app)/history/page.tsx
    │   ├── (app)/chart/page.tsx
    │   ├── admin/page.tsx
    │   ├── admin/users/[id]/page.tsx
    │   ├── admin/alerts/page.tsx
    │   ├── api/auth/login/route.ts
    │   ├── api/auth/logout/route.ts
    │   ├── api/auth/me/route.ts
    │   ├── api/logs/route.ts
    │   ├── api/logs/[id]/audio/route.ts
    │   ├── api/logs/chart/route.ts
    │   ├── api/admin/users/route.ts
    │   ├── api/admin/users/[id]/route.ts
    │   ├── api/admin/alerts/route.ts
    │   ├── api/admin/alerts/[id]/retry-call/route.ts
    │   ├── api/twilio/twiml/[callLogId]/route.ts
    │   └── api/twilio/status/[callLogId]/route.ts
    ├── components/
    │   ├── BigButton.tsx
    │   ├── LateModal.tsx
    │   ├── AudioRecorder.tsx
    │   ├── HamburgerMenu.tsx
    │   ├── HistoryTable.tsx
    │   ├── MedicationChart.tsx
    │   └── ui/               # shadcn
    ├── lib/
    │   ├── db/
    │   │   ├── index.ts
    │   │   ├── schema.ts
    │   │   └── migrations/
    │   ├── auth.ts           # JWT sign/verify + middleware
    │   ├── time.ts           # utilidades UY
    │   ├── mailer.ts         # Resend wrapper
    │   ├── twilio.ts         # llamadas + retries + webhook handlers
    │   ├── excel.ts          # generación de reporte
    │   ├── alerts.ts         # lógica de detección + dispatch
    │   ├── cron.ts           # job diario + job de reintentos cada minuto
    │   └── seed.ts           # seed admin
    ├── middleware.ts         # protección de rutas
    └── server.ts             # inicialización cron + seed al arrancar
```

---

## 15. Variables de Entorno (`.env.example`)

```env
# Server
NODE_ENV=production
PORT=3000
APP_URL=https://bipolar.tumvp.uy

# Database
DATABASE_PATH=./data/bipolar.db

# Auth
JWT_SECRET=                         # generar con: openssl rand -base64 64
ADMIN_USERNAME=admin
ADMIN_PASSWORD=                     # definir fuerte

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx
MAIL_FROM="Bipolar Alert <alerts@tumvp.uy>"

# Twilio Voice
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+1xxxxxxxxxx   # tu número virtual Twilio en E.164

# Timezone (no cambiar)
TZ=America/Montevideo
```

---

## 16. Deployment

El sistema se ejecuta **100% en Docker**. El host solo expone nginx como reverse proxy al contenedor de la app.

### 16.1 Dockerfile (multi-stage)

Archivo `Dockerfile` en la raíz del repo:

```dockerfile
# ---------- Stage 1: deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false

# ---------- Stage 2: builder ----------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- Stage 3: runner ----------
FROM node:20-alpine AS runner
WORKDIR /app

# better-sqlite3 needs build tools at runtime? No, prebuilt binaries are included.
# But if we need native compilation: RUN apk add --no-cache python3 make g++

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=America/Montevideo

# Install tzdata so TZ env var works correctly in Alpine
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/America/Montevideo /etc/localtime && \
    echo "America/Montevideo" > /etc/timezone

# Non-root user
RUN addgroup --system --gid 1001 bipolar && \
    adduser --system --uid 1001 bipolar

COPY --from=builder /app/public ./public
COPY --from=builder --chown=bipolar:bipolar /app/.next/standalone ./
COPY --from=builder --chown=bipolar:bipolar /app/.next/static ./.next/static
COPY --from=builder --chown=bipolar:bipolar /app/drizzle ./drizzle

# Data directory (volumen montado en runtime)
RUN mkdir -p /app/data/audio /app/data/reports && \
    chown -R bipolar:bipolar /app/data

USER bipolar
EXPOSE 3000

CMD ["node", "server.js"]
```

En `next.config.ts` habilitar output standalone:
```ts
export default { output: 'standalone' }
```

### 16.2 docker-compose.yml

```yaml
services:
  bipolar:
    build: .
    container_name: bipolar-app
    restart: unless-stopped
    env_file: .env
    environment:
      TZ: America/Montevideo
    volumes:
      - ./data:/app/data          # persistencia: DB + audios + reportes
    ports:
      - "127.0.0.1:3010:3000"     # bind solo a loopback; nginx lo expone
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

Exponer `/api/health` con respuesta simple `{ ok: true }` para el healthcheck.

### 16.3 .dockerignore

```
node_modules
.next
.git
.env
.env.*
data/
*.md
Dockerfile
docker-compose.yml
```

### 16.4 Build y run

```bash
# En el VPS
git clone <repo> /opt/bipolar
cd /opt/bipolar
cp .env.example .env
# editar .env con valores reales

docker compose build
docker compose up -d
docker compose logs -f bipolar
```

### 16.5 Nginx vhost

**Archivo:** `/etc/nginx/sites-available/bipolar.tumvp.uy`

```nginx
# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name bipolar.tumvp.uy;
    return 301 https://$host$request_uri;
}

# HTTPS vhost
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name bipolar.tumvp.uy;

    # TLS (certbot gestiona estos archivos)
    ssl_certificate     /etc/letsencrypt/live/bipolar.tumvp.uy/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bipolar.tumvp.uy/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Body size: permite uploads de audio y recepción de webhooks con audio de Twilio
    client_max_body_size 30M;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging separado de otros vhosts
    access_log /var/log/nginx/bipolar.access.log;
    error_log  /var/log/nginx/bipolar.error.log;

    # Proxy al contenedor Docker (bind en 127.0.0.1:3010)
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # Webhooks Twilio: accesibles públicamente (sin auth, validan firma internamente)
    # NOTA: la validación de firma requiere que `Host` llegue correcto al backend.
    location /api/twilio/ {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Activación:**
```bash
sudo ln -s /etc/nginx/sites-available/bipolar.tumvp.uy \
           /etc/nginx/sites-enabled/
sudo certbot --nginx -d bipolar.tumvp.uy
sudo nginx -t && sudo systemctl reload nginx
```

### 16.6 Backups

Cron en el host (fuera del contenedor, para backup del volumen):

```bash
# /etc/cron.d/bipolar-backup
0 3 * * * root tar czf /backup/bipolar-$(date +\%F).tar.gz /opt/bipolar/data && \
             find /backup -name 'bipolar-*.tar.gz' -mtime +30 -delete
```

### 16.7 Actualizaciones

```bash
cd /opt/bipolar
git pull
docker compose build
docker compose up -d
# migraciones Drizzle corren al arrancar el contenedor (server.ts invoca migrate)
```

---

## 17. Requerimientos No Funcionales

- **Seguridad:** rate-limit en `/api/auth/login` (5 intentos / 15 min por IP).
- **Validación:** todos los inputs con Zod (emails, teléfonos E.164, horas HH:mm, fechas ISO).
- **Logging:** pino o console estructurado; guardar eventos críticos (alerta enviada, login fallido, user creado).
- **Accesibilidad:** botón principal con ARIA label, contraste AAA, tamaño de fuente ≥ 18px.
- **Responsive:** mobile-first; el botón debe funcionar perfecto en pantallas desde 320px.
- **Performance:** pantalla principal LCP < 1.5s; bundle inicial < 200KB gzipped.

---

## 18. Criterios de Aceptación (tests manuales)

1. ✅ Admin puede loguearse con credenciales del `.env`.
2. ✅ Admin crea usuario con todos los campos válidos; rechaza email inválido o teléfono sin `+`.
3. ✅ Usuario creado puede loguearse con username/password.
4. ✅ Token JWT del usuario no expira (verificar decodificando: no tiene `exp`).
5. ✅ Al apretar el botón dentro del rango (hora ± 4h), se registra sin modal.
6. ✅ Al apretar +4h después, aparece modal; NO permite enviar sin audio ni texto.
7. ✅ PWA instalable: en Android Chrome aparece prompt "Añadir a pantalla de inicio".
8. ✅ Al abrir PWA instalada, muestra el botón sin requerir login nuevamente (token persiste en localStorage).
9. ✅ Historial filtra por rango de fechas y pagina correctamente.
10. ✅ Gráfica muestra los últimos 30 días con puntos por estado.
11. ✅ Cron a las 23:59 UY genera `daily_status` del día.
12. ✅ Con 3 incidentes en 7 días, se dispara alerta: email al contacto con Excel adjunto + email al usuario.
13. ✅ Excel tiene 3 hojas (Historial, Gráfica, Resumen) con formato condicional.
14. ✅ No se dispara alerta duplicada dentro de 24h.
15. ✅ Al dispararse una alerta, se inicia llamada Twilio al contacto (ver en dashboard de Twilio + registro en `call_logs`).
16. ✅ El contacto recibe llamada con mensaje TTS en español mencionando el nombre del paciente.
17. ✅ Si la llamada queda en `no-answer`/`busy`/`failed`, se reintenta automáticamente 10 min después hasta un máximo de 4 intentos totales.
18. ✅ Si alguien contesta (duration ≥ 5s, no fue máquina), se cancelan los reintentos pendientes.
19. ✅ Los webhooks `/api/twilio/*` validan firma Twilio y rechazan requests no firmados con 403.
20. ✅ Tras reiniciar el server con un retry pendiente, el cron de reintentos lo retoma y ejecuta en el horario programado.
21. ✅ `/admin/alerts` muestra el detalle de intentos de llamada por alerta y permite reintentar manualmente.
22. ✅ **El email al contacto de emergencia adjunta TODOS los audios `.webm` existentes de los últimos 7 días del usuario**, nombrados como `audio-YYYY-MM-DD-HHmm.webm`.
23. ✅ Si los audios exceden 40MB totales, se incluyen los más recientes y el cuerpo del email lo menciona.
24. ✅ Si no hay audios en los últimos 7 días, el email se envía normalmente solo con el Excel.
25. ✅ **`docker compose up -d` levanta la app completa desde cero** incluyendo migraciones de DB al iniciar.
26. ✅ El volumen `./data` persiste DB, audios y reportes entre reinicios del contenedor.
27. ✅ El contenedor corre con timezone `America/Montevideo` verificable con `docker exec bipolar-app date`.
28. ✅ **Nginx vhost dedicado** en `bipolar.tumvp.uy` hace proxy a `127.0.0.1:3010` y pasa el header `Host` correcto (necesario para validación de firma Twilio).
29. ✅ TLS activo con Let's Encrypt; HTTP redirige a HTTPS.
30. ✅ Healthcheck de Docker reporta `healthy` tras 30s de startup.
31. ✅ Timezone siempre America/Montevideo en toda la UI y comparaciones.
32. ✅ Funciona en Safari iOS y Chrome Android como PWA.

---

## 19. Orden de Implementación Sugerido para Claude Code

1. Bootstrap Next.js + TypeScript + Tailwind + shadcn.
2. Setup Drizzle + SQLite + schema (incluido `call_logs`) + migrations + seed admin.
3. Utilidad `lib/time.ts` (CRÍTICO — todo depende de esto).
4. Auth (login, JWT sin exp, middleware).
5. Layout + login page + redirect por rol.
6. Pantalla del botón grande + POST /api/logs (caso simple).
7. Modal de tarde + AudioRecorder + upload multipart.
8. Panel admin CRUD de usuarios.
9. Historial (API + UI con filtros + paginación).
10. Gráfica (API + Recharts).
11. `lib/mailer.ts` con Resend + generación Excel.
12. `lib/alerts.ts` con lógica de detección.
13. **`lib/twilio.ts` + endpoints TwiML y status callback** + validación de firma.
14. Integración de llamada + reintentos en `lib/alerts.ts`.
15. Cron job diario + cron de reintentos cada minuto + trigger reactivo.
16. UI de `/admin/alerts` con panel de call logs + botón retry manual.
17. PWA (manifest + SW + prompt de instalación + offline queue).
18. Rate limiting + validaciones Zod + logging + endpoint `/api/health`.
19. **Dockerfile multi-stage + docker-compose.yml + .dockerignore** + `next.config.ts` con `output: 'standalone'`.
20. **Nginx vhost dedicado** (`bipolar.tumvp.uy.conf`) + certbot + deployment docs.
21. Pruebas manuales contra checklist de sección 18 (incluyendo despliegue end-to-end en VPS).

---

## 20. Notas Finales para Claude Code

- **Nunca uses `new Date()` sin convertir a UY.** Siempre pasar por `lib/time.ts`.
- **JWT sin exp es intencional** — es una app kiosk-style para uso personal.
- **El botón debe ser imposible de no ver.** Es la feature principal; todo lo demás es secundario.
- **El audio se guarda pero no se transcribe.** No integrar Whisper ni similares.
- **Los audios se comparten con el contacto de emergencia** (últimos 7 días) al dispararse una alerta. Informar esto al usuario al crear la cuenta como parte del consentimiento implícito.
- **E.164 para teléfonos:** guardado para email de alerta Y para llamada Twilio automática.
- **Twilio webhooks** deben ser públicos (sin JWT) pero validar firma con `validateRequest` — nunca confiar en el IP ni en parámetros sin validar.
- **Los reintentos de llamada se persisten en DB** (no en memoria), para sobrevivir reinicios.
- **Docker es la única forma soportada de correr el sistema.** No hay binarios locales, no hay systemd de Node directo. El único servicio del host es nginx.
- **El volumen `./data`** contiene DB + audios + reportes; el backup del host solo necesita respaldar ese directorio.
- **nginx debe pasar el header `Host` tal cual** (`proxy_set_header Host $host`) para que la validación de firma Twilio funcione — la firma se calcula sobre la URL completa incluyendo el host público.
- **Todo el código y comentarios en inglés.** Strings de UI en español (es-UY). Los strings del TTS de Twilio en español neutro entendible en Uruguay.
- **Sin analytics, sin tracking externo, sin CDN de terceros más allá de Resend y Twilio.**

---

**FIN DEL PRD ORIGINAL**

---

## ANEXO A — Cambios acordados 2026-04-22

Este anexo modifica el PRD original. En caso de conflicto, **gana el anexo**.

### A.1 Modelo de usuario — campos adicionales

`users` agrega dos columnas (NOT NULL para `role='user'`, NULL para `role='admin'`):

```sql
ALTER TABLE users ADD COLUMN patientEmail TEXT;   -- email del propio paciente
ALTER TABLE users ADD COLUMN patientPhone TEXT;   -- E.164 del propio paciente
```

**Form admin de creación/edición de usuario** ahora pide 8 campos:

| Campo | Required | Notas |
|---|---|---|
| username | sí | único |
| password | sí (en create) | min 8 chars |
| fullName | sí | |
| medicationTime | sí | HH:mm |
| patientEmail | sí | email del paciente |
| patientPhone | sí | E.164 — usado en Round 3 de escalada |
| emergencyContactEmail | sí | email |
| emergencyContactPhone | sí | E.164 |

El **email "Aviso: se ha notificado a tu contacto de emergencia"** del PRD §9.5.4 se manda a `patientEmail` (no al `username`, que sigue siendo solo identificador de login).

### A.2 Definición de "missed" — deadline duro de 12h

Reemplaza §9.1.

Un usuario tiene **incidente en el día X** si:
- **(a)** No existe `medication_log` cuyo `scheduledFor` caiga en X **y ya pasaron 12 horas desde `scheduledFor`** → `missed`, **O**
- **(b)** Existe un log para X con `delayMinutes > 240` (delay > 4h) → `late`.

Diferencia clave con el PRD original: un día se marca `missed` apenas se cumplen 12h del horario programado, sin esperar a las 23:59. Si la medicación es a las 08:00, a las 20:00 ya cuenta como `missed` y se evalúa la regla de alerta.

**Implementación:**
- El cron de reintentos (que ya corre cada minuto, §11.5) también recorre usuarios y, si hay alguno cuyo `scheduledFor` de hoy fue hace ≥ 12 h sin log → upsert `daily_status='missed'` y reevalúa ventana de 7 días → dispara alerta si aplica.
- El cron diario de las 23:59 sigue existiendo como red de seguridad/idempotencia.

### A.3 Ventana mínima para llamar — 9 AM UY

Solo límite **inferior**: las llamadas Twilio NO se inician antes de las **09:00 America/Montevideo**.

- Si el evento que dispara la alerta cae **antes de las 09:00 UY** → email se envía inmediato, llamada **se posterga al próximo 09:00**.
- Una vez arrancada la secuencia, los intervalos de 10 min entre reintentos y la espera de 4 h entre rounds son **rígidos** (pueden ejecutarse a cualquier hora, incluso de madrugada).
- Sin límite superior — una alerta de las 21:50 puede generar llamadas hasta las 22:30 sin problema.

### A.4 Escalada de llamadas — 3 rounds

Reemplaza §9.6.

```
Round 1 (a contacto de emergencia)
  T+00:00  Llamada #1
  T+00:10  Reintento #2  (si #1 falló)
  T+00:20  Reintento #3
  T+00:30  Reintento #4

  Si en cualquier intento hay éxito (completed, duration ≥ 5s, no fue máquina):
    → cancelar pendientes, marcar alert.contactReached='emergency_round1', fin.

  Si los 4 intentos fallan:
    → esperar 4 horas

Round 2 (a contacto de emergencia, mismo número)
  T+04:30  Llamada #1
  T+04:40  Reintento #2
  T+04:50  Reintento #3
  T+05:00  Reintento #4

  Éxito → marcar alert.contactReached='emergency_round2', fin.
  Falla total → seguir a Round 3.

Round 3 (al PROPIO PACIENTE — patientPhone)
  T+05:00 + (delay para próxima 09:00 UY si corresponde)
  Llamada #1, +10, +20, +30 (mismo patrón de 4 intentos)

  Éxito → marcar alert.contactReached='patient', fin.
  Falla total → marcar alert.callsExhausted=true, visible en /admin/alerts.
```

**Reglas adicionales:**
- El **inicio** de cada Round respeta la ventana 9 AM UY (igual que el inicio de la alerta).
- Los 4 intentos dentro de un Round son rígidos cada 10 min, sin pausa por horario.
- "Éxito" se evalúa según §11.6 (completed + duration ≥ 5s + no fue máquina).

### A.5 Cambios al schema

`call_logs` agrega columna `roundNumber`:

```sql
ALTER TABLE call_logs ADD COLUMN roundNumber INTEGER NOT NULL DEFAULT 1;
-- 1 = Round 1 (emergency), 2 = Round 2 (emergency 4h después), 3 = Round 3 (patient)
```

`alerts` agrega campos para tracking de escalada:

```sql
ALTER TABLE alerts ADD COLUMN contactReached TEXT;
-- valores: 'emergency_round1', 'emergency_round2', 'patient', NULL si no contactado
ALTER TABLE alerts ADD COLUMN callsExhausted INTEGER NOT NULL DEFAULT 0;
-- 1 si los 12 intentos totales fallaron
ALTER TABLE alerts ADD COLUMN nextRoundStartAt TEXT;
-- ISO timestamp del próximo Round programado (para que el cron lo dispare)
```

### A.6 Mensaje TTS de Round 3 — al paciente

El TwiML de §11.2 se mantiene para Rounds 1 y 2. Para Round 3 (llamada al paciente), nuevo guión:

```xml
<Response>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">
    Hola {fullName}. Este es un aviso automático del sistema
    de seguimiento de tu medicación.
  </Say>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">
    Detectamos que no registraste tus tomas en los últimos días
    y tu contacto de emergencia no atendió nuestras llamadas.
    Por favor, abrí la aplicación, registrá tu toma y contactate
    con tu red de apoyo.
  </Say>
  <Pause length="2"/>
  <Say language="es-MX" voice="Polly.Mia">
    Repito: te pedimos que abras la aplicación y registres tu toma.
  </Say>
  <Pause length="1"/>
</Response>
```

El backend selecciona qué TwiML servir en `/api/twilio/twiml/:callLogId` según `roundNumber` del `call_log` correspondiente.

### A.7 lib/twilio.ts — cambios

Funciones nuevas/modificadas:

- `initiateCall(alertId, userId, toNumber, attemptNumber, roundNumber)` — agrega `roundNumber`.
- `scheduleNextRound(alertId, currentRound)` — al fallar el último intento de Round 1 o 2, calcula `T + 4h` (o `próximo 09:00 UY` si cae antes) y persiste en `alerts.nextRoundStartAt`.
- `triggerScheduledRounds()` — corre desde el cron cada minuto: busca `alerts WHERE nextRoundStartAt <= now AND contactReached IS NULL AND callsExhausted=0`, dispara primer intento del Round siguiente.
- El número y guión TTS por Round se resuelven dentro de `lib/twilio.ts`:
  - Round 1, 2 → `user.emergencyContactPhone`, TwiML §11.2
  - Round 3 → `user.patientPhone`, TwiML §A.6

### A.8 Renombrado del dominio

Todo el sistema corre en **`bipolar.tumvp.uy`** (no `mandarinasoftware.uy`). Cert Let's Encrypt emitido el 2026-04-22, expira 2026-07-21, renovación auto vía `certbot.timer`.

### A.9 Puerto

El container expone el puerto `3000` internamente, pero en el host se bindea a `127.0.0.1:3010` (el puerto 3000 está ocupado por UNRegalo). Nginx hace proxy a `127.0.0.1:3010`.

### A.10 Email From

`MAIL_FROM="Bipolar Alert <info@tumvp.uy>"` — dominio `tumvp.uy` debe estar verificado en Resend (DKIM + SPF) antes del primer envío. Si no está, agregar registros en hostingenlaweb.com (DNS de tumvp.uy).

### A.11 Criterios de aceptación nuevos / modificados

Reemplazan/agregan en §18:

- ✅ Form admin permite cargar `patientEmail` y `patientPhone` y rechaza email/E.164 inválido.
- ✅ A las 12 h de la `medicationTime` sin tap, `daily_status` queda en `missed` automáticamente (sin esperar al cron de 23:59).
- ✅ Una alerta disparada a las 03:00 UY agenda la primera llamada para las 09:00 UY del mismo día. El email sale inmediato.
- ✅ Round 1: 4 intentos cada 10 min al `emergencyContactPhone`. Si todos fallan, Round 2 arranca exactamente 4 h después del último fallo (ajustado a la próxima 09:00 si cae antes).
- ✅ Round 2: idéntico patrón. Si todos fallan, Round 3 arranca al `patientPhone` (con TwiML específico §A.6).
- ✅ Si los 12 intentos totales fallan: `alerts.callsExhausted=true` y badge 🔴 en `/admin/alerts`.
- ✅ Cualquier llamada exitosa cancela los pendientes (intentos del round actual + rounds futuros) y guarda `alerts.contactReached`.
- ✅ Reintentos sobreviven a `docker compose restart` (persistidos en `call_logs.nextRetryAt` + `alerts.nextRoundStartAt`).

---

**FIN DEL PRD**
