import { createServer, type Server } from 'node:http';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { verificarFirmaAviso } from '@/lib/api-cobros';

import { autorizaProcesado, comprobarAvisoGuardable, esDireccionNoPublica, publicarAviso, type Direccion } from './avisos';

// Address rules of the notices. The resolver is replaced: no test depends on DNS. The local receiver is the only
// server a notice reaches, and only in development.

const PUBLICA: Direccion[] = [{ address: '93.184.216.34', family: 4 }];
const PRIVADA: Direccion[] = [{ address: '10.0.0.5', family: 4 }];

// A resolver that answers in turn with each list it was given, and counts its calls.
function resolutor(...respuestas: Direccion[][]) {
  const llamadas = { n: 0 };
  let turno = 0;
  const buscar = async (): Promise<Direccion[]> => {
    llamadas.n++;
    return respuestas[Math.min(turno++, respuestas.length - 1)];
  };
  return { buscar, llamadas };
}

describe('direcciones de aviso que se rechazan al guardar (producción)', () => {
  const formas: Record<string, string> = {
    'IPv4 en decimal': 'https://2130706433/aviso',
    'IPv4 en hexadecimal': 'https://0x7f000001/aviso',
    'IPv4 en octal': 'https://0177.0.0.1/aviso',
    'IPv4 con partes cortas': 'https://127.1/aviso',
    'IPv4 mapeada en IPv6 (decimal)': 'https://[::ffff:127.0.0.1]/aviso',
    'IPv4 mapeada en IPv6 (hexadecimal)': 'https://[::ffff:7f00:1]/aviso',
    'IPv6 loopback': 'https://[::1]/aviso',
    'IP pública escrita como literal': 'https://93.184.216.34/aviso',
    'metadatos de nube en IPv4': 'https://169.254.169.254/latest/meta-data/',
    'metadatos de nube en IPv6': 'https://[fd00:ec2::254]/',
    'nombre de metadatos de Google': 'https://metadata.google.internal/',
    'localhost en producción': 'https://localhost/aviso',
    'localhost con punto final': 'https://localhost./aviso',
    'http en producción': 'http://market.ejemplo.com/aviso',
    'usuario y clave en la dirección': 'https://usuario:clave@market.ejemplo.com/aviso',
    'puerto inusual': 'https://market.ejemplo.com:8443/aviso',
    'nombre de una sola etiqueta': 'https://interno/aviso',
  };

  for (const [forma, url] of Object.entries(formas)) {
    it(`rechaza ${forma}`, async () => {
      const { buscar } = resolutor(PUBLICA);
      const resultado = await comprobarAvisoGuardable(url, { desarrollo: false, resolutor: buscar });
      expect(resultado.ok).toBe(false);
    });
  }

  it('acepta https con nombre público que resuelve a direcciones públicas', async () => {
    const { buscar } = resolutor(PUBLICA);
    const resultado = await comprobarAvisoGuardable('https://market.ejemplo.com/avisos', { desarrollo: false, resolutor: buscar });
    expect(resultado.ok).toBe(true);
  });

  it('rechaza si cualquiera de sus direcciones es privada, aunque las demás sean públicas', async () => {
    const { buscar } = resolutor([...PUBLICA, { address: '192.168.1.10', family: 4 }]);
    const resultado = await comprobarAvisoGuardable('https://market.ejemplo.com/avisos', { desarrollo: false, resolutor: buscar });
    expect(resultado.ok).toBe(false);
  });

  it('rechaza un nombre que no resuelve', async () => {
    const resultado = await comprobarAvisoGuardable('https://market.ejemplo.com/avisos', {
      desarrollo: false,
      resolutor: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    expect(resultado.ok).toBe(false);
  });

  it('en desarrollo acepta http hacia localhost, sin buscar nada', async () => {
    const { buscar, llamadas } = resolutor(PUBLICA);
    const resultado = await comprobarAvisoGuardable('http://localhost:4325/aviso', { desarrollo: true, resolutor: buscar });
    expect(resultado.ok).toBe(true);
    expect(llamadas.n).toBe(0);
  });

  it('en desarrollo sigue rechazando https hacia localhost', async () => {
    const { buscar } = resolutor(PUBLICA);
    const resultado = await comprobarAvisoGuardable('https://localhost/aviso', { desarrollo: true, resolutor: buscar });
    expect(resultado.ok).toBe(false);
  });
});

describe('direcciones resueltas que no son públicas', () => {
  const noPublicas = [
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '240.0.0.1',
    '203.0.113.5',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    '::ffff:8.8.8.8',
    '::ffff:7f00:1',
    '::8.8.8.8',
    '64:ff9b::808:808',
    '2002:0a00:0001::',
    '2001:db8::1',
  ];
  for (const ip of noPublicas) {
    it(`${ip} no es pública`, () => {
      expect(esDireccionNoPublica(ip)).toBe(true);
    });
  }

  it('las direcciones públicas pasan', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) expect(esDireccionNoPublica(ip)).toBe(false);
  });
});

