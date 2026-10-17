# ADR-001 · REST y monolito modular con procesos separados

Estado: aceptado para MVP local. Fecha: 16 octubre 2026.

**Contexto.** Un navegador y dos integraciones ficticias necesitan contrato claro, asincronía y demostración simple. El prompt fija React, Node y MongoDB.

**Decisión.** REST/OpenAPI 3.0.3 sobre Fastify; React/Vite para UI. Un backend modular comparte código entre API y worker desplegables por separado. Mock independiente. No añadir gateway dedicado, BFF ni microservicios.

**Alternativas.** GraphQL facilita selección dinámica pero añade gobierno de consultas; gRPC aporta binario/streaming sin necesidad actual; NestJS estructura más capas a un costo innecesario para este volumen; microservicios agregan operación y consistencia distribuida.

**Consecuencias.** Menos componentes y contrato navegable. Fastify concentra seguridad/validación local. API y worker conservan acoplamiento de versión/modelo; un borde cloud y coordinación distribuida requerirán diseño de ambiente posterior. Véase [ARCHITECTURE](../ARCHITECTURE.md).
