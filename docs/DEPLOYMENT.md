# Despliegue: diseño preparado, ambientes pendientes

**Punto de corte solicitado:** terminar implementación y validación local antes de preparar ambientes de pruebas AWS y Azure. No se han creado cuentas, recursos, DNS, credenciales, presupuestos, clusters Atlas ni despliegues remotos. Las URLs reales y el comportamiento en proveedores están **PENDIENTES**. Un build local o una plantilla no demuestra disponibilidad pública.

## Topología propuesta

| Componente             | Destino posterior                      | Ejecución                                                                  |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Web React/Vite         | Azure Static Web Apps Free             | Archivos `frontend/dist`; `VITE_API_URL` apunta a la API HTTPS AWS         |
| API Fastify            | AWS EC2 Linux + Docker                 | Target `backend`, proceso `node backend/dist/main.js`                      |
| Worker                 | Misma imagen y misma VM inicialmente   | Comando `node backend/dist/worker-main.js`, proceso separado de la API     |
| Financieras académicas | Servicio Docker independiente en AWS   | Target `mocks`, URL HTTPS propia, `node mocks/dist/main.js`                |
| Persistencia           | MongoDB Atlas                          | Bases `credito_test` y `credito_test_mocks`, usuarios y permisos limitados |
| Entrada HTTPS          | Reverse proxy de la VM, por configurar | Dos nombres/orígenes: API y mocks; TLS, límites, reinicios y logs          |

EC2 permite mantener el worker activo sin adaptar el diseño a una función efímera. API y worker comparten artefacto; los mocks mantienen despliegue, proceso y contrato propios. La VM inicial es un punto único de fallo y **no tiene autoescalado**. No se atribuye elasticidad al sistema sin medirla. El reverse proxy es la frontera de entrada, sin API Gateway adicional.

La propuesta inicial concentra los contenedores en una VM para reducir costo operativo; pueden separarse luego. El worker no escucha un puerto público. La cola y los leases viven dentro de los documentos MongoDB, no dentro del contenedor. Los mocks también persisten entregas e idempotencia en su base `_mocks`; perderla rompe la recuperación de callbacks.

## Contenedores revisables

Desde la raíz, con Docker disponible:

```powershell
docker build --target backend -t credito-backend:local .
docker build --target mocks -t credito-mocks:local .
```

Estos comandos construyen imágenes locales. El `Dockerfile` usa Node 22, compilación TypeScript y usuario `node` sin root. No incorpora `.env`. La API y worker requieren la misma configuración y acceso a MongoDB; el comando del worker sobrescribe el CMD de la imagen backend. El healthcheck externo de la API debe consultar `/health/ready` y el de los mocks `/health/live`. La supervisión del worker debe vigilar proceso, antigüedad de trabajos y cola pendiente/dead, no solo el estado de la API.

Las etiquetas base son móviles: registrar digest y SHA Git de las imágenes al hacer la liberación. Validación local y estado de construcción se consignan en [evidencias](pruebas/EVIDENCIAS.md) cuando exista el reporte; este documento describe el procedimiento y no certifica un build.

## Contrato de configuración para la próxima sesión

| Variable             | API/worker               | Mocks            | Observación                                          |
| -------------------- | ------------------------ | ---------------- | ---------------------------------------------------- |
| `MONGODB_URI`        | Sí                       | Sí               | URI TLS Atlas, sin publicarla en logs ni repositorio |
| `DB_NAME`            | `credito_test`           | `credito_test`   | El proceso mocks añade `_mocks` automáticamente      |
| `JWT_SECRET`         | Sí                       | No               | Aleatorio, mínimo 32 caracteres                      |
| `WEBHOOK_SECRET`     | Sí                       | Sí               | Mismo valor para firma y verificación HMAC           |
| `MOCK_SECRET`        | Sí                       | Sí               | Autorización del tráfico a financieras ficticias     |
| `MOCK_URL`           | Origen HTTPS mocks       | No               | Sin barra final                                      |
| `CALLBACK_URL`       | Origen HTTPS API         | Mismo origen API | Sin barra final; el mock valida destino exacto       |
| `CORS_ORIGINS`       | Origen Azure exacto      | No               | Sin comodín; varios valores separados por coma       |
| `PORT` / `MOCK_PORT` | 4000                     | 4001             | Puertos privados detrás del proxy                    |
| `MOCK_SEED`          | No                       | `academico-v1`   | Variabilidad ficticia reproducible                   |
| `RATE_LIMIT`         | 120 por minuto/identidad | No               | No aumentar silenciosamente para aprobar carga       |
| `DEMO_PASSWORD`      | Solo herramienta seed    | No               | Mínimo 12 caracteres; credenciales de demostración   |
| `VITE_API_URL`       | No                       | No               | Valor público incorporado en el build web            |

Conservar los parámetros de timeout/retry/lease de [.env.example](../.env.example). `LEASE_MS` debe superar tres timeouts de integración. Credenciales distintas para local y nube. La herramienta `npm run seed` corre desde fuentes con Node/tsx y `.env` privado; los bundles de producción no incluyen una interfaz de seed. Los usuarios existentes no cambian de contraseña al repetir seed: usa un procedimiento explícito de rotación.

