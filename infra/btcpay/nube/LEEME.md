# Cacao BTCPay en Oracle Cloud (siempre gratis)

Esta carpeta lleva el stack de pagos de la demostración a un servidor en la nube. Cuando esté andando, los pagos ya no dependen de tu PC, y la dirección es fija y con HTTPS.

No hace falta ser administrador de sistemas. Son siete pasos, y el de instalar es un solo comando.

> Esta carpeta solo prepara los archivos. Todavía no se creó ninguna cuenta ni ninguna VM.

## Qué vas a tener

- Un servidor Ubuntu 24.04 en Oracle Cloud, dentro del plan "Always Free".
- Una dirección fija con HTTPS, por ejemplo `https://203-0-113-10.sslip.io`.
- El mismo stack que en tu PC: BTCPay, Lightning y la billetera de prueba.

Por defecto corre en **regtest**: es la misma demostración, con bitcoin de prueba que no vale nada. Para dinero real, leé "Regtest y mainnet" más abajo.

## Antes de empezar

- Un correo y una tarjeta. Oracle pide una tarjeta para verificar la cuenta. Los recursos "Always Free" no se cobran, pero revisá la página de precios de Oracle antes de empezar.
- Una clave SSH en tu PC. Abrí PowerShell y corré esto (la contraseña es opcional, pero recomendable):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\cacao_oracle"
```

Eso crea dos archivos: `cacao_oracle` (la privada: no la compartas nunca) y `cacao_oracle.pub` (la pública: esa va a Oracle).

## 1. Crear la cuenta de Oracle Cloud

1. Entrá a oracle.com/cloud/free y elegí "Start for free". Completá los datos, confirmá el correo y la tarjeta.
2. Elegí una región cercana. **La región de inicio no se puede cambiar después.**
3. Esperá el correo de "cuenta lista". Puede tardar unos minutos.

## 2. Crear la VM

En el menú principal (las tres rayas) entrá a Compute > Instances > **Create instance**.

- **Name:** `cacao-btcpay`.
- **Image:** "Change image" > **Canonical Ubuntu 24.04**, en la versión **aarch64** (la de ARM). Es importante que sea aarch64.
- **Shape:** "Change shape" > **Ampere** > **VM.Standard.A1.Flex**. Poné **2 OCPU y 12 GB** para regtest (4 OCPU y 24 GB para mainnet). Ese es el máximo gratis en total.
- **Networking:** dejá la red por defecto, con **IP pública asignada** (Assign a public IPv4 address: sí).
- **SSH keys:** "Upload public key files (.pub)" y elegí `cacao_oracle.pub`.
- **Boot volume:** tamaño personalizado de **100 GB** (150 GB si vas a mainnet).
- **Create.** Esperá a que diga **Running**.

Si Oracle responde "Out of host capacity", es normal con ARM en algunas regiones: probá otra "Availability Domain" o intentá más tarde.

## 3. Reservar la IP

Si no la reservás, la IP puede cambiar al apagar la VM, y con ella cambia la dirección.

Menú > Networking > **IP Management** > **Reserved Public IPs** > Reserve Public IP Address. Después, en la página de la VM, entrá a **Attached VNICs** > la VNIC > **IPv4 Addresses** y pasá la IP pública a **Reserved**. Es gratis mientras esté asignada. Los nombres de los menús pueden variar un poco según la versión de la consola.

Anotá la IP pública. La vas a usar en los pasos siguientes. Ejemplo: `203.0.113.10`.

## 4. Abrir los puertos 80 y 443 en Oracle

Oracle tiene su propio firewall, aparte del de Ubuntu. El script se encarga del de Ubuntu; este es el de Oracle.

Menú > Networking > **Virtual Cloud Networks** > la VCN de la VM > **Security** > **Security Lists** > **Default Security List** > **Add Ingress Rules**. Agregá dos reglas, una por puerto:

| Campo | Valor |
|---|---|
| Source CIDR | `0.0.0.0/0` |
| IP Protocol | TCP |
| Destination Port Range | `80` (y otra igual con `443`) |

El puerto 22 (SSH) ya viene abierto. Si tu subred usa "Network Security Groups" en vez de la security list, poné las mismas reglas en ese grupo.

## 5. Entrar a la VM por SSH

En PowerShell, en tu PC:

```powershell
ssh -i "$env:USERPROFILE\.ssh\cacao_oracle" ubuntu@203.0.113.10
```

La primera vez pregunta "Are you sure you want to continue connecting?": escribí `yes`. El prompt tiene que cambiar a `ubuntu@cacao-btcpay`.

## 6. Copiar esta carpeta a la VM

Desde PowerShell en tu PC (no dentro del SSH):

```powershell
scp -i "$env:USERPROFILE\.ssh\cacao_oracle" -r "$env:USERPROFILE\Documents\CacaoMedia\infra\btcpay\nube" ubuntu@203.0.113.10:/home/ubuntu/
```

Esta carpeta no tiene secretos: las claves se generan en la VM.

## 7. Instalar (un solo comando)

Dentro del SSH:

```bash
cd ~/nube && sudo bash instalar.sh
```

Tarda entre 10 y 20 minutos la primera vez. Al final muestra la dirección. El script:

- instala Docker y las actualizaciones de seguridad automáticas;
- abre solo los puertos 22, 80 y 443 en el firewall de Ubuntu;
- arranca el stack y lo deja andando después de cada reinicio;
- en regtest, mina monedas de prueba, fondea al comprador de prueba y abre el canal Lightning;
- programa el respaldo diario.

Si al final dice que la dirección todavía no responde, casi siempre falta el paso 4. Corré el mismo comando otra vez: es seguro repetirlo.

## 8. La dirección

La dirección es `https://<IP con guiones>.sslip.io`. Para la IP `203.0.113.10` sería `https://203-0-113-10.sslip.io`.

