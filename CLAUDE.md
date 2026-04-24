# Bipolar — Sistema de seguimiento de medicación

PWA Next.js para registrar la toma diaria de medicación con un solo tap. Si un paciente acumula 3 incidentes (tarde > 4h o no tomado) en 7 días, dispara alertas automáticas: email al contacto de emergencia con historial Excel + audios adjuntos, y escalada de llamadas Twilio con TTS en español.

**Producción:** https://bipolar.tumvp.uy/
**Repo:** https://github.com/fcarry/bipolar

---

## 1. Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 (alpine), Next.js 15 App Router (output: standalone) |
| UI | React 19 + Tailwind 3.4 + componentes propios (Button/Input en `src/components/ui/`) |
| DB | SQLite con `better-sqlite3` (WAL, foreign_keys=ON), Drizzle ORM |
| Auth | JWT (HS256, sin `exp`) + bcrypt 12 + tabla `sessions` con `tokenHash` para revocación |
| Audio | WebRTC `MediaRecorder` (`audio/webm;codecs=opus`) en cliente; archivo persistido en `/app/data/audio/{userId}/{logId}.webm` |
| Email | Resend (`resend` SDK) — adjuntos: Excel + audios `.webm` últimos 7 días, cap 40MB total |
| Reportes | ExcelJS (3 hojas: Historial / Gráfica / Resumen) |
| Llamadas | Twilio Voice (`calls.create` con TwiML inline + status callback). Acepta auth por **Auth Token** o **API Key + Secret** |
| Cron | `node-cron`, scheduler en `src/lib/cron.ts`, arranca desde `src/instrumentation.ts` |
| TTS | Amazon Polly via Twilio (`<Say voice="Polly.Mia" language="es-MX">`) |
| Gráficos | Recharts (scatter delay-vs-día con colores por estado) |
| PWA | Manifest + service worker manual con IndexedDB queue para POSTs offline |
| Validación | Zod en todos los endpoints |
| Container | Multi-stage Dockerfile, runtime user `bipolar` uid 1001, TZ `America/Montevideo` |
| Reverse proxy | Nginx (vhost en `nginx/bipolar.tumvp.uy.conf`, sincronizado por autodeploy) |

---

## 2. Documentos canónicos

- **`PRD.md`** — especificación funcional original (secciones 1–20).
- **`PRD.md` Anexo A** (al final del archivo) — cambios consensuados 2026-04-22:
  - Campos `patientEmail` + `patientPhone` en `users`.
  - Definición de "missed" con deadline duro de 12h post-`scheduledFor`.
  - Ventana de llamadas: ≥ 09:00 America/Montevideo (límite inferior, sin superior).
  - Escalada en **3 rounds** (R1/R2 → emergencia, R3 → paciente), cada uno con 4 intentos cada 10 min, gap de 4h entre rounds.
  - TwiML específico para Round 3 (mensaje al propio paciente).
  - Schema deltas: `call_logs.roundNumber`, `alerts.contactReached/callsExhausted/nextRoundStartAt`.

**En conflicto entre PRD original y Anexo A, gana el Anexo A.**

---

## 3. Estructura del repo

