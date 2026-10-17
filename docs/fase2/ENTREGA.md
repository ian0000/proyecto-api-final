# Fase 2 · Arquitectura y patrones (RA2)

Entregable actualizado: [ARCHITECTURE](../ARCHITECTURE.md), con componentes y secuencia asíncrona Mermaid, evaluación REST/GraphQL/gRPC, patrones, costos y límites. Decisiones en [ADR-001](../adr/001-estilo-y-componentes.md), [ADR-002](../adr/002-mongo-y-cola.md) y [ADR-003](../adr/003-seguridad-y-simulacion.md). Fecha de U2 en la rúbrica: **17 de octubre de 2026**; envío plataforma no verificado.

La fuente [fase2.docx](../fuentes/fase2.docx) y el [diagrama original](../fuentes/arquitectura-original.png) se conservan. El diseño vigente reemplaza PostgreSQL/Redis/BullMQ/NestJS/Kong/Render por MongoDB, cola embebida persistente, Fastify y destino AWS/Azure futuro. No se afirma que los patrones originales estén todos implementados; las diferencias constan en [REQUIREMENTS](../REQUIREMENTS.md).

El diseño permite mostrar desacoplamiento por adaptadores y trabajo recuperable sin microservicios artificiales. El escalamiento horizontal, políticas distribuidas, SLA y capacidad cloud requieren evidencia posterior.