- **sslip.io** es un DNS gratuito: convierte esa dirección en tu IP. No hay que comprar nada.
- **HTTPS:** Caddy pide el certificado a Let's Encrypt y lo renueva solo.
- **Límite conocido:** sslip.io lo usan muchas personas, y Let's Encrypt limita cuántos certificados se emiten por dominio. Si el primer intento falla por ese límite, esperá un rato o usá tu propio dominio.

### Cambiar a tu propio dominio

Si tenés un dominio (por ejemplo `pagos.tudominio.com`):

1. En el panel de tu proveedor de dominio, creá un registro **A**: nombre `pagos`, valor la IP reservada.
2. Esperá a que propague (minutos u horas). Podés chequearlo con `nslookup pagos.tudominio.com` en PowerShell.
3. En el SSH: `cd ~/nube && sudo bash instalar.sh --dominio pagos.tudominio.com`.
4. Avisá a quien administra los productos: la dirección también cambia en las apps (ver `despues-de-instalar.md`).

## 9. Comprobar que funciona

- Abrí `https://<tu-dirección>` en el navegador: tiene que aparecer la pantalla de BTCPay.
- En regtest, abrí `https://<tu-dirección>/billetera`: la billetera de prueba.
- En el SSH, `docker ps` (sin sudo, después de reconectar) muestra los contenedores en estado "Up".

## Después de instalar

- Si sos la única persona que usa la demo, ya tenés la dirección. Nada más que hacer.
- Si administrás los cinco productos (Media, Travel, Market, Pay y Ledger), seguí `despues-de-instalar.md`. Ahí están las tiendas, las claves, los webhooks, Supabase y Vercel.

## Cosas de todos los días

Los comandos se corren en el SSH. Usá `sudo` si todavía no reconectaste después de instalar:

| Qué | Comando |
|---|---|
| Ver el estado | `docker compose -f /opt/cacao-btcpay/docker-compose.yml ps` |
| Ver el log de un servicio | `docker compose -f /opt/cacao-btcpay/docker-compose.yml logs --tail=100 btcpayserver` |
| Parar todo | `sudo systemctl stop cacao-btcpay` |
| Arrancar todo | `sudo systemctl start cacao-btcpay` |
| Actualizar | Copiá la carpeta de nuevo (paso 6) y corré `sudo bash instalar.sh` |