```
.
├── Dockerfile                      # Multi-stage Node 20-alpine, output standalone
├── docker-compose.yml              # Bind 127.0.0.1:3010 → container :3000, vol ./data
├── .dockerignore
├── .env.example                    # Plantilla de env (sin valores reales)
├── PRD.md                          # PRD + Anexo A
├── nginx/
│   └── bipolar.tumvp.uy.conf       # Vhost (sincronizado al host por autodeploy)
├── public/
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Service worker (cache + offline queue)
│   └── icons/                      # PWA icons 192/512
├── drizzle/                        # placeholder (no usamos drizzle-kit; schema se crea con CREATE IF NOT EXISTS)
├── src/
│   ├── instrumentation.ts          # Startup: initSchema + seedAdmin + startCron
│   ├── app/
│   │   ├── layout.tsx              # Root layout + PWARegister
│   │   ├── page.tsx                # Redirect según rol/auth
│   │   ├── login/page.tsx
│   │   ├── (app)/                  # route group para usuarios autenticados
│   │   │   ├── layout.tsx          # AuthGate require="user" + HamburgerMenu
│   │   │   ├── home/page.tsx       # Botón gigante
│   │   │   ├── history/page.tsx
│   │   │   └── chart/page.tsx
│   │   ├── admin/
│   │   │   ├── layout.tsx          # AuthGate require="admin"
│   │   │   ├── page.tsx            # Lista usuarios
│   │   │   ├── users/new/page.tsx
│   │   │   ├── users/[id]/page.tsx
│   │   │   └── alerts/page.tsx
│   │   └── api/
│   │       ├── health/route.ts                    # Docker healthcheck
│   │       ├── auth/{login,logout,me}/route.ts
│   │       ├── logs/{route.ts,today,chart,[id]/audio}
│   │       ├── admin/users/{route.ts,[id]/route.ts}
│   │       ├── admin/alerts/{route.ts,[id]/excel,[id]/retry-call}
│   │       └── twilio/{twiml,status}/[callLogId]/[secret]/route.ts
│   ├── components/                 # BigButton, LateModal, AudioRecorder, AuthGate, HamburgerMenu, HistoryTable, MedicationChart, UserForm, PWARegister
│   ├── components/ui/              # Button, Input/Label/Textarea
│   └── lib/
│       ├── time.ts                 # Utilidades UY (CRÍTICO — todo pasa por acá)
│       ├── db/{index.ts,schema.ts,seed.ts}
│       ├── auth.ts                 # JWT + bcrypt + ApiError + requireUser/requireAdmin
│       ├── validation.ts           # Schemas Zod
│       ├── mailer.ts               # Resend wrapper
│       ├── excel.ts                # ExcelJS (3 hojas)
│       ├── alerts.ts               # Detección 3-en-7 + dispatch + 12h missed
│       ├── twilio.ts               # 3-rounds escalation + cron poller + webhook validation
│       ├── cron.ts                 # node-cron scheduling
│       ├── client/api.ts           # Cliente HTTP (token desde localStorage)
│       └── utils.ts                # cn() helper
└── package.json
```

---

## 4. Variables de entorno

Ver `.env.example` para la plantilla completa. Resumen:

| Var | Requerida | Notas |
|---|---|---|
| `NODE_ENV` | sí | `production` |
| `PORT` | sí | Container interno, default `3000` |
| `APP_URL` | sí | Usada para construir URLs de webhook Twilio. **Debe coincidir con la URL pública**. |
| `DATABASE_PATH` | sí | Default `/app/data/bipolar.db` |
| `JWT_SECRET` | sí | Min 32 chars random. `openssl rand -base64 64`. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | sí | Solo para el seed inicial; no hace efecto si ya existe un admin. |
| `RESEND_API_KEY` | recomendado | Sin esto, los emails se omiten silenciosamente con warning. |
| `MAIL_FROM` | sí | Dominio debe estar verificado (DKIM/SPF) en Resend. |
| `TWILIO_ACCOUNT_SID` | sí (para llamadas) | `AC…` 32 chars |
| `TWILIO_AUTH_TOKEN` **O** `TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET` | sí (para llamadas) | Auth Token habilita validación HMAC de webhooks; API Key obliga a usar `TWILIO_WEBHOOK_SECRET` |
| `TWILIO_FROM_NUMBER` | sí (para llamadas) | E.164 |
| `TWILIO_WEBHOOK_SECRET` | sí cuando no hay Auth Token | Random 24 bytes hex (`openssl rand -hex 24`) |
| `TZ` | sí | **Siempre** `America/Montevideo` |

Si `TWILIO_*` están en placeholder (`ACxxxx…`, `xxxx…`, `+10000000000`), las alertas igual se generan y los emails salen, pero las llamadas se marcan como `failed` con `errorCode=NO_TWILIO_CREDS` y el pipeline avanza solo (todos los rounds y attempts pasan a `failed` instantáneamente).

