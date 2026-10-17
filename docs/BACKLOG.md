# Backlog y frontera de entrega

La prioridad actual es dejar una demostración local verificable antes de preparar ambientes de prueba AWS/Azure/Atlas. Los requisitos originales no implementados se conservan, aunque no sean condición para ese flujo local. No se debe describir fase 4 completa mientras falten nube o evidencias de la rúbrica.

| Prioridad        | Trabajo                               | Criterio de cierre                                                                                                         |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Completado local | Gates de calidad                      | `npm run check` PASS; ver [evidencias](pruebas/EVIDENCIAS.md)                                                              |
| Completado local | Cobertura unitaria backend >=85 %     | 102 unitarias, cuatro métricas y gate PASS                                                                                 |
| Completado local | Flujo E2E y roles                     | 2 navegador y 23 integración; aceptación, desistimiento, supervisor y agencias                                             |
| Completado local | Recuperación y concurrencia           | Regresiones leases, CAS, replay, retries, DLQ y reactivación PASS                                                          |
| P0 evidencia     | Ejecutar carga sostenida y spike      | Reportes con parámetros y métricas completos; distinguir smoke                                                             |
| Completado local | Rúbrica con resultados reales         | Matriz y evidencias actualizadas; no se acredita nube ni carga completa                                                    |
| Siguiente etapa  | Preparar pruebas AWS, Azure y Atlas   | Decisión concreta de servicios, costos vigentes, credenciales seguras y separación de ambientes; fuera del alcance vigente |
| Posterior cloud  | Desplegar y probar HTTPS/CORS/cifrado | URLs reales comprobadas, smoke remoto y configuración segura                                                               |
| Posterior cloud  | Observar disponibilidad y capacidad   | Monitoreo temporal, alertas y pruebas multirréplica                                                                        |
| P1 funcional     | RF-03 documentos                      | Upload con límites, autorización, almacenamiento y política de borrado                                                     |
| P1 funcional     | RF-10 complementos                    | Aportar datos/documentos sin duplicar solicitud y reanudar evaluación                                                      |
| P1 funcional     | RF-13 aprobación interna              | Estados/roles y reglas por monto/excepción; pruebas negativas                                                              |
| P1 funcional     | RF-14 email/push                      | Entrega real autorizada o proveedor de sandbox claramente separado                                                         |
| P1 funcional     | RF-16 expiración                      | Política N días, job persistente y transición auditable                                                                    |
| P1 funcional     | RF-17 configuración runtime           | Financieras, reglas y credenciales administrables con control de acceso                                                    |
| P1 funcional     | RF-18 usuarios y analista             | CRUD seguro por concesionario/agencia y rol faltante                                                                       |
| P1 funcional     | RF-19 reportes avanzados              | Indicadores globales por financiera/agencia/asesor, tiempos y exportación                                                  |
| P2 funcional     | RF-01/02 datos ampliados              | Jurídica, cónyuge/garante, teléfono y reglas de identificación si se habilita un entorno adecuado                          |
| P2 integración   | RF-20 CRM/ERP                         | Contrato externo, sincronización deduplicada y reporte de fallos                                                           |
| P1 seguridad     | LOPDP y retención                     | Derechos/borrado, minimización y revisión normativa independiente                                                          |
| P1 operación     | Auditoría resistente a alteración     | Separación de privilegios, retención y archivo verificable                                                                 |
| P1 operación     | Respaldo/RPO/RTO                      | Backups y restauración medidos; volumen no cuenta como backup                                                              |
| P2 escala        | Límites/circuitos distribuidos        | Política por consumidor/proveedor, half-open controlado y carga multirréplica                                              |
| P2 escala        | Crecimiento documentos                | Retención de audit/eventIds/actions y medición de índices/consultas                                                        |
| P2 validación    | Usabilidad <=5 minutos                | Sesiones cronometradas y accesibilidad en móvil                                                                            |

Véase el detalle de los 40 requisitos en [REQUIREMENTS](REQUIREMENTS.md). No hay tareas de desembolso ni evaluación bancaria real dentro del proyecto.