describe('el envío se revisa al conectar', () => {
  it('un nombre que resuelve a una dirección privada en el momento de conectar se rechaza', async () => {
    // Save time sees a public address; the connection sees a private one. The connection is the check that counts.
    const { buscar, llamadas } = resolutor(PUBLICA, PRIVADA);
    const guardado = await comprobarAvisoGuardable('https://rebind.ejemplo.com/aviso', { desarrollo: false, resolutor: buscar });
    expect(guardado.ok).toBe(true);
    await expect(
      publicarAviso('https://rebind.ejemplo.com/aviso', '{}', 'secreto', 'aviso-1', { desarrollo: false, resolutor: buscar }),
    ).rejects.toThrow(/red privada o interna/);
    expect(llamadas.n).toBe(2);
  });

  it('si un nombre trae al menos una dirección privada, la conexión se rechaza', async () => {
    const { buscar } = resolutor([...PUBLICA, ...PRIVADA]);
    await expect(
      publicarAviso('https://mixto.ejemplo.com/aviso', '{}', 'secreto', 'aviso-1', { desarrollo: false, resolutor: buscar }),
    ).rejects.toThrow(/red privada o interna/);
  });

  it('en producción, localhost por https se rechaza antes de conectar', async () => {
    await expect(publicarAviso('https://localhost/aviso', '{}', 'secreto', 'aviso-1', { desarrollo: false })).rejects.toThrow(
      /ya no es válida/,
    );
  });
});

describe('envío a un receptor local (desarrollo)', () => {
  let servidor: Server;
  let base: string;
  const recibidos: { ruta: string; id: string; firma: string; cuerpo: string }[] = [];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (trozo) => (cuerpo += trozo));
      req.on('end', () => {
        recibidos.push({
          ruta: req.url ?? '',
          id: String(req.headers['cacao-aviso-id'] ?? ''),
          firma: String(req.headers['cacao-firma'] ?? ''),
          cuerpo,
        });
        if (req.url === '/redireccion') return void res.writeHead(302, { location: '/ok' }).end();
        if (req.url === '/error') return void res.writeHead(500).end('secreto-que-no-debe-salir');
        if (req.url === '/lento') return;
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const puerto = (servidor.address() as { port: number }).port;
    base = `http://127.0.0.1:${puerto}`;
  });

  afterEach(() => {
    recibidos.length = 0;
  });

  afterAll(() => {
    servidor.closeAllConnections();
    servidor.close();
  });

  it('entrega firmada, con la cabecera Cacao-Aviso-Id del aviso', async () => {
    const cuerpo = JSON.stringify({ aviso: 'aviso-7', tipo: 'cobro.estado', id: 'cobro-1', estado: 'pagado' });
    await publicarAviso(`${base}/ok`, cuerpo, 'secreto-de-prueba', 'aviso-7', { desarrollo: true });
    expect(recibidos).toHaveLength(1);
    expect(recibidos[0].id).toBe('aviso-7');
    expect(recibidos[0].cuerpo).toBe(cuerpo);
    expect(verificarFirmaAviso(recibidos[0].firma, cuerpo, 'secreto-de-prueba', Date.now() / 1000)).toBe(true);
  });

  it('una redirección es un intento fallido, y no se sigue', async () => {
    await expect(publicarAviso(`${base}/redireccion`, '{}', 's', 'aviso-1', { desarrollo: true })).rejects.toThrow(/redirección/);
    expect(recibidos.map((r) => r.ruta)).toEqual(['/redireccion']);
  });

  it('un error del receptor falla, sin devolver su cuerpo', async () => {
    const error = await publicarAviso(`${base}/error`, '{}', 's', 'aviso-1', { desarrollo: true }).then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).toBe('El receptor respondió 500.');
    expect(error?.message).not.toContain('secreto-que-no-debe-salir');
  });

  it('un receptor que no responde falla al cumplirse el tiempo', async () => {
    await expect(publicarAviso(`${base}/lento`, '{}', 's', 'aviso-1', { desarrollo: true, tiempoMs: 300 })).rejects.toThrow(
      /no respondió a tiempo/,
    );
  });

  it('en producción no se envía a http ni a una dirección local', async () => {
    await expect(publicarAviso(`${base}/ok`, '{}', 's', 'aviso-1', { desarrollo: false })).rejects.toThrow(/ya no es válida/);
    expect(recibidos).toHaveLength(0);
  });
});

describe('autorización de la ruta programada', () => {
  const anterior = process.env.PAY_AVISOS_SECRET;
  afterAll(() => {
    if (anterior === undefined) delete process.env.PAY_AVISOS_SECRET;
    else process.env.PAY_AVISOS_SECRET = anterior;
  });

  it('sin secreto configurado, ninguna petición pasa', () => {
    delete process.env.PAY_AVISOS_SECRET;
    expect(autorizaProcesado('Bearer cualquiera')).toBe(false);
  });

  it('pasa solo con el secreto exacto en el encabezado Bearer', () => {
    process.env.PAY_AVISOS_SECRET = 'secreto-de-prueba-123';
    expect(autorizaProcesado('Bearer secreto-de-prueba-123')).toBe(true);
    expect(autorizaProcesado('Bearer secreto-de-prueba-124')).toBe(false);
    expect(autorizaProcesado('secreto-de-prueba-123')).toBe(false);
    expect(autorizaProcesado(null)).toBe(false);
  });
});
