# Guía de sustentación

## Relato de apertura

“La Fábrica de Crédito reduce la repetición al registrar y seguir una solicitud vehicular. La demostración usa exclusivamente datos ficticios y dos contratos bancarios inventados. La API ofrece un modelo canónico y confirma el registro antes de esperar las ofertas. Un worker recuperable procesa integraciones diferentes sin obligar a la web a conocer JSON externo o XML.”

## Demostración sugerida

1. Muestre [PRODUCT](PRODUCT.md): problema, actores y valor indirecto; las comisiones futuras son propuestas.
2. Muestre [ARCHITECTURE](ARCHITECTURE.md): web, API, Mongo, worker y mock independiente. Explique 202 y consistencia eventual.
3. Abra Swagger y `shared/openapi.json`; identifique versión, seguridad, modelos y errores.
4. Ingrese como asesor, cree solicitud ficticia con consentimiento y escenario aprobado; compare ambas ofertas y seguro separado.
5. Acepte una oferta; observe estado terminal, notificaciones persistentes y timeline. En otra solicitud demuestre desistimiento.
6. Demuestre el error por falta de consentimiento, replay y conflicto de Idempotency-Key, versión obsoleta y restricción de supervisor/agencia.
7. Seleccione temporal/timeout, observe retries/DLQ y reactive con administrador. Muestre una recuperación de worker y la diferencia entre timers y persistencia Mongo.
8. Presente reportes realmente generados de tests/cobertura/carga, incluyendo fallos o límites. No lea objetivos como si fueran mediciones.
9. Cierre con [REQUIREMENTS](REQUIREMENTS.md): documentos, complementos, aprobación, email, expiración, CRM y administración avanzada pendientes; nube es la siguiente etapa.

## Preguntas previsibles

| Pregunta                            | Respuesta defendible                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Por qué Fastify?                   | Integra schemas, hooks, JWT y documentación con poco código; el dominio permanece en servicio/worker/adaptadores.                                       |
| ¿Por qué REST y no GraphQL/gRPC?    | El navegador necesita recursos sencillos y contrato navegable; las alternativas añaden complejidad que este flujo no necesita.                          |
| ¿Por qué Mongo sin Redis?           | Crear datos y trabajo dentro del agregado es atómico. Lease/CAS hace recuperable el procesamiento; a gran escala un broker dedicado puede justificarse. |
| ¿Es una cola real o un timer?       | Los jobs, fechas, intentos y lease están en Mongo. El timer solo despierta el worker; reiniciarlo no elimina los trabajos persistidos.                  |
| ¿Garantiza exactamente una entrega? | No. Es al menos una vez con claves y deduplicación. Una llamada puede completarse antes de perder su confirmación.                                      |
| ¿Es OAuth?                          | No. JWT HS256 propio con expiración/issuer/audience. OAuth/OIDC queda documentado como diferencia frente a originales.                                  |
| ¿La bitácora es inmutable?          | La API no permite editarla, pero un administrador Mongo sí puede. Se requiere protección adicional para afirmar inmutabilidad fuerte.                   |
| ¿Las tasas son bancarias?           | No. Son parámetros ficticios reproducibles de la simulación. No hay APIs ni credenciales bancarias reales.                                              |
| ¿Por qué no incluye todos los RF?   | Se priorizó el flujo demostrable; los 40 requisitos se conservan con estado y backlog, sin simular cumplimiento administrativo o legal.                 |
| ¿Cumple 99,5 % y p95?               | Solo las métricas ejecutadas permiten afirmarlo. SLA mensual y cloud no se demuestran con un proceso local.                                             |
| ¿Está desplegado?                   | Esta etapa termina antes de preparar ambientes cloud. Las guías y plantillas no son un despliegue verificado.                                           |

## Trabajo grupal

Asigne integrantes reales antes de presentar: negocio/contrato, arquitectura/datos, seguridad/integración y pruebas/operación. Cada integrante debe poder ejecutar el flujo y explicar las decisiones de otro módulo. Complete nombres y tiempos de exposición con el grupo; no se inventan participantes ni evidencia de exposición equitativa.

Entregas U1/U2/U3/U4: 3, 17, 23 y 29 de octubre de 2026. Esas fechas provienen de la rúbrica; el estado actual de la plataforma académica no está consultado.
