# Verificación de Atlas del 22 de octubre de 2026

Se utilizó el clúster Atlas existente con un usuario exclusivo de la Fábrica de Crédito, limitado a `credito_test` y `credito_test_mocks`. Los procesos de aplicación se ejecutaron en la computadora de desarrollo; la base de datos estaba en Atlas. Esta evidencia no acredita ejecución desde EC2, publicación en Azure ni disponibilidad mensual.

| Comprobación          | Resultado observado                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Usuario de conexión   | Creado por el usuario; permisos `readWrite` en las dos bases y restricción al clúster comprobados en Atlas |
| `npm run atlas:check` | PASS: conexión, autenticación, ping y listado de colecciones de ambas bases                                |
| `npm run seed:atlas`  | PASS: índices y tres cuentas demo creados si estaban ausentes; ninguna contraseña fue registrada           |
| Readiness de la API   | HTTP 200 con Atlas                                                                                         |
| Login                 | HTTP 200 para asesor, supervisor y administrador                                                           |
| Registro ficticio     | HTTP 202 y solicitud persistida                                                                            |
| Integración con mocks | Dos ofertas obtenidas mediante los adaptadores JSON/XML y worker                                           |
| Aceptación            | HTTP 200 y estado ACEPTADA                                                                                 |
| Notificaciones        | Oferta elegida aceptada y alternativa retirada en los mocks; ambos trabajos finalizados                    |
| Auditoría             | Eventos presentes en la solicitud ficticia                                                                 |

La comprobación funcional utilizó HTTP local para los mocks y API, y conexiones del driver a Atlas. Se conservaron las solicitudes ficticias y los registros de los mocks creados durante la verificación. No se borraron datos ni se contactó a bancos reales. La prueba puntual no es una prueba de carga o un E2E de navegador.

El comprobador reproducible de solo lectura es [check-atlas.ts](../../scripts/check-atlas.ts). La inicialización se ejecuta con [seed.ts](../../backend/src/seed.ts). El resumen del flujo puntual se conserva localmente en `artifacts/atlas/smoke-result.json`, excluido de Git. La URI, la contraseña del usuario Atlas, los secretos de aplicación y los JWT no se incluyen en el reporte ni en el repositorio.

La lista de red tenía una regla global preexistente; no se cambió porque el clúster también atiende otros usos. El usuario de aplicación tiene alcance de base restringido. La revisión de esa regla se detalla en [ATLAS](../ATLAS.md).

Pendientes: instalar Node/npm y comprobar la configuración privada desde EC2; supervisar los tres procesos; publicar la API con HTTPS; construir y publicar la web en Azure con CSP/CORS correctos; verificar el flujo entre ambos proveedores. Las pruebas de carga completas continúan pendientes.
