# ADR-002 · Agregado MongoDB y cola persistente embebida

Estado: aceptado para MVP local. Fecha: 16 octubre 2026.

**Contexto.** El prompt sustituye PostgreSQL por MongoDB y exige que el envío no dependa de tareas en memoria. Separar datos y publicación en una cola introduciría un problema de doble escritura.

**Decisión.** Guardar datos y jobs por financiera en la misma solicitud; reclamar por `findOneAndUpdate`, lease con token y fecha; CAS con version para decisiones concurrentes. Persistir retries, dueAt y dead. Mantener circuitos en colección aparte.

**Alternativas.** Redis/BullMQ agrega otro servicio y atomicidad entre almacenes; SQS administrado sería una opción cloud posterior con outbox; timers en memoria pierden trabajo; transacciones multidocumento no son necesarias para las invariantes embebidas actuales.

**Consecuencias.** Creación y encolado atómicos, recuperación por lease vencido y entrega al menos una vez. Requiere idempotencia externa. Auditoría y eventIds deben limitarse/archivarse antes de alcanzar tamaño máximo de documento. Escala y backups deben medirse; no se garantiza exactly-once. Véase [DATA_MODEL](../DATA_MODEL.md).
