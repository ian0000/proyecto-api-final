# Fase 4 · Desarrollo, seguridad y despliegue (RA4)

La fase técnica dispone de código local de web, API, worker y mocks; JWT, roles/agencia, validación, consentimiento, adaptadores, trabajos duraderos, reintentos/DLQ, comparación y cierre de solicitud. Fecha U4 en fuente: **29 de octubre de 2026**. El envío a plataforma no se ha consultado.

## Estado y evidencia requerida

| Área            | Situación                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Ejecución local | Procedimiento en [README](../../README.md); smoke/E2E aprobados; [evidencias](../pruebas/EVIDENCIAS.md)                      |
| Seguridad       | JWT propio, scrypt, RBAC/agencia y webhook HMAC; controles cloud pendientes                                                  |
| Calidad         | Gates y cobertura en [TESTING](../TESTING.md); 102 unitarias con cobertura >85 %, 23 integración, 9 frontend y 14 mocks PASS |
| Rendimiento     | Dos escenarios de rúbrica requieren reportes medidos; no sustituir por smoke                                                 |
| CI/CD           | Preparación en [CICD](../CICD.md); ejecución remota no acreditada por archivo YAML                                           |
| Nube            | Pendiente deliberadamente: esta etapa termina antes de preparar AWS/Azure/Atlas                                              |
| Sustentación    | Guion en [DEFENSA](../DEFENSA.md); nombres y exposición grupal por acordar                                                   |

No se declara fase 4 completa ni nivel excelente de rúbrica con funcionamiento solamente local. La preparación de ambientes remotos es el siguiente punto de trabajo, según [DEPLOYMENT](../DEPLOYMENT.md). Las brechas funcionales y operativas se conservan en [BACKLOG](../BACKLOG.md).
