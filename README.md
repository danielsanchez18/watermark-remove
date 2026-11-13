# Markless

Herramienta local para **detectar y limpiar marcas de IA** (caracteres ocultos, firmas visibles, co-author) en los archivos cambiados de tu repo git.

> **Transparencia:** la marca *estadística* (elección de palabras de Claude/OpenAI) **no es detectable ni limpiable** con esta herramienta. Markless trabaja solo sobre **bytes** del archivo.

## Requisitos

- Node.js 18+
- Un repo git

## Instalación

```bash
git clone https://github.com/danielsanchez18/watermark-remove.git
cd watermark-remove
npm install
```

## Uso

Abre Markless **en la carpeta de tu proyecto** (donde está el `.git`):

```bash
node C:\ruta\a\watermark-remove\bin\markless.js ui
```

O desde la raíz de este repo con:

```bash
npm run ui
```

Se abre en **http://localhost:1806**

### Opciones

```text
markless ui [opciones]     Arranca la interfaz web (por defecto)
markless help              Muestra la ayuda

-p, --port <puerto>        Puerto (por defecto 1806)
```

También puedes fijar el puerto en `.markless/config.json` (se crea al primer arranque):

```json
{ "port": 1806 }
```

## Flujo de trabajo

1. **Trabaja con tu IA** como siempre (commits normales).
2. Abre Markless en tu repo → pestaña **Cambios**.
3. **Analizar cambios** → lista los archivos modificados desde el último commit y detecta marcas.
4. **Limpiar todo** (o **Limpiar** por archivo) → reescritura local con script, sin usar otra IA.
5. **Analizar de nuevo** → verifica que no queden marcas.
6. Haz tu **commit** normal (o usa *Amend último commit* si la marca ya está en el último commit).

### Badges

| Badge | Significado |
|---|---|
| 🟢 **Limpio** | Pasó todas las comprobaciones de Markless (0 marcas en bytes) |
| 🔵 **Limpiado** | Markless reescribió el archivo y quitó marcas |
| 🟡 **Pendiente** | Hay marcas sin limpiar |

El botón **Limpiar** / **Limpiar todo** siempre está disponible, aunque el archivo esté limpio (entonces solo verifica).

## Qué detecta

- Caracteres invisibles / zero-width (ZWSP, ZWNJ, ZWJ, WJ…)
- Marcas bidireccionales (bidi)
- Espacios y guiones inusuales
- Firmas de generadores (`Generated with Claude Code`, `Co-Authored-By`, etc.)

## Desarrollo

```bash
npm run dev          # desarrollo
npm run typecheck    # TypeScript
npm run engine:test  # tests del motor (scan/clean/git)
npm run build        # build de producción
```

## Estructura

```text
bin/markless.js      CLI (arranca el servidor con tsx)
src/engine/          escáner, limpieza, git, estado, jobs
src/server/          API Express + SSE de progreso
src/components/      UI React (reporte, diff, progreso)
test/engine/         tests del motor
```

## Licencia

MIT
