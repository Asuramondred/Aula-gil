# AulaÁgil (Aplicación de Escritorio Local)

Aplicación de escritorio para Windows (`.exe`) 100% local para docentes de educación primaria. Permite gestionar listas de asistencia, expedientes digitales, trabajos en clase y tareas, conducta con apoyo de IA, bitácora diaria docente (con dictado por voz), ponderaciones independientes por trimestre y descarga de documentos **Word (`.docx`) editables**.

---

## Requisitos previos (en Windows)

- **Node.js 20 LTS o superior** ([nodejs.org](https://nodejs.org/))
- Conexión a internet **solo** si deseas usar las funciones de redacción con IA gratuita (el guardado de alumnos, asistencias, calificaciones, bitácoras y exportación a `.docx` funciona 100% sin internet).

---

## Instalación y ejecución local

1. Abre una terminal en la carpeta del proyecto e instala dependencias:
   ```bash
   npm install --legacy-peer-deps
   ```

2. Inicia el servidor y la aplicación en modo desarrollo web:
   ```bash
   npm run dev
   ```
   Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

3. Para probar la ventana de escritorio Electron en desarrollo (con `npm run dev` corriendo en otra terminal):
   ```bash
   npm run electron:dev
   ```

---

## Generar el ejecutable de Windows (`.exe`)

**Opción rápida (doble clic):**  
En Windows 10 u 11 (con Node.js instalado), haz doble clic en **`CREAR_INSTALADOR_WINDOWS.bat`**. Al terminar abrirá automáticamente la carpeta `release/`.

**Opción por terminal (PowerShell o CMD):**
Para compilar el frontend, empaquetar el servidor local en `dist-server/server.mjs` y generar el instalador `.exe` y versión portable dentro de la carpeta `release/`:

```bash
npm run electron:build
```

Al terminar encontrarás en `release/`:
- `AulaÁgil Setup 1.0.0.exe` (instalador estándar de Windows con acceso directo).
- `AulaÁgil 1.0.0.exe` (versión portable sin instalación).

---

## ¿Dónde se guardan los datos?

Toda la información se almacena de manera local y privada en tu computadora en formato JSON estructurado:

- **En Windows instalado (`.exe`):** `%APPDATA%\AulaÁgil\libreta-db.json`
- **En modo desarrollo (`npm run dev`):** `./data/libreta-db.json`

Desde la pestaña **Configuración** dentro de la app puedes:
- **Exportar respaldo completo (`.json`)** para guardar una copia en USB o nube personal.
- **Importar respaldo (`.json`)** para restaurar todos tus grupos y ciclos en otra PC.

---

## Configuración de IA (100% Local en Windows 10/11 o gratuita opcional)

AulaÁgil soporta **3 formas de usar la IA**, todas sin pagos obligatorios:

### Opción 1: IA 100% Local y Sin Internet con Ollama (Recomendado para privacidad)
Corre modelos directamente en tu PC con Windows 10 u 11, sin cuentas ni API keys:
1. Descarga e instala **Ollama para Windows** desde [ollama.com](https://ollama.com/download/windows).
2. Abre PowerShell o CMD y descarga un modelo ligero en español (~2 GB):
   ```bash
   ollama pull qwen2.5:3b
   ```
   *(Alternativas ligeras: `llama3.2:3b` o `gemma3:4b`)*
3. Dentro de **AulaÁgil → Configuración → Motor de IA**, haz clic en **"Detectar Ollama local"** y selecciona **Solo Ollama local** o **Automático**.

### Opción 2: Modo básico offline integrado (Sin instalar nada)
Si no instalas Ollama ni configuras llaves en la nube, el programa incluye un formateador local sin conexión para estructurar bitácoras, citatorios y evaluación base de conducta.

### Opción 3: Varias APIs con cambio automático al agotar tokens
En **Configuración → Motor de IA y cambio automático por tokens** puedes activar la opción **"Cambiar automáticamente al agotar tokens"** y ordenar con flechas tu cadena de respaldo (por ejemplo: **Google Gemini → Groq → OpenRouter → API compatible → Ollama local → Modo offline**):
- **Google Gemini:** Crea una llave gratuita en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) usando una cuenta personal `@gmail.com`.
- **Groq (`llama-3.3-70b-versatile`):** Crea una llave gratuita sin tarjeta en [console.groq.com/keys](https://console.groq.com/keys).
- **OpenRouter:** Llave gratuita con modelos `:free` en [openrouter.ai/keys](https://openrouter.ai/keys).
- **Otra API compatible con OpenAI:** DeepSeek, LM Studio local u otros servidores compatibles.
- *Tip:* Puedes pegar **varias llaves separadas por coma** en un mismo campo; si una se queda sin tokens (`429` / límite de cuota), AulaÁgil rota automáticamente a la siguiente llave o al siguiente proveedor de tu lista y lo guarda todo localmente en `libreta-keys.json`.
