# Frontend Azure conectado a AWS

La continuación solicitada el 23 de octubre de 2026 amplía el alcance anterior para publicar el frontend en Azure Static Web Apps y conectarlo a la API existente de AWS. No requiere trasladar el backend ni las credenciales de Atlas a Azure.

## Configuración y build

La API indicada por el usuario es `https://18.117.111.251`. En esta sesión respondió HTTP 200 con `{"status":"ok"}` en `/health/ready`, usando validación HTTPS normal. Esta observación no acredita disponibilidad mensual ni el flujo completo de crédito.

Desde la raíz del repositorio, en PowerShell:

```powershell
$env:VITE_API_URL = 'https://18.117.111.251'
npm.cmd run build:azure --workspace frontend
Remove-Item Env:VITE_API_URL
```

También puede guardarse únicamente esa variable en `frontend/.env.azure.local`, excluido de Git. Ese archivo ya está configurado en esta computadora. Nunca colocar contraseñas, URI de MongoDB ni secretos en variables `VITE_*`. Las variables de proceso prevalecen sobre el archivo.

`build:azure` exige un origen HTTPS exacto, sin barra final, `/docs/`, `/v1`, parámetros ni credenciales. El build genera `frontend/dist/staticwebapp.config.json` con ese mismo origen en CSP `connect-src`; ya no requiere sustituir el marcador a mano. El build local normal sin API externa conserva solo `'self'` en esa directiva.

Vite incorpora la URL al compilar: cambiar una variable después de publicar requiere reconstruir y publicar otra vez.

## Publicación

El recurso `fabrica-credito-web` se creó desde VS Code en el grupo `rg-fabrica-credito-web`, plan Free y región East US 2. La dirección asignada por Azure es [Fábrica de Crédito](https://thankful-pebble-0ac084b0f.4.azurestaticapps.net/). El build específico quedó publicado y se verificaron HTTP 200, CSP y CORS con AWS; el acceso demo y la consulta autenticada también respondieron HTTP 200.

El [workflow Azure frontend](../.github/workflows/azure-static-web-apps-thankful-pebble-0ac084b0f.yml) instala desde la raíz con Node 22, comprueba lint/pruebas del frontend y construye únicamente la web. `VITE_API_URL` se aplica solo al build. Publica en `main` cuando cambia frontend, compartidos, dependencias o ese workflow; también admite ejecución manual. El secreto de publicación quedó gestionado por la integración Azure/GitHub; no se extrajo su valor.

Publicar **solo `frontend/dist`** en Azure Static Web Apps. Fastify permanece en AWS; no configurar Azure Functions para este frontend. Elegir el plan Free para esta demostración; revisar el plan mostrado antes de crear el recurso.

Para publicar mediante GitHub Actions un build ya preparado, usar Node 22, instalar con `npm ci` desde la raíz, definir `VITE_API_URL` durante el build y ejecutar `npm run build:azure --workspace frontend`. La acción de Azure recibe:

```yaml
app_location: frontend/dist
api_location: ''
output_location: ''
skip_app_build: true
skip_api_build: true
```

El token de despliegue se guarda como secreto del proveedor o de GitHub, nunca en un archivo del repositorio. La [guía de Microsoft](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration) describe estas opciones.

## Permitir Azure en AWS

En la terminal **Ubuntu de EC2**, ejecutar:

```bash
cd ~/proyecto-api-final
git pull --ff-only origin main
node scripts/ubuntu/configure-frontend-cors.js 'https://thankful-pebble-0ac084b0f.4.azurestaticapps.net'
sudo -n systemctl restart fabrica-api
curl -fsS http://127.0.0.1:4000/health/ready
```

Detenerse si un comando falla. El [script](../scripts/ubuntu/configure-frontend-cors.js) agrega el origen exacto a `CORS_ORIGINS` en `.env.atlas`, conserva los demás orígenes explícitos y una copia privada anterior, y no imprime secretos. No compila ni modifica el código del backend. Reiniciar únicamente el servicio API según [UBUNTU_SERVICES](UBUNTU_SERVICES.md). El archivo privado local no cambia EC2.

La comprobación externa inicial recibió HTTP 204 al preflight, pero **sin** `access-control-allow-origin`. El acceso SSH al puerto 22 desde la computadora terminó por timeout; el usuario aplicó el bloque anterior desde la terminal de AWS y comunicó que terminó sin errores. La comprobación posterior confirmó el origen Azure permitido y un origen ajeno rechazado; no se inspeccionó directamente el archivo privado de EC2.

## Verificación y límites

- Comprobar que Azure sirve la página y la cabecera CSP con la IP HTTPS de AWS.
- Comprobar un preflight `OPTIONS` a `/v1/auth/login` con el origen real Azure; debe devolver `access-control-allow-origin` igual a ese origen.
- Abrir la web y comprobar login con una cuenta demo; después recorrer una solicitud ficticia para acreditar la integración completa.
- Un sitio Azure creado, un build local o readiness de AWS no prueban por sí solos esa integración.

### Resultado observado el 23 de octubre de 2026

| Comprobación                                                                                                    | Resultado                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Despliegue Azure del commit `02c48cf`](https://github.com/ian0000/proyecto-api-final/actions/runs/40054075901) | Success: lint, 9 pruebas web, build y publicación                               |
| Página pública Azure                                                                                            | HTTP 200 por HTTPS                                                              |
| CSP servida por Azure                                                                                           | `connect-src 'self' https://18.117.111.251`                                     |
| JavaScript publicado                                                                                            | Contiene el origen AWS y coincide por SHA-256 con el artefacto local verificado |
| Preflight de login desde el origen Azure                                                                        | HTTP 204; `access-control-allow-origin` coincide exactamente                    |
| Preflight desde un origen ajeno ficticio                                                                        | Sin permiso `access-control-allow-origin`                                       |
| Readiness AWS                                                                                                   | HTTP 200 con permiso para Azure                                                 |
| Login demo remoto y consulta autenticada de solicitudes                                                         | HTTP 200 y CORS correcto en ambos                                               |

El [resumen de comprobaciones](pruebas/azure-conexion.json) conserva resultados sin contraseñas, tokens ni datos de solicitudes. Los HTTP a AWS enviaron explícitamente el encabezado `Origin`; no equivalen a una prueba visual de navegador. La vista previa de navegador no recibió autorización y no se sustituyó por otro mecanismo de control. No se repitió en esta continuación el flujo completo de crear/comparar/aceptar una solicitud, ni se acreditan SLA, carga o recuperación.

El primer workflow ajustado falló porque la URL AWS también se aplicó a las pruebas; se corrigió limitándola al paso de build. Ese fallo permanece visible en GitHub y no se describe como una prueba aprobada.