---

## 5. Flujo de alerta (lógica de escalada)

Cuando se detecta que un paciente acumuló ≥3 incidentes (`late` o `missed`) en los últimos 7 días calendario UY, y no hay alerta previa en las últimas 24h:

```
T+00:00  → Email contacto emergencia (Excel + audios) + email aviso paciente
         → Si hora UY ≥ 09:00 dispara llamada Round 1 attempt 1; sino agenda nextRoundStartAt = next 09:00 UY

Round 1 (a emergencyContactPhone, TwiML emergencia)
  T+00:00  llamada #1
  T+00:10  llamada #2  (si #1 → no-answer/busy/failed/canceled)
  T+00:20  llamada #3
  T+00:30  llamada #4
  → Si cualquiera completed Y duration≥5s Y answeredBy ≠ machine_*:
       contactReached = "emergency_round1", fin
  → Si los 4 fallan: agenda Round 2 a T+04:30 (ajustado a próximo 09:00 si cae antes)

Round 2 (mismo número, mismo TwiML)
  T+04:30  llamada #1
  T+04:40  #2
  T+04:50  #3
  T+05:00  #4
  → Si éxito: contactReached = "emergency_round2", fin
  → Si fallan: agenda Round 3 a T+05:00 (ajustado 09:00 UY)

Round 3 (a patientPhone, TwiML al paciente)
  Mismo patrón 4 intentos cada 10 min
  → Si éxito: contactReached = "patient", fin
  → Si fallan: callsExhausted = true (visible en /admin/alerts)
```

**Persistencia:** `call_logs.nextRetryAt` (próxima llamada del round actual) y `alerts.nextRoundStartAt` (cuándo arrancar el siguiente round). El cron cada minuto despacha lo que esté `<= now`. Sobrevive a `docker restart`.

**Detección de "12h missed":** el cron también revisa cada minuto si algún paciente cumplió 12h post-`scheduledFor` sin log; si sí, upsertea `daily_status='missed'` y reevalúa la ventana.

---

## 6. Webhooks Twilio

Las URLs de callback que generamos son:

- TwiML (qué decir): `POST {APP_URL}/api/twilio/twiml/{callLogId}/{webhookSecret}`
- Status (eventos): `POST {APP_URL}/api/twilio/status/{callLogId}/{webhookSecret}`

El `webhookSecret` viene de `TWILIO_WEBHOOK_SECRET`. **Validación de autenticidad:**

- Si `TWILIO_AUTH_TOKEN` está configurado → usa `twilio.validateRequest()` con HMAC-SHA1 (mecanismo nativo).
- Si solo está `TWILIO_API_KEY_SID/SECRET` → cae al path-based secret (compara `req.params.secret === TWILIO_WEBHOOK_SECRET`).

El path-secret es seguro mientras el secret tenga ≥16 chars de entropía y el dominio use HTTPS (no se filtra en logs estándar de nginx si ponés `access_log` que no incluya path completo). Para mayor seguridad, conseguir el Auth Token y borrar el path-secret.

---

## 7. Schema (resumen — ver `src/lib/db/schema.ts` para tipos exactos)

```
users(id, username UNIQUE, passwordHash, fullName, role[admin|user],
      medicationTime, patientEmail, patientPhone,
      emergencyContactEmail, emergencyContactPhone,
      createdAt, updatedAt)

medication_logs(id, userId FK, takenAt, scheduledFor, delayMinutes, isLate,
                description, audioPath, createdAt)
  - audioPath = "/app/data/audio/{userId}/{logId}.webm"
  - isLate = 1 si delayMinutes > 240

daily_status(id, userId FK, date 'YYYY-MM-DD' UY, status[ontime|late|missed],
             logId FK?, createdAt)  UNIQUE(userId, date)

alerts(id, userId FK, triggeredAt, reason, emailsSentTo JSON,
       excelPath, audioLogIds JSON, audioAttachmentCount, audioSkippedForSize,
       contactReached[null|emergency_round1|emergency_round2|patient],
       callsExhausted, nextRoundStartAt, createdAt)

call_logs(id, alertId FK, userId FK, toNumber, twilioCallSid,
          attemptNumber, roundNumber, status, duration, answeredBy,
          errorCode, errorMessage,
          scheduledAt, nextRetryAt, completedAt, createdAt)

sessions(id, userId FK, tokenHash sha256(jwt), createdAt, revokedAt?)
```

