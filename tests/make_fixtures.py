"""Genera JPEG de prueba con EXIF (GPS, lente) y XMP estilo DJI usando PIL (escritor independiente del lector)."""
import struct, sys, os
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

out = os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(out, exist_ok=True)

def dms(v):
    d = int(v); m = int((v - d) * 60); s = (v - d - m / 60) * 3600
    return (IFDRational(d, 1), IFDRational(m, 1), IFDRational(round(s * 10000), 10000))

def make(name, lat, lon, alt, rel, with_xmp=True, with_gps=True):
    im = Image.new('RGB', (64, 48), 'gray')
    ex = Image.Exif()
    ex[0x010F] = 'DJI'; ex[0x0110] = 'FC3682'
    e = ex.get_ifd(0x8769)
    e[0x9003] = '2026:11:20 10:15:30'; e[0xA405] = 24; e[0xA002] = 4000; e[0xA003] = 3000
    if with_gps:
        g = ex.get_ifd(0x8825)
        g[1] = 'N' if lat >= 0 else 'S'; g[2] = dms(abs(lat))
        g[3] = 'E' if lon >= 0 else 'W'; g[4] = dms(abs(lon))
        g[5] = 0; g[6] = IFDRational(int(alt * 100), 100)
    path = os.path.join(out, name)
    im.save(path, exif=ex)
    if with_xmp:
        xmp = (f'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
               f'<rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" drone-dji:AbsoluteAltitude="+{alt:.2f}" '
               f'drone-dji:RelativeAltitude="+{rel:.2f}" drone-dji:FlightYawDegree="+45.30" drone-dji:GimbalPitchDegree="-90.00"/></rdf:RDF></x:xmpmeta>').encode()
        head = b'http://ns.adobe.com/xap/1.0/\x00'
        seg = b'\xff\xe1' + struct.pack('>H', len(head) + len(xmp) + 2) + head + xmp
        data = open(path, 'rb').read()
        open(path, 'wb').write(data[:2] + seg + data[2:])

make('foto1.jpg', 14.66110, -90.81970, 1800.5, 80.04)
make('foto2.jpg', 14.66125, -90.81955, 1800.7, 80.10)
make('sin_gps.jpg', 0, 0, 0, 0, with_xmp=False, with_gps=False)
print('fixtures ok')
