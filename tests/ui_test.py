"""Prueba de interfaz con Chrome sin pantalla: importa un KML, planifica, descarga el KMZ, carga fotos y toma capturas."""
import asyncio, io, json, os, subprocess, sys, time, zipfile, random
from playwright.async_api import async_playwright
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/tmp/ui'; os.makedirs(OUT, exist_ok=True)

# mosaico sintético para no depender de internet
random.seed(4)
t = Image.effect_noise((256, 256), 40).convert('RGB')
t = Image.blend(Image.new('RGB', (256, 256), (96, 118, 74)), t, 0.18).filter(ImageFilter.GaussianBlur(1.2))
buf = io.BytesIO(); t.save(buf, 'PNG'); TILE = buf.getvalue()

KML = '''<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Lote Casa Pastora</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-90.82000,14.66000,0 -90.81850,14.66000,0 -90.81830,14.66090,0 -90.81990,14.66110,0 -90.82000,14.66000,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>'''
open('/tmp/lote.kml', 'w').write(KML)

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errs = []
    try:
        async with async_playwright() as p:
            br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
            for name, vp in (('movil', {'width': 390, 'height': 844}), ('escritorio', {'width': 1280, 'height': 800})):
                ctx = await br.new_context(viewport=vp, accept_downloads=True, device_scale_factor=2 if name == 'movil' else 1,
                                           permissions=['geolocation'], geolocation={'latitude': 14.6605, 'longitude': -90.8192})
                async def tile(route):
                    await route.fulfill(status=200, content_type='image/png', body=TILE)
                await ctx.route('**/World_Imagery/**', tile)
                pg = await ctx.new_page()
                pg.on('console', lambda m: errs.append((name, m.type, m.text)) if m.type in ('error',) else None)
                pg.on('pageerror', lambda e: errs.append((name, 'pageerror', str(e))))
                await pg.goto('http://127.0.0.1:8765/index.html')
                await pg.wait_for_timeout(500)
                await pg.screenshot(path=f'{OUT}/{name}-1-inicio.png')
                # importar KML
                await pg.set_input_files('#panelBody input[type=file]', '/tmp/lote.kml')
                await pg.wait_for_timeout(600)
                txt = await pg.inner_text('#resumen')
                assert 'Área' in txt and 'manzanas' in txt, txt
                print(name, 'resumen:', txt.replace('\n', ' | ')[:160])
                await pg.screenshot(path=f'{OUT}/{name}-2-terreno.png')
                # misión
                await pg.click('#tabs >> text=Misión')
                await pg.wait_for_timeout(300)
                res = await pg.inner_text('#resMision')
                assert 'Baterías' in res and 'cm por píxel' in res, res
                print(name, 'mision:', res.replace('\n', ' | ')[:220])
                await pg.check('text=Mostrar el área que cubre cada foto')
                await pg.wait_for_timeout(300)
                await pg.screenshot(path=f'{OUT}/{name}-3-mision.png')
                if name == 'escritorio':
                    async with pg.expect_download() as dl:
                        await pg.click('.adap.rec button.primary')
                    d = await dl.value
                    path = f'{OUT}/{d.suggested_filename}'; await d.save_as(path)
                    z = zipfile.ZipFile(path); assert z.testzip() is None
                    print('KMZ descargado:', d.suggested_filename, z.namelist())
                    # cambiar a Mini 3 Pro: ya no ofrece KMZ de DJI Fly
                    await pg.select_option('#panelBody select >> nth=0', 'mini3pro')
                    await pg.wait_for_timeout(300)
                    cards = await pg.inner_text('#adaptadores')
                    assert 'DJI Fly (archivo KMZ)' not in cards and 'Litchi' in cards, cards
                    async with pg.expect_download() as dl:
                        await pg.click('.adap.rec button.primary')
                    d = await dl.value; await d.save_as(f'{OUT}/{d.suggested_filename}')
                    print('Litchi descargado:', d.suggested_filename)
                # fotos
                await pg.click('#tabs >> text=Fotos')
                fx = os.path.join(ROOT, 'tests/fixtures')
                await pg.set_input_files('#panelBody input[type=file]', [f'{fx}/foto1.jpg', f'{fx}/foto2.jpg', f'{fx}/sin_gps.jpg'])
                await pg.wait_for_timeout(700)
                ft = await pg.inner_text('#fotosRes')
                assert '3 (2 con GPS)' in ft, ft
                print(name, 'fotos:', ft.replace('\n', ' | ')[:200])
                await pg.screenshot(path=f'{OUT}/{name}-4-fotos.png')
                # vuelos
                await pg.click('#tabs >> text=Vuelos')
                await pg.check('text=Baterías del dron, del control y del teléfono cargadas')
                await pg.click('text=Guardar vuelo')
                await pg.wait_for_timeout(300)
                assert 'Casa Pastora' in (await pg.inner_text('#panelBody')) or 'Lote Casa Pastora' in (await pg.inner_text('#panelBody'))
                await pg.screenshot(path=f'{OUT}/{name}-5-vuelos.png')
                await pg.click('#tabs >> text=Ajustes')
                await pg.screenshot(path=f'{OUT}/{name}-6-ajustes.png')
                # dibujar a mano en un terreno nuevo
                await pg.click('#tabs >> text=Terreno')
                await pg.click('text=Nuevo')  # prompt
                await ctx.close()
            await br.close()
    finally:
        srv.terminate()
    print('ERRORES DE CONSOLA:', errs)
    return errs

errs = asyncio.run(main())
sys.exit(1 if [e for e in errs if 'prompt' not in e[2].lower()] else 0)
