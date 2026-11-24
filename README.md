# CEI Drone Studio v0.1

Planificador de vuelos de dron para terrenos. Funciona en el navegador (oficina y celular), se instala como app (PWA) y no necesita servidor.

Se integra con **My ArQ** (puntos GPS del terreno) y **Modeler My ArQ** (contornos), y está hecha para sumar otras marcas de dron más adelante.

## Qué hace hoy

| Pestaña | Función |
|---|---|
| **Terreno** | Dibuja el contorno sobre el mapa satelital o importa KML/KMZ, GeoJSON, CSV de puntos o el JSON de Modeler My ArQ (acepta coordenadas GTM y lat/lon). Muestra área en m², manzanas y varas², y perímetro. |
| **Misión** | Calcula líneas de vuelo y fotos con solape frontal/lateral, altura, velocidad y detalle en el suelo (cm por píxel). Divide la misión por baterías. |
| **Fotos** | Lee el EXIF de las fotos del vuelo y revisa qué parte del terreno quedó cubierta y dónde hay huecos. Incluye las opciones recomendadas para WebODM. |
| **Vuelos** | Checklist previo al vuelo y bitácora (exporta a CSV). |
| **Ajustes** | Respaldo y restauración, base del mapa, datos de cámara. |

Todo se guarda en el navegador del equipo (localStorage). Usa **Ajustes → Respaldo** para pasar datos de la oficina al celular.

## Qué exporta, según el dron

| Dron | Formato recomendado | Cómo se vuela |
|---|---|---|
| **Mini 4 Pro** | `.kmz` (misión de waypoints de DJI Fly) | Ver sección DJI Fly |
| **Mini 3 / Mini 3 Pro** | `.csv` de Litchi | Con la app Litchi Pilot (Android) |
| Cualquiera | `.kml` y CSV de puntos | Para verlos en Google Earth o importarlos en otra app |

> **Importante:** DJI Fly no tiene botón para importar misiones. El método del KMZ no es oficial, así que la **primera vez haz un vuelo corto de prueba** (un terreno pequeño, a poca altura, con vista directa al dron). Las alturas del KMZ se interpretan relativas al punto de despegue y esto no se ha verificado con un dron real.

### Cargar el KMZ en DJI Fly (Mini 4 Pro, Android)

1. En DJI Fly crea una misión de waypoints cualquiera con 2 puntos y guárdala.
2. Conecta el celular a la computadora y abre `Android/data/dji.go.v5/files/waypoint`.
3. Busca la carpeta de la misión que acabas de guardar y reemplaza su archivo `.kmz` por el que descargaste de CEI Drone Studio (con el mismo nombre del archivo original).
4. Abre la misión en DJI Fly, revisa la ruta en el mapa y la altura, y vuela.

### Usar Litchi (Mini 3 / Mini 3 Pro)

1. Descarga el CSV de Litchi desde la pestaña Misión.
2. Impórtalo en el planificador web de Litchi (flylitchi.com → Missions → Import), o en la app Litchi Pilot.
3. Revisa altura y velocidad. El CSV trae solo los extremos de cada línea y le pide a Litchi tomar una foto cada cierta distancia.

## Del vuelo a la ortofoto y las curvas de nivel

1. Vuela la misión y copia las fotos a la computadora.
2. En la pestaña **Fotos** carga las fotos y revisa la cobertura. Si faltan líneas, repite esa parte.
3. Procesa las fotos en **WebODM** (gratis, instalable en tu computadora). Usa las opciones que sugiere la pestaña Fotos: `dsm`, `dtm`, `orthophoto-resolution`, `dem-resolution`, `auto-boundary`, entre otras.
4. WebODM entrega la ortofoto (GeoTIFF), el modelo de elevación y las curvas de nivel.

## Límites que debes conocer

- **Precisión:** un dron de consumo sin RTK ni puntos de control tiene errores de metros en posición absoluta. Sirve para planificar, medir de forma aproximada y mostrar al cliente. **No reemplaza un levantamiento topográfico** para trámites.
- Los puntos de My ArQ (±5 m) no mejoran esa precisión.
- Datos de cámara (distancia focal, megapíxeles) de cada modelo son aproximados y se pueden editar en Misión → Ajustar datos de la cámara.
- **Control y telemetría en vivo** no están en esta versión. Una web no puede hablar con un dron DJI. Eso requiere una app Android nativa con DJI Mobile SDK V5 (fase 3). En iPhone no es posible el control en vivo con DJI.
- Probada con pruebas automáticas y en navegador de escritorio y móvil simulado. **No se ha probado con un dron real ni en un iPhone.**
- El mapa satelital necesita internet. Las teselas que ya viste se guardan para uso sin señal, pero solo las de zonas ya visitadas.

## Publicar (Cloudflare Workers, como tus otras apps)

1. Crea un repositorio en GitHub (por ejemplo `NBARILLAS28/cei-drone-studio`) y sube todo el contenido de esta carpeta.
2. En Cloudflare: Workers & Pages → Create → Import a repository → elige el repositorio.
3. Deja el comando de compilación vacío. El archivo `wrangler.jsonc` ya indica que se publica la carpeta tal cual.
4. Abre la URL en el celular y usa "Agregar a pantalla de inicio" para instalarla.

Para probar en tu computadora: `python3 -m http.server 8000` dentro de la carpeta y abre `http://localhost:8000`.

## Estructura

```
index.html           pantalla y estilos
js/geo.js            coordenadas GTM, áreas, distancias
js/mission.js        planificador de misión y baterías
js/export.js         KMZ (WPML), CSV de Litchi, KML, CSV de puntos
js/adapters.js       qué formato usa cada dron
js/importers.js      KML, GeoJSON, CSV, Modeler My ArQ
js/exif.js           lectura de GPS y altura de fotos
js/fotos.js          cobertura y huecos
js/map.js            mapa propio con teselas
js/app.js            interfaz
tests/               pruebas (node --test tests/core.test.js, python3 tests/ui_test.py)
```

## Hoja de ruta

1. **Fase 2:** conectar con WebODM/NodeODM por API; devolver curvas de nivel y ortofoto a Modeler My ArQ y Virtual ARQ.
2. **Fase 3:** app Android nativa con DJI Mobile SDK V5 para control y telemetría en vivo (Mini 3, Mini 3 Pro, Mini 4 Pro).
3. **Fase 4:** otras marcas (MAVLink: ArduPilot, PX4) y respaldo en la nube con Supabase.
