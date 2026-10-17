# Fase 3 · Modelo y contrato (RA3)

Entregables: [DATA_MODEL](../DATA_MODEL.md), [API_CONTRACT](../API_CONTRACT.md), [OpenAPI](../../shared/openapi.json) y [ejemplo ficticio](../../shared/example.json). Fecha U3 en fuente: **23 de octubre de 2026**. No se ha comprobado envío en plataforma.

El modelo explica agregado, embebido/referencias, índices, atomicidad, CAS, deduplicación y límites. El contrato incluye `/v1`, JWT, esquemas, ejemplos, parámetros, errores, paginación e idempotencia. `npm run contract` verifica sintaxis y ejemplo; pruebas HTTP y cobertura comprueban comportamiento. Los comandos y pruebas ejecutados pasaron; consulte [EVIDENCIAS](../pruebas/EVIDENCIAS.md). El contrato de mocks separado también se valida.

No se publican endpoints ficticios para RF pendientes. Carga documental, complementos, aprobación interna y CRM se identifican explícitamente como brechas, en lugar de incluir contratos sin implementación.
