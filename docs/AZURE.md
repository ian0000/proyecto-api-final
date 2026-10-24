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

Una vez obtenida la URL real del sitio, en `.env.atlas` **de EC2** configurar `CORS_ORIGINS` con su origen exacto, por ejemplo `https://NOMBRE_REAL.azurestaticapps.net`, sin barra final. Si se conservan varios orígenes, separarlos con comas y sin espacios. Reiniciar únicamente el servicio API según [UBUNTU_SERVICES](UBUNTU_SERVICES.md). No utilizar `*`.

La URL del frontend todavía no se ha determinado; el ejemplo anterior no es una dirección publicada. El archivo privado local no cambia la configuración de EC2.

## Verificación y límites

- Comprobar que Azure sirve la página y la cabecera CSP con la IP HTTPS de AWS.
- Comprobar un preflight `OPTIONS` a `/v1/auth/login` con el origen real Azure; debe devolver `access-control-allow-origin` igual a ese origen.
- Abrir la web y comprobar login con una cuenta demo; después recorrer una solicitud ficticia para acreditar la integración completa.
- Un sitio Azure creado, un build local o readiness de AWS no prueban por sí solos esa integración.

Estado al preparar esta guía: build Azure generado localmente; publicación Azure, ajuste remoto CORS y recorrido entre proveedores pendientes de verificación.