Todas las fechas se guardan como `TEXT` ISO 8601 con offset `-03:00` (UY). El schema se crea idempotentemente al startup (`CREATE TABLE IF NOT EXISTS`) — no se usa drizzle-kit ni migraciones SQL versionadas.

---

## 8. Deploy

Este repo está registrado en el **autodeploy del servidor** (`/opt/autodeploy/services.conf`):

```
Bipolar|git@github.com:fcarry/bipolar.git|main|false|docker-compose.yml|true
```

Cualquier push a `main` se despliega solo dentro de los próximos 10 min (cron del usuario `deploy`). Para forzar deploy inmediato:

```bash
sudo -u deploy /opt/autodeploy/autodeploy.sh Bipolar
```

El script: `git pull` → `docker compose -f docker-compose.yml up -d --build --remove-orphans` → sincroniza `nginx/*.conf` a `/etc/nginx/sites-enabled/` → `nginx -t && reload`.

---

## 9. Observabilidad / debugging

```bash
# Logs container (live)
sudo -u deploy docker logs -f bipolar-app

# Estado de alertas + retries pendientes
sudo sqlite3 /opt/repos/Bipolar/data/bipolar.db "
  SELECT a.id, a.triggeredAt, a.contactReached, a.callsExhausted, a.nextRoundStartAt,
         (SELECT COUNT(*) FROM call_logs WHERE alertId=a.id) AS attempts
  FROM alerts a ORDER BY triggeredAt DESC LIMIT 10;"

# Últimos call_logs
sudo sqlite3 /opt/repos/Bipolar/data/bipolar.db "
  SELECT substr(id,1,8), roundNumber, attemptNumber, status, duration, scheduledAt, nextRetryAt
  FROM call_logs ORDER BY scheduledAt DESC LIMIT 20;"

# Cancelar todos los reintentos pendientes de una alerta
sudo sqlite3 /opt/repos/Bipolar/data/bipolar.db "
  UPDATE call_logs SET nextRetryAt=NULL WHERE alertId='<alertId>';
  UPDATE alerts SET nextRoundStartAt=NULL, callsExhausted=1 WHERE id='<alertId>';"

# Reset admin password (genera hash bcrypt e inserta)
HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'NEWPASS', bcrypt.gensalt(12)).decode())")
sudo sqlite3 /opt/repos/Bipolar/data/bipolar.db "
  UPDATE users SET passwordHash='$HASH', updatedAt=datetime('now') WHERE role='admin';"

# Listar emails recientes en Resend
curl -H "Authorization: Bearer $RESEND_API_KEY" "https://api.resend.com/emails?limit=10"
```

---

## 10. Permisos del volumen `data/`

El container corre como uid `1001` (user `bipolar` interno del Dockerfile). El bind mount a `./data` se hereda con el ownership del host, NO con el chown del Dockerfile. En la máquina actual coincide con el uid del usuario `deploy`, pero si por algún motivo la DB tira `SQLITE_CANTOPEN`, ejecutar:

```bash
sudo chown -R 1001:1001 /opt/repos/Bipolar/data
sudo -u deploy docker restart bipolar-app
```

---

## 11. Test end-to-end manual