El frontend contiene una CSP con `REPLACE_WITH_AWS_API_HOST`: antes de publicar, incorporar el origen real en `frontend/dist/staticwebapp.config.json`, además de `VITE_API_URL`. Son dos configuraciones distintas. El workflow de preflight genera un artefacto con ambas y comprueba que no queden marcadores. CORS y CSP deben admitir el mismo origen API, y ambos sitios deben usar HTTPS para evitar contenido mixto.

## Costos y límites consultados el 16 de octubre de 2026

La selección final de región, tamaño, presupuesto y cuenta queda para la preparación de ambientes. Estos datos públicos no acreditan beneficios ni saldo de la cuenta del usuario.

| Servicio            | Dato verificado                                                                                   | Consecuencia para este proyecto                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Azure SWA Free      | 100 GB de transferencia por suscripción; sin SLA; al superar cuota no sirve el sitio              | Adecuado para demostración académica, no prueba una disponibilidad de 99,5 %        |
| Atlas Free          | 0,5 GB incluyendo índices, 500 conexiones y 100 operaciones/s                                     | Los 200/500 VUs pueden alcanzar throttling antes que el límite de la API            |
| EC2 T3              | `t3.small`, 2 vCPU/2 GiB, Linux/Unix, US East Northern Virginia: USD 0,0209/h en la tabla pública | 20 h ≈ USD 0,42 de cómputo; 730 h ≈ USD 15,26; confirmar región/OS antes de aprobar |
| IPv4 AWS            | USD 0,005/h por dirección pública                                                                 | Una IP: 20 h ≈ USD 0,10; 730 h ≈ USD 3,65, salvo créditos/beneficios aplicables     |
| AWS Free Tier nuevo | Hasta USD 200 de créditos y plan gratuito de hasta 6 meses, sujeto a condiciones                  | No asumir elegibilidad ni desplegar basándose en “gratis”                           |

Al cálculo EC2 hay que sumar EBS, transferencia, logs, posibles créditos CPU Unlimited y DNS; parar la VM no elimina necesariamente almacenamiento o IPv4 reservada. Para carga sostenida conviene revisar créditos CPU y costo antes de elegir T3. No se ha aprobado gasto, contratado capacidad ni prometido que Atlas Free cumpla la carga.

Fuentes oficiales: [Azure SWA precios](https://azure.microsoft.com/en-us/pricing/details/app-service/static/), [Atlas Free límites](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), [EC2 T3](https://aws.amazon.com/ec2/instance-types/t3/), [EC2 On-Demand](https://aws.amazon.com/ec2/pricing/on-demand/), [IPv4 VPC](https://aws.amazon.com/vpc/pricing/), [AWS Free Tier](https://aws.amazon.com/free/free-tier-faqs/). Revalidar precios al preparar el ambiente.

## Trabajo posterior al punto de corte, sin ejecutar ahora

1. Confirmar cuentas/suscripciones, región, créditos, presupuesto máximo y responsables; decidir tamaño EC2 sin activar recursos todavía.
2. Preparar Atlas con datos exclusivamente ficticios, bases separadas, usuarios limitados, TLS y lista de acceso acotada; definir backup/export y retención.
3. Preparar AWS: VM, acceso administrativo limitado, Docker, supervisión de tres procesos, firewall, HTTPS, DNS y secretos externos al repositorio. Abrir solo los puertos necesarios; MongoDB no se expone desde la VM.
4. Preparar Azure SWA Free y su origen; construir web con API HTTPS conocida, ajustar CSP y CORS, verificar navegación directa y preflight del navegador.
5. Crear configuración protegida en GitHub para cada ambiente. Ejecutar primero CI real; conectar despliegue con permisos mínimos solo cuando exista infraestructura aprobada. El workflow actual **no despliega**.
6. Publicar imágenes/versiones de forma controlada, seed ficticio, smoke HTTP/autenticación, recorrido E2E desde Azure y reinicio de API/worker/mocks para comprobar persistencia.
7. Ejecutar los dos escenarios [de rendimiento](pruebas/RENDIMIENTO.md), registrar costo y límites, luego desactivar/eliminar los recursos de prueba conforme al plan aprobado.

## Rollback y aceptación posterior

Conservar la imagen anterior por digest y el artefacto web anterior. Antes de cambiar versión, exportar las dos bases si la prueba requiere preservar datos. Volver a la imagen anterior solo si el esquema es compatible; detener worker antes de una restauración y reanudar con leases expirados. Un rollback de frontend no revierte MongoDB. Registrar versión, hora, causa, copia utilizada y validación de recuperación.

La aceptación remota exige URLs HTTPS reales, login autorizado, crear solicitud, dos financieras diferenciadas, estados/ofertas, aceptación, auditoría, rechazo de permisos incorrectos, callback HMAC y recuperación tras reinicio. Hasta documentar esas pruebas, el estado es **no desplegado / no verificado en proveedores**.
