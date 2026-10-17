# ADR-003 · JWT propio y contratos académicos diferenciados

Estado: aceptado para demostración local. Fecha: 16 octubre 2026.

**Contexto.** Las fuentes mezclan BPAC, tres financieras, OAuth/RS256 y protocolos distintos. La decisión adaptada exige dos mocks, sin credenciales ni datos reales.

**Decisión.** Pichincha ficticio JSON/webhook HMAC con polling de respaldo; Pacífico ficticio XML/polling. Semilla y escenarios controlan resultados. JWT HS256 propio con secreto aleatorio, issuer/audience/vencimiento; scrypt para contraseñas y acceso por agencia/rol.

**Alternativas.** Un IdP OAuth/OIDC y JWKS RS256 aporta federación y separación de firmante/verificador, pero exige infraestructura innecesaria en esta etapa. Una sola API JSON no demostraría traducción de protocolos. Bancos reales quedan fuera de alcance.

**Consecuencias.** Demo reproducible y Adapter visible. No se afirma OAuth, integración real, evaluación de riesgo, cumplimiento jurídico integral ni seguridad bancaria productiva. Rotación de secretos, HTTPS, cifrado y políticas de retención son obligaciones del futuro ambiente. Véase [REQUIREMENTS](../REQUIREMENTS.md).