Ubuntu se actualiza solo. Las imágenes de Docker (BTCPay, LND, etc.) no: para subir de versión, cambiá las etiquetas en `docker-compose.nube.yml` y corré el script de nuevo. La VM puede reiniciarse sola a las 04:30 para instalar parches; el stack vuelve solo.

## Respaldos

Todos los días a las 03:17 (UTC) se guarda un respaldo cifrado en `/opt/cacao-btcpay/respaldos`. Tiene la base de datos de BTCPay, el respaldo del canal Lightning y la carpeta de datos de BTCPay. Se guardan 7 días.

Dos cosas que tenés que hacer vos:

1. **Guardá la clave de respaldo** en tu gestor de contraseñas. Sin ella, los respaldos no se pueden abrir. En el SSH: `sudo cat /opt/cacao-btcpay/respaldo-clave` y copiá el texto.
2. **Copiá los respaldos a tu PC** cada tanto. Un respaldo en la misma VM no es un respaldo. En PowerShell (la carpeta no tiene que estar dentro del repositorio):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\Backups\cacao-btcpay" | Out-Null
scp -i "$env:USERPROFILE\.ssh\cacao_oracle" "ubuntu@203.0.113.10:/opt/cacao-btcpay/respaldos/*" "$env:USERPROFILE\Backups\cacao-btcpay\"
```

Restaurar un respaldo no es un solo comando. Si lo necesitás, pedí ayuda a quien administra el stack.

## Regtest y mainnet

**Regtest (lo que trae por defecto).** Es la demostración tal cual: bitcoin de prueba, sin valor. Hay un comprador de prueba, un botón para simular pagos y la billetera de prueba en `/billetera`. Nada de esto mueve dinero real.

**Mainnet (dinero real).** No es un cambio de configuración. Hace falta:

- **Disco y CPU:** el nodo podado guarda unos 50 GB de datos, más el resto del stack. Usá 150 GB de disco y 4 OCPU con 24 GB.
- **Sincronización inicial:** el nodo tiene que bajar y verificar la cadena. Calculá 1 o 2 días antes de poder cobrar.
- **Liquidez Lightning:** para cobrar por Lightning hace falta un canal con liquidez entrante, no alcanza con fondos propios. Eso se consigue con tiempo y con fondos on-chain.
- **Semilla de la billetera Lightning:** en mainnet la semilla no se guarda sola. Hay que anotar las 24 palabras en papel. Sin ellas, si se pierde el disco, se pierden los fondos on-chain del nodo. El paso exacto se confirma en el primer arranque (ver `despues-de-instalar.md`).
- **Sin botones de prueba** (CHEATMODE apagado) y **sin billetera de prueba**: `/billetera` responde 404.
- **Regulación:** con dinero real, Cacao Pay es un servicio de remesas. Necesita registro ante el BCR antes de cobrarle a nadie. No se empieza con dinero real sin eso.

El script no pasa una instalación regtest a mainnet, porque borraría la demo. Para mainnet hay que usar una VM nueva:

```bash
sudo bash instalar.sh --red mainnet
```

## Problemas comunes

| Síntoma | Qué hacer |
|---|---|
| La dirección no abre por HTTPS | Revisá el paso 4 (los dos puertos en la security list de Oracle). Después: `docker compose -f /opt/cacao-btcpay/docker-compose.yml logs --tail=80 caddy`. Si dice que se alcanzó un límite de Let's Encrypt, esperá o usá tu dominio. |
| "Out of host capacity" al crear la VM | Otra Availability Domain, o más tarde. |
| `permission denied` al correr `docker` | Cerrá el SSH y volvé a entrar: tu usuario quedó en el grupo docker. |
| Algo quedó a medias | Corré de nuevo `sudo bash instalar.sh`. Es seguro repetirlo. |