```bash
# 1. Login admin
TOKEN=$(curl -s -X POST https://bipolar.tumvp.uy/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<adminpass>"}' | jq -r .token)

# 2. Crear paciente test
curl -s -X POST https://bipolar.tumvp.uy/api/admin/users \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test12345","fullName":"Test","medicationTime":"00:01",
       "patientEmail":"you@email.com","patientPhone":"+5989...",
       "emergencyContactEmail":"contact@email.com","emergencyContactPhone":"+5989..."}'

# 3. Simular 2 días missed previos via SQL (today UY = $(date -u -d "now -3 hours" +%F))
USER_ID="<id devuelto>"
sudo sqlite3 /opt/repos/Bipolar/data/bipolar.db "
  INSERT INTO daily_status VALUES ('m1','$USER_ID','2026-04-21','missed',NULL,datetime('now'));
  INSERT INTO daily_status VALUES ('m2','$USER_ID','2026-04-20','missed',NULL,datetime('now'));"

# 4. Login como paciente y POST log tarde → triggera alerta
UTOK=$(curl -s -X POST https://bipolar.tumvp.uy/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test12345"}' | jq -r .token)
curl -s -X POST https://bipolar.tumvp.uy/api/logs \
  -H "Authorization: Bearer $UTOK" -F "description=test alerta"

# 5. Ver lo que pasó
sudo -u deploy docker logs --since 10s bipolar-app | grep -E "twilio|alert"
```

---

## 12. Pendientes / mejoras conocidas

- **`TWILIO_AUTH_TOKEN`**: cuando esté disponible, cargarlo y la validación HMAC reemplaza al path-secret automáticamente.
- **Geo-permissions Twilio**: requiere habilitar países destino manualmente en consola (Voice → Settings → Geo Permissions).
- **Reset admin desde UI**: actualmente la API rechaza editar admins (`/api/admin/users/[id]` PATCH a admin → 403); cambiar password requiere SQL directo. Si se necesita, agregar `/api/admin/me/password`.
- **Audio playback en historial**: el link descarga el audio y lo abre en el reproductor del navegador, pero no tiene UI inline.
- **Service worker offline queue**: implementado pero no testeado en producción real (poner el celular en modo avión → tap → reconectar → debería sincronizar).
- **Healthcheck Docker**: usa `wget --spider`, podría dar falsos negativos si el contenedor es muy lento al boot. `start_period: 30s` lo cubre.

---

## 13. Reset visual de botones "TOMÉ LOS REMEDIOS" / "ME DESPERTÉ" a 12 h

**Desde 2026-04-24 (commit `d47df43`).** Antes los dos botones grandes del home quedaban en estado "apretado" (verde con ✔, `disabled`) hasta medianoche UY. Ahora vuelven al estado natural (azul/amarillo, habilitados) **12 h después de la pulsación registrada**.

**Implementación:** `src/app/api/logs/today/route.ts` y `src/app/api/wakes/today/route.ts`. Constante `RESET_AFTER_MS = 12 * 60 * 60 * 1000`. Si `Date.now() - takenAt` (o `wokeAt`) supera esa ventana, el endpoint devuelve `status: "pending"` y omite el `log`, lo que hace que el `BigButton` renderice el estado natural.

**Efecto de una segunda pulsación el mismo día UY:**
- Medicación: `POST /api/logs` inserta un nuevo `medication_logs` y hace UPDATE de `daily_status.logId` apuntando al log más reciente. Historia completa conservada en `medication_logs`. El cron de alertas sigue viendo el `daily_status` del día correctamente.
- Despertar: `POST /api/wakes` inserta un nuevo `wake_logs`, pero el handler **solo inserta `daily_wake_status` cuando no existe**, así que el registro diario sigue apuntando al PRIMER wake log del día (inconsistencia menor preexistente, no causada por este cambio). Si se necesita que refleje la última pulsación, cambiar el `if (!existingDS)` a un UPDATE en `src/app/api/wakes/route.ts`.

**Polling:** el home (`BigButton.tsx`) llama a ambos endpoints cada 60s, así que el reset visual ocurre dentro de ~1 min de cumplidas las 12 h.

**El cron de alertas y el rollup diario no se ven afectados**: leen directamente `daily_status` / `daily_wake_status`, no los endpoints `/today`.
